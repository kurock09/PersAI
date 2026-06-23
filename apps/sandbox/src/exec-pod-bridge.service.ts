import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { KubeConfig, CoreV1Api, Exec, V1Status } from "@kubernetes/client-node";
import type { SandboxConfig } from "@persai/config";
import type { RuntimeSandboxPolicy } from "@persai/runtime-contract";
import { SANDBOX_CONFIG } from "./sandbox-config";
import { SandboxPrismaService } from "./sandbox-prisma.service";

// Annotations carrying the assistant+workspace identity on the reusable exec pod.
// The exec pod is keyed by (assistantId, workspaceId), NOT by chat session, so all
// chats of one assistant+workspace reuse a single warm pod (the workspace lease —
// assistantId+workspaceId Postgres mutex — serializes jobs, so there is never
// concurrent use; the pod's /workspace is re-pushed from the control plane on every
// job, so pod identity is purely a warmth optimization). The idle reaper reads these
// back from cluster truth to derive last-activity from the sandboxJob table, so
// eviction survives control-plane restarts and works across replicas.
const ASSISTANT_ID_ANNOTATION = "persai.io/assistant-id";
const WORKSPACE_ID_ANNOTATION = "persai.io/workspace-id";
// Explicit success marker printed by the stdin-less verify probe when the push
// marker file is present. See pushWorkspace for why success is detected on a
// separate stdin-less exec rather than the push exec's own return channels.
const WORKSPACE_PUSH_OK_SENTINEL = "__PERSAI_PUSH_OK__";
// Marker file the push exec writes inside the pod ONLY when `tar` actually
// succeeded. The verify probe checks for it. Lives in /tmp (writable emptyDir);
// pushes are serialized per session by the workspace lease, so there is no race
// on this fixed path, and the push rewrites it (`rm -f` then `&&`-gated write).
const WORKSPACE_PUSH_MARKER = "/tmp/.persai_push_ok";
// Grace window: when the exec WebSocket closes before a status frame was observed,
// wait briefly and re-check — the status message is often dispatched in the same
// tick as close and just ordered after it.
const EXEC_CLOSE_STATUS_GRACE_MS = 250;
// Kubernetes exec stdin cannot be fed a large archive as one WebSocket frame/chunk:
// live proof on persai-dev showed a 52,582,400-byte workspace tar sent with
// Readable.from([tarball]) arrived in the pod as 0 bytes, while the same tar split
// into 64 KiB chunks arrived byte-for-byte (sha256 match) and `tar -tf` passed.
const WORKSPACE_PUSH_CHUNK_BYTES = 64 * 1024;

export type PodExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  execPodName: string;
};

type BridgeError = Error & { code: string; blocked: boolean };

// `blocked` marks a terminal policy/limit/workload block (non-retryable). Bridge
// errors are operational by default (pod spawn/provision/push/exec/pull failures)
// and MUST be retryable, so the sandbox records them as `failed`, not `blocked` —
// async consumers (e.g. the document render job) need to retry them. Pass
// `blocked: true` only for genuine non-retryable blocks (resource limits, command
// runtime budget exceeded).
function createBridgeError(code: string, message: string, blocked = false): BridgeError {
  const error = new Error(message) as BridgeError;
  error.code = code;
  error.blocked = blocked;
  return error;
}

/**
 * Extract a human-readable message from an arbitrary thrown value. The
 * @kubernetes/client-node WebSocket layer rejects with non-Error objects (e.g. a
 * DOM-style `ErrorEvent` whose useful text lives on `.message`), which would otherwise
 * collapse to "[object Object]" when stringified downstream. This keeps the real cause
 * (API server status messages, connection failures) visible in job results and logs.
 */
function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
    try {
      const json = JSON.stringify(error);
      if (json !== undefined && json !== "{}") {
        return json;
      }
    } catch {
      // Fall through to the generic descriptor below.
    }
    return Object.prototype.toString.call(error);
  }
  return String(error);
}

function posixSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function posixCommandArray(parts: string[]): string {
  return parts.map(posixSingleQuote).join(" ");
}

function extractExitCode(status: V1Status): number {
  if (status.status === "Success") {
    return 0;
  }
  const cause = status.details?.causes?.find((c) => c.reason === "ExitCode");
  if (cause?.message !== undefined && cause.message !== null) {
    const parsed = parseInt(cause.message, 10);
    return isNaN(parsed) ? 1 : parsed;
  }
  return 1;
}

class LimitedCollector extends Writable {
  private readonly chunks: Buffer[] = [];
  private totalBytes = 0;
  limitError: BridgeError | null = null;

  constructor(
    private readonly limitBytes: number,
    private readonly limitCode: string,
    private readonly limitMessage: string
  ) {
    super();
  }

  override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
    this.totalBytes += chunk.length;
    this.chunks.push(chunk);
    if (this.totalBytes > this.limitBytes && this.limitError === null) {
      // Stdout/stderr byte limit exceeded: terminal policy block, not retryable.
      this.limitError = createBridgeError(this.limitCode, this.limitMessage, true);
    }
    callback();
  }

  collect(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

@Injectable()
export class ExecPodBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExecPodBridgeService.name);
  private readonly kc: KubeConfig;
  private readonly k8sApi: CoreV1Api;
  private readonly execApi: Exec;

  private reaperTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(SANDBOX_CONFIG) private readonly config: SandboxConfig,
    private readonly prisma: SandboxPrismaService
  ) {
    this.kc = new KubeConfig();
    this.kc.loadFromCluster();
    this.k8sApi = this.kc.makeApiClient(CoreV1Api);
    this.execApi = new Exec(this.kc);
  }

  onModuleInit(): void {
    this.reaperTimer = setInterval(() => {
      void this.runReaperTick().catch((error: unknown) => {
        this.logger.warn(
          `exec_pod_reaper_error error=${error instanceof Error ? error.message : String(error)}`
        );
      });
    }, this.config.SANDBOX_EXEC_REAPER_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.reaperTimer !== null) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  async runInPod(options: {
    jobId: string;
    runtimeSessionId: string | null;
    assistantId: string;
    workspaceId: string;
    workspaceRoot: string;
    absoluteCwd: string;
    command: string;
    args: string[];
    policy: RuntimeSandboxPolicy;
  }): Promise<PodExecResult> {
    const namespace = this.config.SANDBOX_EXEC_NAMESPACE;
    const startedAt = Date.now();

    if (options.runtimeSessionId !== null) {
      return this.runInSessionPod({
        ...options,
        namespace,
        startedAt
      });
    }

    return this.runInEphemeralPod({ ...options, namespace, startedAt });
  }

  /**
   * Reusable workspace pod path: the pod is named after the (assistantId, workspaceId)
   * identity and reused across every chat/job for that assistant workspace. The pod is
   * NOT deleted after the job; the idle-TTL reaper cleans it up.
   *
   * Serialization guarantee: the workspace lease (assistantId+workspaceId, Postgres mutex)
   * ensures at most one job per assistant workspace runs concurrently, so no two calls to
   * this method race on the same pod even across chats.
   */
  private async runInSessionPod(options: {
    jobId: string;
    assistantId: string;
    workspaceId: string;
    workspaceRoot: string;
    absoluteCwd: string;
    command: string;
    args: string[];
    policy: RuntimeSandboxPolicy;
    namespace: string;
    startedAt: number;
  }): Promise<PodExecResult> {
    const { assistantId, workspaceId, namespace } = options;
    const podName = this.buildSessionPodName(assistantId, workspaceId);

    this.logger.log(
      `exec_pod_session job=${options.jobId} pod=${podName} assistant=${assistantId} workspace=${workspaceId}`
    );

    // Idle activity is derived by the reaper from the sandboxJob table keyed by the
    // assistant+workspace annotations stamped on the pod — no in-memory tracking needed.
    await this.ensureSessionPodRunning(
      podName,
      namespace,
      options.policy,
      assistantId,
      workspaceId
    );
    await this.pushWorkspace(podName, namespace, options.workspaceRoot);
    const podCwd = this.toPodCwd(options.workspaceRoot, options.absoluteCwd);
    const result = await this.execCommand(podName, namespace, {
      command: options.command,
      args: options.args,
      podCwd,
      policy: options.policy
    });
    await this.pullWorkspace(podName, namespace, options.workspaceRoot);

    return {
      ...result,
      durationMs: Date.now() - options.startedAt,
      execPodName: podName
    };
  }

  /**
   * Ephemeral pod path (runtimeSessionId == null): create, run, delete.
   * This is the fallback for sessionless jobs and preserves Slice 1 behavior exactly.
   */
  private async runInEphemeralPod(options: {
    jobId: string;
    workspaceRoot: string;
    absoluteCwd: string;
    command: string;
    args: string[];
    policy: RuntimeSandboxPolicy;
    namespace: string;
    startedAt: number;
  }): Promise<PodExecResult> {
    const podName = this.buildPodName(options.jobId);
    const { namespace } = options;

    this.logger.log(`exec_pod_create job=${options.jobId} pod=${podName} session=none`);

    await this.createExecPod(podName, namespace, options.policy);
    try {
      await this.waitForPodRunning(
        podName,
        namespace,
        this.config.SANDBOX_EXEC_POD_PROVISION_BUDGET_MS
      );
      await this.pushWorkspace(podName, namespace, options.workspaceRoot);
      const podCwd = this.toPodCwd(options.workspaceRoot, options.absoluteCwd);
      const result = await this.execCommand(podName, namespace, {
        command: options.command,
        args: options.args,
        podCwd,
        policy: options.policy
      });
      await this.pullWorkspace(podName, namespace, options.workspaceRoot);
      return {
        ...result,
        durationMs: Date.now() - options.startedAt,
        execPodName: podName
      };
    } finally {
      await this.deletePod(podName, namespace);
    }
  }

  /**
   * Ensure the session pod exists and is Running. Creates it if absent or in a terminal state.
   * A 409 Conflict from createExecPod (concurrent caller already created the pod) is treated
   * as "already created" and falls through to waitForPodRunning without re-throwing.
   */
  private async ensureSessionPodRunning(
    podName: string,
    namespace: string,
    policy: RuntimeSandboxPolicy,
    assistantId: string,
    workspaceId: string
  ): Promise<void> {
    let needsCreate = false;
    try {
      const pod = await this.k8sApi.readNamespacedPod({ name: podName, namespace });
      const phase = pod.status?.phase;
      if (phase === "Running") {
        return;
      }
      if (phase === "Failed" || phase === "Succeeded" || phase === "Unknown") {
        // Terminal: delete and recreate.
        this.logger.warn(
          `exec_pod_session_terminal pod=${podName} phase=${phase ?? "unknown"} — recreating`
        );
        await this.deletePod(podName, namespace);
        needsCreate = true;
      }
      // Pending or unknown phase: fall through to waitForPodRunning.
    } catch (error) {
      const isNotFound =
        error !== null &&
        typeof error === "object" &&
        ((error as { code?: unknown }).code === 404 ||
          (error as { statusCode?: unknown }).statusCode === 404 ||
          (error as { response?: { statusCode?: unknown } }).response?.statusCode === 404);
      if (!isNotFound) {
        throw createBridgeError(
          "process_spawn_failed",
          `Failed to read session exec pod: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      needsCreate = true;
    }

    if (needsCreate) {
      this.logger.log(`exec_pod_session_create pod=${podName}`);
      await this.createExecPodIdempotent(podName, namespace, policy, {
        [ASSISTANT_ID_ANNOTATION]: assistantId,
        [WORKSPACE_ID_ANNOTATION]: workspaceId
      });
    }

    await this.waitForPodRunning(
      podName,
      namespace,
      this.config.SANDBOX_EXEC_POD_PROVISION_BUDGET_MS
    );
  }

  /**
   * Pre-create the session pod for this (assistantId, workspaceId) pair so pod provisioning
   * overlaps the workspace lease wait (warm-pool entry, ADR-126 D10 / Slice 1).
   * Safe to call concurrently with runInSessionPod — a 409 from a racing create is treated
   * as idempotent success. Warm failure is non-fatal; callers log at warn and continue.
   */
  async warmSessionPod(input: {
    assistantId: string;
    workspaceId: string;
    policy: RuntimeSandboxPolicy;
  }): Promise<{ podName: string; alreadyRunning: boolean }> {
    const { assistantId, workspaceId, policy } = input;
    const namespace = this.config.SANDBOX_EXEC_NAMESPACE;
    const podName = this.buildSessionPodName(assistantId, workspaceId);

    let alreadyRunning = false;
    try {
      const pod = await this.k8sApi.readNamespacedPod({ name: podName, namespace });
      if (pod.status?.phase === "Running") {
        alreadyRunning = true;
        this.logger.log(
          `warm_session_pod pod=${podName} assistant=${assistantId} workspace=${workspaceId} already_running=true`
        );
        return { podName, alreadyRunning: true };
      }
    } catch (error) {
      const isNotFound =
        error !== null &&
        typeof error === "object" &&
        ((error as { code?: unknown }).code === 404 ||
          (error as { statusCode?: unknown }).statusCode === 404 ||
          (error as { response?: { statusCode?: unknown } }).response?.statusCode === 404);
      if (!isNotFound) {
        throw error;
      }
      // Pod not found — fall through to create.
    }

    await this.createExecPodIdempotent(podName, namespace, policy, {
      [ASSISTANT_ID_ANNOTATION]: assistantId,
      [WORKSPACE_ID_ANNOTATION]: workspaceId
    });

    await this.waitForPodRunning(
      podName,
      namespace,
      this.config.SANDBOX_EXEC_POD_PROVISION_BUDGET_MS
    );

    this.logger.log(
      `warm_session_pod pod=${podName} assistant=${assistantId} workspace=${workspaceId} already_running=${String(alreadyRunning)}`
    );
    return { podName, alreadyRunning };
  }

  /**
   * Reaper tick: delete exec pods idle longer than the configured TTL.
   *
   * Cluster-truth based: it lists the live exec pods (label-selected) rather than
   * trusting any in-memory state, so it correctly evicts pods created by another
   * control-plane replica and pods that outlived a control-plane restart (both
   * cases the previous in-memory reaper silently leaked). Last-activity is derived
   * from the sandboxJob table keyed by the session annotation; an actively used
   * session always has a fresh job row, so a busy pod is never evicted. Ephemeral
   * pods (no session annotation) fall back to the pod creation time, which also
   * cleans up any leaked ephemeral pod whose post-job delete failed.
   */
  async runReaperTick(): Promise<void> {
    const idleTtlMs = this.config.SANDBOX_EXEC_SESSION_IDLE_TTL_MS;
    const namespace = this.config.SANDBOX_EXEC_NAMESPACE;
    const now = Date.now();

    let podItems: Array<{
      metadata?: {
        name?: string;
        creationTimestamp?: Date | string;
        annotations?: Record<string, string>;
      };
    }>;
    try {
      const podList = await this.k8sApi.listNamespacedPod({
        namespace,
        labelSelector: "app.kubernetes.io/component=sandbox-exec"
      });
      podItems = podList.items;
    } catch (error) {
      this.logger.warn(`exec_pod_reaper_list_failed error=${describeUnknownError(error)}`);
      return;
    }

    for (const pod of podItems) {
      const podName = pod.metadata?.name;
      if (podName === undefined) {
        continue;
      }
      const creationMs =
        pod.metadata?.creationTimestamp === undefined
          ? now
          : new Date(pod.metadata.creationTimestamp).getTime();
      let lastActivityMs = creationMs;

      const assistantId = pod.metadata?.annotations?.[ASSISTANT_ID_ANNOTATION];
      const workspaceId = pod.metadata?.annotations?.[WORKSPACE_ID_ANNOTATION];
      if (assistantId !== undefined && workspaceId !== undefined) {
        try {
          const latest = await this.prisma.sandboxJob.findFirst({
            where: { assistantId, workspaceId },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true, completedAt: true }
          });
          if (latest !== null) {
            lastActivityMs = Math.max(
              lastActivityMs,
              (latest.completedAt ?? latest.createdAt).getTime()
            );
          }
        } catch (error) {
          // Cannot determine activity — do not risk evicting a live workspace pod.
          this.logger.warn(
            `exec_pod_reaper_activity_query_failed pod=${podName} error=${describeUnknownError(error)}`
          );
          continue;
        }
      }

      const idleMs = now - lastActivityMs;
      if (idleMs > idleTtlMs) {
        this.logger.log(
          `exec_pod_reaper_evict pod=${podName} assistant=${assistantId ?? "none"} workspace=${workspaceId ?? "none"} idle_ms=${String(idleMs)}`
        );
        await this.deletePod(podName, namespace);
      }
    }
  }

  /**
   * Derive a stable, k8s-safe pod name from the assistant+workspace identity, so every
   * chat/job for one assistant workspace shares a single reusable exec pod.
   * Format: ses-<sha256(assistantId:workspaceId)[0..31]>  (4 + 32 = 36 chars ≤ 63 limit).
   */
  buildSessionPodName(assistantId: string, workspaceId: string): string {
    const hash = createHash("sha256")
      .update(`${assistantId}:${workspaceId}`)
      .digest("hex")
      .slice(0, 32);
    return `ses-${hash}`;
  }

  private buildPodName(jobId: string): string {
    const sanitized = jobId.replace(/-/g, "").slice(0, 32).toLowerCase();
    return `exec-${sanitized}`;
  }

  private toPodCwd(workspaceRoot: string, absoluteCwd: string): string {
    if (absoluteCwd === workspaceRoot) {
      return "/workspace";
    }
    const relPart = absoluteCwd
      .substring(workspaceRoot.length)
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    return relPart.length > 0 ? `/workspace/${relPart}` : "/workspace";
  }

  /**
   * Create the exec pod, tolerating a 409 Conflict (another caller beat us to it).
   * A 409 is treated as idempotent: we log it and fall through so the caller can
   * proceed to waitForPodRunning. This prevents warm-pool races from surfacing as
   * process_spawn_failed when warmSessionPod and runInSessionPod race on the same pod.
   */
  private async createExecPodIdempotent(
    podName: string,
    namespace: string,
    policy: RuntimeSandboxPolicy,
    annotations?: Record<string, string>
  ): Promise<void> {
    try {
      await this.createExecPod(podName, namespace, policy, annotations);
    } catch (error) {
      const is409 =
        error !== null &&
        typeof error === "object" &&
        ((error as { code?: unknown }).code === 409 ||
          (error as { statusCode?: unknown }).statusCode === 409 ||
          (error as { response?: { statusCode?: unknown } }).response?.statusCode === 409);
      if (!is409) {
        throw error;
      }
      this.logger.log(
        `exec_pod_create_conflict_409 pod=${podName} — another caller created it concurrently, continuing`
      );
    }
  }

  private async createExecPod(
    podName: string,
    namespace: string,
    policy: RuntimeSandboxPolicy,
    annotations?: Record<string, string>
  ): Promise<void> {
    const image = this.config.SANDBOX_EXEC_IMAGE;
    const runtimeClassName = this.config.SANDBOX_EXEC_RUNTIME_CLASS_NAME;
    const nodeSelectorValue = this.config.SANDBOX_EXEC_NODE_SELECTOR_VALUE;
    const memMb = Math.ceil(policy.maxMemoryBytesPerJob / (1024 * 1024));
    const memLimit = `${Math.max(memMb, 64)}Mi`;
    const memRequest = `${Math.min(Math.max(memMb, 64), 256)}Mi`;

    try {
      await this.k8sApi.createNamespacedPod({
        namespace,
        body: {
          apiVersion: "v1",
          kind: "Pod",
          metadata: {
            name: podName,
            namespace,
            labels: {
              "app.kubernetes.io/name": "exec-pod",
              "app.kubernetes.io/component": "sandbox-exec"
            },
            ...(annotations === undefined ? {} : { annotations })
          },
          spec: {
            runtimeClassName,
            automountServiceAccountToken: false,
            restartPolicy: "Never",
            nodeSelector: {
              workload: nodeSelectorValue
            },
            tolerations: [
              {
                key: "sandbox.gke.io/runtime",
                operator: "Equal",
                value: "gvisor",
                effect: "NoSchedule"
              }
            ],
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000
            },
            volumes: [
              {
                name: "workspace",
                emptyDir: {
                  sizeLimit: "256Mi"
                }
              },
              {
                name: "tmp",
                emptyDir: {
                  sizeLimit: "256Mi"
                }
              }
            ],
            containers: [
              {
                name: "exec",
                image,
                command: ["/bin/sh", "-c", "sleep infinity"],
                env: this.buildProxyEnv(),
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  capabilities: {
                    drop: ["ALL"]
                  },
                  seccompProfile: {
                    type: "RuntimeDefault"
                  }
                },
                resources: {
                  requests: {
                    cpu: "250m",
                    memory: memRequest
                  },
                  limits: {
                    cpu: "2",
                    memory: memLimit
                  }
                },
                volumeMounts: [
                  {
                    name: "workspace",
                    mountPath: "/workspace"
                  },
                  {
                    name: "tmp",
                    mountPath: "/tmp"
                  }
                ]
              }
            ]
          }
        }
      });
    } catch (error) {
      // Re-throw 409 Conflict as-is so createExecPodIdempotent can detect and handle it.
      const is409 =
        error !== null &&
        typeof error === "object" &&
        ((error as { code?: unknown }).code === 409 ||
          (error as { statusCode?: unknown }).statusCode === 409 ||
          (error as { response?: { statusCode?: unknown } }).response?.statusCode === 409);
      if (is409) {
        throw error;
      }
      throw createBridgeError(
        "process_spawn_failed",
        `Failed to create exec pod: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async waitForPodRunning(
    podName: string,
    namespace: string,
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      let phase: string | undefined;
      try {
        const pod = await this.k8sApi.readNamespacedPod({ name: podName, namespace });
        phase = pod.status?.phase;
      } catch (error) {
        throw createBridgeError(
          "process_spawn_failed",
          `Failed to read exec pod status: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      if (phase === "Running") {
        return;
      }
      if (phase === "Failed" || phase === "Succeeded" || phase === "Unknown") {
        throw createBridgeError(
          "process_spawn_failed",
          `Exec pod entered terminal phase before Running: ${phase}`
        );
      }

      if (Date.now() >= deadline) {
        throw createBridgeError(
          "process_timeout",
          `Timed out waiting for exec pod to reach Running state after ${String(timeoutMs)}ms.`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private async pushWorkspace(
    podName: string,
    namespace: string,
    workspaceRoot: string
  ): Promise<void> {
    // Archive top-level entries by name (never "."). Extracting a "." member makes the
    // remote tar try to restore mode/utime on /workspace itself, which the non-root
    // exec user cannot do ("Cannot change mode/utime: Operation not permitted") and
    // fails the whole push. An empty workspace needs no push at all.
    const entries = await readdir(workspaceRoot);
    if (entries.length === 0) {
      return;
    }

    // Fully buffer the archive before streaming it as exec stdin. Passing a live
    // child-process stdout pipe to the WebSocket races the stdin-EOF signal and
    // intermittently truncates the archive (remote "tar: Unexpected EOF") or hangs;
    // a fully materialized Readable streams deterministically.
    const tarball = await this.createLocalTarball(workspaceRoot, entries);

    // Success is NOT read from the push exec's own return channels:
    // @kubernetes/client-node drops the exec stdout channel and races the status
    // frame whenever a non-trivial payload is multiplexed on the same WebSocket as
    // stdin (verified in-cluster: a >~1KB stdin payload reliably yields empty stdout
    // + a missed status frame even though the remote command exits 0). So the push
    // writes a marker file only when `tar` actually succeeds, and a separate
    // stdin-less probe — whose return channels ARE reliable — verifies it.
    //
    await this.execWorkspaceTarPush(podName, namespace, tarball);
    if (!(await this.verifyWorkspacePushed(podName, namespace))) {
      throw createBridgeError(
        "process_spawn_failed",
        "Workspace push verification failed: tar extraction marker missing"
      );
    }
  }

  /**
   * Step 1: stream the archive in over exec stdin and extract it, writing the
   * success marker only when `tar` exits 0. The push exec's stdout/status are
   * unreliable under a stdin payload (see pushWorkspace), so this resolves on a
   * clean socket close and only rejects when the exec connection itself fails —
   * i.e. when the command never ran. Actual extraction success is asserted by
   * verifyWorkspacePushed.
   */
  private async execWorkspaceTarPush(
    podName: string,
    namespace: string,
    tarball: Buffer
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const settled = { value: false };
      const drain = new Writable({
        write(_chunk: Buffer, _enc: string, cb: () => void) {
          cb();
        }
      });
      const done = () => {
        if (settled.value) return;
        settled.value = true;
        resolve();
      };
      const failConnection = (message: string) => {
        if (settled.value) return;
        settled.value = true;
        reject(createBridgeError("process_spawn_failed", message));
      };

      this.execApi
        .exec(
          namespace,
          podName,
          "exec",
          [
            "/bin/sh",
            "-c",
            // Clear any stale marker first, then write it ONLY if tar succeeds.
            `rm -f ${WORKSPACE_PUSH_MARKER}; tar --no-same-owner -xf - -C /workspace && printf ok > ${WORKSPACE_PUSH_MARKER}`
          ],
          drain,
          drain,
          this.readBufferInChunks(tarball, WORKSPACE_PUSH_CHUNK_BYTES),
          false,
          () => done()
        )
        .then((ws) => {
          ws.on("close", () => done());
          ws.on("error", (err: Error) => {
            failConnection(`Workspace push WebSocket error: ${describeUnknownError(err)}`);
          });
        })
        .catch((error: unknown) => {
          failConnection(`Workspace push exec failed: ${describeUnknownError(error)}`);
        });
    });
  }

  private readBufferInChunks(buffer: Buffer, chunkBytes: number): Readable {
    let offset = 0;
    return new Readable({
      read() {
        if (offset >= buffer.length) {
          this.push(null);
          return;
        }
        const nextOffset = Math.min(offset + chunkBytes, buffer.length);
        this.push(buffer.subarray(offset, nextOffset));
        offset = nextOffset;
      }
    });
  }

  /**
   * Authoritative push success check via a stdin-less exec. With no stdin
   * multiplexed on the socket, the exec stdout channel and status frame are
   * reliable, so the marker-file probe is definitive. Returns `false` (not throws)
   * when the marker is absent or the probe could not run; the caller turns that
   * into the retryable workspace-push failure reported to the sandbox job.
   */
  private verifyWorkspacePushed(podName: string, namespace: string): Promise<boolean> {
    return this.runStdinlessProbe(
      podName,
      namespace,
      `test -f ${WORKSPACE_PUSH_MARKER} && printf '${WORKSPACE_PUSH_OK_SENTINEL}'`,
      WORKSPACE_PUSH_OK_SENTINEL
    );
  }

  /**
   * Run a stdin-less shell probe and resolve `true` iff it reported success — either
   * the sentinel reached the (reliable, stdin-free) stdout channel or the exit status
   * was 0. Never rejects: any failure (non-zero exit, connection error, no sentinel)
   * resolves `false`, so callers treat it as "not confirmed" and decide what to do.
   */
  private runStdinlessProbe(
    podName: string,
    namespace: string,
    shellCommand: string,
    sentinel: string
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const settled = { value: false };
      const stdoutBuf: Buffer[] = [];
      const stdout = new Writable({
        write(chunk: Buffer, _enc: string, cb: () => void) {
          stdoutBuf.push(chunk);
          cb();
        }
      });
      const drain = new Writable({
        write(_chunk: Buffer, _enc: string, cb: () => void) {
          cb();
        }
      });
      const sentinelSeen = () => Buffer.concat(stdoutBuf).toString("utf8").includes(sentinel);
      const finish = (value: boolean) => {
        if (settled.value) return;
        settled.value = true;
        resolve(value);
      };

      this.execApi
        .exec(
          namespace,
          podName,
          "exec",
          ["/bin/sh", "-c", shellCommand],
          stdout,
          drain,
          null,
          false,
          (status: V1Status) => {
            finish(sentinelSeen() || extractExitCode(status) === 0);
          }
        )
        .then((ws) => {
          ws.on("close", () => {
            if (settled.value) return;
            setTimeout(() => finish(sentinelSeen()), EXEC_CLOSE_STATUS_GRACE_MS);
          });
          ws.on("error", () => finish(false));
        })
        .catch(() => finish(false));
    });
  }

  /**
   * Spawn local `tar` over explicit entry names and buffer the full archive in memory.
   * Rejects on a non-zero tar exit so a partial archive is never streamed to the pod.
   */
  private async createLocalTarball(workspaceRoot: string, entries: string[]): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
      const tarChild = spawn("tar", ["-cf", "-", "-C", workspaceRoot, ...entries], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      tarChild.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
      tarChild.stderr?.on("data", (chunk: Buffer) => errChunks.push(chunk));
      tarChild.on("error", (err: Error) => {
        reject(
          createBridgeError(
            "process_spawn_failed",
            `Local tar failed during push: ${describeUnknownError(err)}`
          )
        );
      });
      tarChild.on("close", (code: number | null) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(
            createBridgeError(
              "process_spawn_failed",
              `Local tar exited ${String(code)} during push: ${Buffer.concat(errChunks).toString("utf8").trim()}`
            )
          );
        }
      });
    });
  }

  private async execCommand(
    podName: string,
    namespace: string,
    options: {
      command: string;
      args: string[];
      podCwd: string;
      policy: RuntimeSandboxPolicy;
    }
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const execArgs = [
      "/bin/sh",
      "-c",
      `cd ${posixSingleQuote(options.podCwd)} && ${posixCommandArray([options.command, ...options.args])}`
    ];

    const stdoutCollector = new LimitedCollector(
      options.policy.maxStdoutBytes,
      "stdout_limit_exceeded",
      `Sandbox stdout exceeded ${String(options.policy.maxStdoutBytes)} bytes.`
    );
    const stderrCollector = new LimitedCollector(
      options.policy.maxStderrBytes,
      "stderr_limit_exceeded",
      `Sandbox stderr exceeded ${String(options.policy.maxStderrBytes)} bytes.`
    );

    const resultPromise = new Promise<{ exitCode: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const statusReceived = { value: false };

        this.execApi
          .exec(
            namespace,
            podName,
            "exec",
            execArgs,
            stdoutCollector,
            stderrCollector,
            null,
            false,
            (status: V1Status) => {
              statusReceived.value = true;
              const limitErr = stdoutCollector.limitError ?? stderrCollector.limitError;
              if (limitErr !== null) {
                reject(limitErr);
                return;
              }
              resolve({
                exitCode: extractExitCode(status),
                stdout: stdoutCollector.collect(),
                stderr: stderrCollector.collect()
              });
            }
          )
          .then((ws) => {
            ws.on("close", () => {
              if (statusReceived.value) {
                return;
              }
              // The status frame is often dispatched in the same tick as close,
              // just ordered after it. Give it a brief grace window before failing.
              setTimeout(() => {
                if (statusReceived.value) {
                  return;
                }
                const limitErr = stdoutCollector.limitError ?? stderrCollector.limitError;
                if (limitErr !== null) {
                  reject(limitErr);
                } else {
                  reject(
                    createBridgeError(
                      "sandbox_failed",
                      "Exec WebSocket closed without status",
                      false
                    )
                  );
                }
              }, EXEC_CLOSE_STATUS_GRACE_MS);
            });
            ws.on("error", (err: Error) => {
              reject(
                createBridgeError(
                  "sandbox_failed",
                  `Exec WebSocket error: ${describeUnknownError(err)}`,
                  false
                )
              );
            });
          })
          .catch((error: unknown) =>
            reject(
              createBridgeError(
                "sandbox_failed",
                `Exec connection failed: ${describeUnknownError(error)}`,
                false
              )
            )
          );
      }
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            createBridgeError(
              "process_timeout",
              `Sandbox process exceeded ${String(options.policy.maxProcessRuntimeMs)}ms.`,
              // Workload exceeded its own runtime budget — retrying the same command
              // would time out again. Non-retryable.
              true
            )
          ),
        options.policy.maxProcessRuntimeMs
      )
    );

    return Promise.race([resultPromise, timeoutPromise]);
  }

  private async pullWorkspace(
    podName: string,
    namespace: string,
    workspaceRoot: string
  ): Promise<void> {
    const tarBytes = await this.collectTarFromPod(podName, namespace);
    await this.extractTarToWorkspace(tarBytes, workspaceRoot);
  }

  private async collectTarFromPod(podName: string, namespace: string): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stdoutCollector = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          chunks.push(chunk);
          callback();
        }
      });

      const statusReceived = { value: false };
      this.execApi
        .exec(
          namespace,
          podName,
          "exec",
          ["tar", "-cf", "-", "-C", "/workspace", "."],
          stdoutCollector,
          null,
          null,
          false,
          (status: V1Status) => {
            statusReceived.value = true;
            if (extractExitCode(status) !== 0) {
              reject(
                createBridgeError(
                  "sandbox_failed",
                  `Workspace tar pull failed: ${status.message ?? "non-zero exit"}`,
                  false
                )
              );
            } else {
              resolve(Buffer.concat(chunks));
            }
          }
        )
        .then((ws) => {
          ws.on("close", () => {
            if (statusReceived.value) {
              return;
            }
            setTimeout(() => {
              if (!statusReceived.value) {
                reject(
                  createBridgeError(
                    "sandbox_failed",
                    "Workspace pull WebSocket closed without status",
                    false
                  )
                );
              }
            }, EXEC_CLOSE_STATUS_GRACE_MS);
          });
          ws.on("error", (err: Error) => {
            reject(
              createBridgeError(
                "sandbox_failed",
                `Workspace pull WebSocket error: ${describeUnknownError(err)}`,
                false
              )
            );
          });
        })
        .catch((error: unknown) =>
          reject(
            createBridgeError(
              "sandbox_failed",
              `Workspace pull exec failed: ${describeUnknownError(error)}`,
              false
            )
          )
        );
    });
  }

  private async extractTarToWorkspace(tarBytes: Buffer, workspaceRoot: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const extractChild = spawn("tar", ["-xf", "-", "-C", workspaceRoot], {
        stdio: ["pipe", "ignore", "pipe"]
      });
      const stderrChunks: Buffer[] = [];
      extractChild.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      extractChild.on("error", (err: Error) => {
        reject(
          createBridgeError("sandbox_failed", `Local tar extract failed: ${err.message}`, false)
        );
      });
      extractChild.on("close", (exitCode: number | null) => {
        if (exitCode === 0) {
          resolve();
        } else {
          const stderrMsg = Buffer.concat(stderrChunks).toString("utf8").trim();
          reject(
            createBridgeError(
              "sandbox_failed",
              `Local tar extract exited ${String(exitCode)}: ${stderrMsg}`,
              false
            )
          );
        }
      });
      extractChild.stdin?.end(tarBytes);
    });
  }

  async deletePod(podName: string, namespace: string): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedPod({ name: podName, namespace });
      this.logger.log(`exec_pod_deleted pod=${podName}`);
    } catch (error) {
      this.logger.warn(
        `exec_pod_delete_failed pod=${podName} error=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private buildProxyEnv(): Array<{ name: string; value: string }> {
    const proxyUrl = this.config.SANDBOX_EXEC_EGRESS_PROXY_URL;
    if (proxyUrl.length === 0) {
      return [];
    }
    const noProxy = this.config.SANDBOX_EXEC_NO_PROXY;
    const vars: Array<{ name: string; value: string }> = [
      { name: "HTTP_PROXY", value: proxyUrl },
      { name: "HTTPS_PROXY", value: proxyUrl },
      { name: "http_proxy", value: proxyUrl },
      { name: "https_proxy", value: proxyUrl }
    ];
    if (noProxy.length > 0) {
      vars.push({ name: "NO_PROXY", value: noProxy });
      vars.push({ name: "no_proxy", value: noProxy });
    }
    return vars;
  }
}
