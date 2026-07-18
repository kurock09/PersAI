import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, type Writable } from "node:stream";

const RETRYABLE_WINDOWS_RM_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);

async function removePathWithRetries(path: string): Promise<void> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await fs.rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : null;
      if (!code || !RETRYABLE_WINDOWS_RM_CODES.has(code) || attempt === 20) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, attempt * 150)));
    }
  }
}
import type { SandboxConfig } from "@persai/config";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import type { CoreV1Api, V1Pod } from "@kubernetes/client-node";
import { SCRIPT_BROWSER_REQUEST_FRAME_PREFIX } from "@persai/runtime-contract";
import {
  ExecPodBridgeService,
  LimitedCollector,
  WORKSPACE_MOUNT_HYDRATE_CONCURRENCY
} from "../src/exec-pod-bridge.service";
import { ScriptBrowserFrameDecoder } from "../src/script-browser-frame";

// A valid, empty tar archive: two+ all-zero 512-byte blocks signal end-of-archive.
// The control plane's workspace pull (`tar -cf - -C /workspace .`) always produces a
// real archive in production; the exec mock returns this empty-but-valid archive so the
// pull path's real `tar -xf` exits 0 on every tar implementation (GNU tar on CI rejects
// non-tar / zero-length input that BSD tar silently tolerates).
const VALID_EMPTY_TAR = "\0".repeat(10240);

function labeledRunningPod(input?: {
  assistantId?: string;
  workspaceId?: string;
  handle?: string;
  mode?: "restricted" | "full-public";
}): V1Pod {
  const mode = input?.mode ?? "restricted";
  return {
    status: { phase: "Running" },
    metadata: {
      uid: `uid-${input?.assistantId ?? "pod"}-${input?.workspaceId ?? "workspace"}`,
      resourceVersion: "1",
      labels: {
        "app.kubernetes.io/name": "exec-pod",
        "app.kubernetes.io/component": "sandbox-exec",
        "persai.io/sandbox-egress": mode
      },
      annotations: {
        "persai.io/sandbox-egress": mode,
        ...(input?.assistantId ? { "persai.io/assistant-id": input.assistantId } : {}),
        ...(input?.workspaceId ? { "persai.io/workspace-id": input.workspaceId } : {}),
        ...(input?.handle ? { "persai.io/assistant-handle": input.handle } : {})
      }
    }
  };
}

function isWorkspacePull(command: string[]): boolean {
  return command.includes("-cf") && command.includes("/workspace");
}

function isBaselineProcessProbe(command: string[]): boolean {
  return command.some((part) => part.includes("for proc in /proc/[0-9]*"));
}

test("session pod cleanup script never scans /proc via command substitution", async () => {
  const source = await fs.readFile(
    join(process.cwd(), "src", "exec-pod-bridge.service.ts"),
    "utf8"
  );
  const cleanupFnStart = source.indexOf("private buildSessionPodCleanupScript(");
  assert.ok(cleanupFnStart >= 0, "cleanup script builder must exist");
  const cleanupFn = source.slice(cleanupFnStart, cleanupFnStart + 8_000);

  assert.match(
    cleanupFn,
    /collect_targets\(\) \{/,
    "cleanup must collect leftover PIDs in the same shell"
  );
  assert.doesNotMatch(
    cleanupFn,
    /\$\(target_pids\)/,
    "command-substitution /proc scans create a false leftover PID and force fail-closed retire"
  );
  assert.doesNotMatch(
    cleanupFn,
    /IFS=" " read -r key value _rest/,
    "gVisor /proc/*/status is tab-separated; space-only IFS breaks PPid ancestry parsing"
  );
  assert.match(
    cleanupFn,
    /if \[ "\$ppid" = "\$\$" \]; then/,
    "cleanup must ignore its own wait helpers so sleep waiters are not treated as leftovers"
  );
  assert.match(
    cleanupFn,
    /case "\$state" in[\s\S]*Z\*\) continue ;;/,
    "cleanup must ignore zombie entries that cannot be killed"
  );
});

type KubeConfigLike = {
  loadFromCluster(): void;
  makeApiClient<T>(apiClass: new (...args: unknown[]) => T): T;
};

function createConfig(): SandboxConfig {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    PORT: 3013,
    LOG_LEVEL: "info",
    PERSAI_INTERNAL_API_TOKEN: "test-token",
    SANDBOX_MAX_PENDING_JOBS: 16,
    SANDBOX_MAX_PENDING_JOBS_PER_WORKSPACE: 4,
    SANDBOX_MAX_POLL_WAIT_MS: 1_500,
    SANDBOX_QUEUED_JOB_STALE_AFTER_MS: 45_000,
    SANDBOX_RUNNING_JOB_GRACE_MS: 15_000,
    SANDBOX_EXEC_NAMESPACE: "persai-dev",
    SANDBOX_EXEC_IMAGE: "busybox:1.36",
    SANDBOX_EXEC_RUNTIME_CLASS_NAME: "gvisor",
    SANDBOX_EXEC_NODE_SELECTOR_VALUE: "sandbox",
    SANDBOX_EXEC_SERVICE_ACCOUNT_NAME: "sandbox-exec-sa",
    SANDBOX_EXEC_EGRESS_PROXY_URL: "",
    SANDBOX_EXEC_NO_PROXY: "",
    SANDBOX_EXEC_SESSION_IDLE_TTL_MS: 900_000,
    SANDBOX_EXEC_REAPER_INTERVAL_MS: 120_000,
    SANDBOX_EXEC_POD_PROVISION_BUDGET_MS: 2_000,
    SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 1,
    SANDBOX_SHARED_EMPTYDIR_SIZE_MIB: 512,
    SANDBOX_GC_INTERVAL_MS: 300_000,
    PERSAI_MEDIA_OBJECT_PREFIX: "assistant-media"
  };
}

// Minimal SandboxPrismaService stand-in: the reaper reads last-activity for an
// assistant+workspace from sandboxJob.findFirst, keyed by `${assistantId}:${workspaceId}`.
// Other code paths under test never touch the DB.
function createMockPrisma(
  latestByWorkspace: Record<string, { createdAt: Date; completedAt: Date | null } | null> = {},
  modeByAssistant: Record<string, string> = { "assistant-1": "restricted" }
) {
  return {
    sandboxJob: {
      findFirst: async ({
        where
      }: {
        where: { assistantId: string; workspaceId: string; status?: unknown };
      }) =>
        where.status === undefined
          ? (latestByWorkspace[`${where.assistantId}:${where.workspaceId}`] ?? null)
          : null,
      updateMany: async () => ({ count: 1 })
    },
    assistantWorkspaceLease: {
      findFirst: async (input: { where?: Record<string, unknown> }) =>
        input.where?.holderId === undefined ? null : { id: "active-lease" }
    },
    assistant: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const mode = modeByAssistant[where.id] ?? "restricted";
        return { sandboxEgressMode: mode };
      }
    }
  };
}

type CreatedPodSpec = {
  namespace: string;
  body: V1Pod;
};

type MockK8sContext = {
  createdPods: CreatedPodSpec[];
  podPhaseSequence: (string | Error)[];
  execResponses: Array<{ exitCode: number; stdout: string; stderr: string }>;
  deletedPods: string[];
  execCallCount: number;
  execCommands: string[][];
};

test("interactive exec reserves streaming stdin and strips broker frames from stdout", async () => {
  const request = {
    version: 1,
    requestId: "request_12345678",
    action: "snapshot",
    profile: "Work",
    arguments: { url: "https://example.com" }
  };
  const encoded = `${SCRIPT_BROWSER_REQUEST_FRAME_PREFIX}${Buffer.from(
    JSON.stringify(request),
    "utf8"
  ).toString("base64url")}\nordinary-result`;
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: [],
    execResponses: [{ exitCode: 0, stdout: encoded, stderr: "" }],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };
  const bridge = buildMockBridge(ctx);
  const frames: unknown[] = [];
  let decoder: ScriptBrowserFrameDecoder | null = null;
  const result = await (
    bridge as unknown as {
      execCommand(
        podName: string,
        namespace: string,
        options: Record<string, unknown>
      ): Promise<{ stdout: string }>;
    }
  ).execCommand("pod", "namespace", {
    command: "/bin/sh",
    args: ["-c", "true"],
    podCwd: "/",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
    skipIdentityAssertion: true,
    interactive: {
      stdin: new PassThrough(),
      wrapStdout: (ordinaryStdout: Writable) => {
        decoder = new ScriptBrowserFrameDecoder((frame) => frames.push(frame), ordinaryStdout);
        return decoder;
      },
      finalizeStdout: () => decoder?.flushRemainder()
    }
  });
  assert.deepEqual(frames, [request]);
  assert.equal(result.stdout, "ordinary-result");
});

function buildMockBridge(ctx: MockK8sContext): ExecPodBridgeService {
  let phaseIndex = 0;
  let execCallIndex = 0;
  const livePods = new Map<string, V1Pod>();

  const mockCoreV1Api: Partial<CoreV1Api> & {
    __seedLivePod(name: string, body: V1Pod): void;
  } = {
    async createNamespacedPod(params: { namespace: string; body: V1Pod }) {
      ctx.createdPods.push({ namespace: params.namespace, body: params.body });
      const name = params.body.metadata?.name;
      if (name !== undefined) {
        const body = structuredClone(params.body);
        body.metadata = { ...body.metadata, uid: body.metadata?.uid ?? `uid-${name}` };
        body.metadata.resourceVersion = body.metadata.resourceVersion ?? "1";
        livePods.set(name, body);
      }
      return params.body as never;
    },
    async readNamespacedPod(params?: { name?: string }) {
      const name = params?.name;
      const stored = name === undefined ? undefined : livePods.get(name);
      if (stored === undefined) {
        // Cluster truth: absent pods are 404. Phase-only stubs are seeded into
        // livePods by waitForPodRunning unit tests below.
        const error = new Error("not found") as Error & { code: number };
        error.code = 404;
        throw error;
      }
      const phaseOrError = ctx.podPhaseSequence[phaseIndex];
      if (phaseOrError !== undefined) {
        phaseIndex += 1;
      }
      if (phaseOrError instanceof Error) {
        throw phaseOrError;
      }
      return {
        ...stored,
        status: { phase: phaseOrError ?? "Running" }
      } as never;
    },
    async deleteNamespacedPod(params: { name: string; namespace: string }) {
      const stored = livePods.get(params.name);
      const expectedUid = (params as unknown as { body?: { preconditions?: { uid?: string } } })
        .body?.preconditions?.uid;
      if (
        stored !== undefined &&
        expectedUid !== undefined &&
        stored.metadata?.uid !== expectedUid
      ) {
        const error = new Error("uid precondition conflict") as Error & { code: number };
        error.code = 409;
        throw error;
      }
      ctx.deletedPods.push(params.name);
      livePods.delete(params.name);
      return {} as never;
    },
    async replaceNamespacedPod(params: { name: string; namespace: string; body: V1Pod }) {
      const current = livePods.get(params.name);
      if (current === undefined) {
        const error = new Error("not found") as Error & { code: number };
        error.code = 404;
        throw error;
      }
      const replacement = structuredClone(params.body);
      replacement.metadata = {
        ...replacement.metadata,
        uid: current.metadata?.uid ?? `uid-${params.name}`,
        resourceVersion: String(Number(current.metadata?.resourceVersion ?? "1") + 1)
      };
      livePods.set(params.name, replacement);
      return replacement as never;
    },
    // Test helper: seed a warm unlabeled/labeled pod without going through create.
    __seedLivePod(name: string, body: V1Pod) {
      livePods.set(name, {
        ...body,
        metadata: {
          ...body.metadata,
          uid: body.metadata?.uid ?? `uid-${name}`,
          resourceVersion: body.metadata?.resourceVersion ?? "1"
        }
      });
    }
  };

  const mockExec = {
    exec(
      _namespace: string,
      _podName: string,
      _containerName: string,
      command: string[],
      stdout: { write(chunk: string): boolean } | null,
      stderr: { write(chunk: string): boolean } | null,
      _stdin: unknown,
      _tty: boolean,
      statusCallback?: (status: { status: string }) => void
    ) {
      if (isBaselineProcessProbe(command)) {
        ctx.execCallCount += 1;
        ctx.execCommands.push([...command]);
        const ws = { on: () => undefined };
        void Promise.resolve().then(() => {
          if (stdout !== null) {
            stdout.write("1,2");
          }
          if (statusCallback !== undefined) {
            statusCallback({ status: "Success" });
          }
        });
        return Promise.resolve(ws as never);
      }
      const response = ctx.execResponses[execCallIndex];
      execCallIndex += 1;
      ctx.execCallCount += 1;
      ctx.execCommands.push([...command]);

      if (response === undefined) {
        // Unseeded exec calls default to success so tests stay resilient to the
        // exact number of internal exec round-trips (push + stdin-less verify +
        // command + pull). Pull commands still receive a valid empty tar.
        const ws = { on: () => undefined };
        void Promise.resolve().then(() => {
          if (stdout !== null && isWorkspacePull(command)) {
            stdout.write(VALID_EMPTY_TAR);
          }
          if (statusCallback !== undefined) {
            statusCallback({ status: "Success" });
          }
        });
        return Promise.resolve(ws as never);
      }

      const ws = {
        on: () => undefined
      };

      Promise.resolve().then(() => {
        if (stdout !== null) {
          if (isWorkspacePull(command)) {
            stdout.write(VALID_EMPTY_TAR);
          } else if (response.stdout.length > 0) {
            stdout.write(response.stdout);
          }
        }
        if (stderr !== null && response.stderr.length > 0) {
          stderr.write(response.stderr);
        }
        if (statusCallback !== undefined) {
          statusCallback({
            status: response.exitCode === 0 ? "Success" : "Failure"
          });
        }
      });

      return Promise.resolve(ws as never);
    }
  };

  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  (bridge as unknown as { kc: KubeConfigLike }).kc = {
    loadFromCluster() {},
    makeApiClient() {
      return mockCoreV1Api as never;
    }
  };
  (bridge as unknown as { k8sApi: unknown }).k8sApi = mockCoreV1Api;
  (bridge as unknown as { execApi: unknown }).execApi = mockExec;
  return bridge;
}

function buildHydrateTestBridge(input: {
  keys: string[];
  downloadObject: (key: string) => Promise<Buffer>;
  execCommand?: (
    podName: string,
    namespace: string,
    request: {
      command: string;
      args: string[];
      podCwd: string;
      policy: unknown;
      stdin?: Buffer;
    }
  ) => Promise<{ exitCode: number | null }>;
}) {
  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  const warnings: string[] = [];
  const infos: string[] = [];
  const listPrefixCalls: string[] = [];
  Object.defineProperty(bridge, "objectStorage", {
    configurable: true,
    value: {
      buildWorkspacePrefix: ({
        workspaceId,
        subPath
      }: {
        workspaceId: string;
        subPath?: string;
      }) => {
        const base = `assistant-media/workspaces/${workspaceId}/workspace/`;
        if (subPath === undefined || subPath.length === 0) {
          return base;
        }
        const normalized = subPath.replace(/\/+$/g, "");
        return `${base}${normalized}/`;
      },
      listPrefix: async (prefix: string) => {
        listPrefixCalls.push(prefix);
        return input.keys.filter((key) => key.startsWith(prefix));
      },
      downloadObject: input.downloadObject
    }
  });
  Object.defineProperty(bridge, "logger", {
    configurable: true,
    value: {
      warn(message: string) {
        warnings.push(message);
      },
      log(message: string) {
        infos.push(message);
      }
    }
  });
  Object.defineProperty(bridge, "execCommand", {
    configurable: true,
    value:
      input.execCommand ??
      (async () => {
        return { exitCode: 0, stdout: "", stderr: "" };
      })
  });
  Object.defineProperty(bridge, "runStdinlessProbe", {
    configurable: true,
    value: async () => true
  });
  return {
    bridge,
    warnings,
    infos,
    listPrefixCalls,
    async hydrateBootstrapWorkspaceMounts(
      podName: string,
      namespace: string,
      workspaceId: string,
      assistantId: string,
      runtimeSessionId: string | null,
      scope: "session" | "shared_only"
    ): Promise<void> {
      const method = Reflect.get(bridge, "hydrateBootstrapWorkspaceMounts");
      assert.equal(
        typeof method,
        "function",
        "hydrateBootstrapWorkspaceMounts must exist on the bridge"
      );
      await (
        method as (
          this: ExecPodBridgeService,
          podName: string,
          namespace: string,
          workspaceId: string,
          assistantId: string,
          runtimeSessionId: string | null,
          scope: "session" | "shared_only"
        ) => Promise<void>
      ).call(bridge, podName, namespace, workspaceId, assistantId, runtimeSessionId, scope);
    },
    async ensureWorkspaceMountBootstrapped(
      podName: string,
      namespace: string,
      workspaceId: string,
      assistantId: string,
      runtimeSessionId: string | null,
      scope: "session" | "shared_only" | "none" = runtimeSessionId !== null
        ? "session"
        : "shared_only"
    ): Promise<void> {
      const method = Reflect.get(bridge, "ensureWorkspaceMountBootstrapped");
      assert.equal(typeof method, "function");
      await (
        method as (
          this: ExecPodBridgeService,
          podName: string,
          namespace: string,
          workspaceId: string,
          assistantId: string,
          runtimeSessionId: string | null,
          assistantHandle: string,
          siblingHandles: readonly string[],
          gcsHydrateScope?: "session" | "shared_only" | "none"
        ) => Promise<void>
      ).call(
        bridge,
        podName,
        namespace,
        workspaceId,
        assistantId,
        runtimeSessionId,
        "test-handle",
        [],
        scope
      );
    }
  };
}

test("ExecPodBridgeService: buildPodName derives stable name from jobId", () => {
  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  const access = bridge as unknown as {
    buildPodName(jobId: string): string;
  };

  const name1 = access.buildPodName("550e8400-e29b-41d4-a716-446655440000");
  const name2 = access.buildPodName("550e8400-e29b-41d4-a716-446655440000");
  assert.equal(name1, name2, "same jobId must produce same pod name");
  assert.ok(name1.startsWith("exec-"), "pod name must start with exec-");
  assert.ok(name1.length <= 63, "pod name must fit k8s 63-char limit");
  assert.ok(/^[a-z0-9-]+$/.test(name1), "pod name must be lowercase alphanumeric/hyphens");
});

test("ExecPodBridgeService: hydrateBootstrapWorkspaceMounts no-ops when no scoped keys exist", async () => {
  let downloadCount = 0;
  let execCount = 0;
  const { hydrateBootstrapWorkspaceMounts, warnings, listPrefixCalls } = buildHydrateTestBridge({
    keys: [],
    downloadObject: async () => {
      downloadCount += 1;
      return Buffer.from("");
    },
    execCommand: async () => {
      execCount += 1;
      return { exitCode: 0 };
    }
  });

  await hydrateBootstrapWorkspaceMounts("pod-1", "persai-dev", "ws-empty", "bot", "s1", "session");

  assert.equal(downloadCount, 0, "empty hydrate must not download any blobs");
  assert.equal(execCount, 0, "empty hydrate must not open pod exec sessions");
  assert.deepEqual(warnings, [], "empty hydrate should not warn");
  assert.ok(
    listPrefixCalls.every((prefix) => prefix.includes("/assistants/bot/")),
    "scoped hydrate must list only assistant session/shared prefixes"
  );
  assert.ok(
    !listPrefixCalls.some((prefix) => /\/workspace\/$/.test(prefix)),
    "hydrate must not list the bare workspace prefix"
  );
});

test("ExecPodBridgeService: hydrateBootstrapWorkspaceMounts executes every scoped file when key count is within concurrency", async () => {
  const keys = [
    "assistant-media/workspaces/ws-small/workspace/assistants/bot/sessions/s1/a.txt",
    "assistant-media/workspaces/ws-small/workspace/assistants/bot/sessions/s1/b.txt",
    "assistant-media/workspaces/ws-small/workspace/assistants/bot/sessions/s1/c.txt",
    "assistant-media/workspaces/ws-small/workspace/assistants/bot/sessions/other-session/noise.txt",
    "assistant-media/workspaces/ws-small/workspace/assistants/other-bot/sessions/s1/noise.txt"
  ];
  const buffers = new Map<string, Buffer>([
    [keys[0]!, Buffer.from("alpha")],
    [keys[1]!, Buffer.from("beta")],
    [keys[2]!, Buffer.from("gamma")]
  ]);
  const writes: Array<{ shell: string; stdin: Buffer }> = [];
  const { hydrateBootstrapWorkspaceMounts, warnings } = buildHydrateTestBridge({
    keys,
    downloadObject: async (key) => buffers.get(key) ?? Buffer.from("missing"),
    execCommand: async (_podName, _namespace, request) => {
      writes.push({
        shell: request.args[1] ?? "",
        stdin: request.stdin ?? Buffer.alloc(0)
      });
      return { exitCode: 0 };
    }
  });

  await hydrateBootstrapWorkspaceMounts("pod-2", "persai-dev", "ws-small", "bot", "s1", "session");

  assert.equal(writes.length, 3, "only the current session subtree must be written into the pod");
  assert.deepEqual(warnings, [], "happy-path hydrate should not warn");
  assert.ok(
    writes.some(
      (write) =>
        write.shell.includes("/workspace/assistants/bot/sessions/s1/a.txt") &&
        write.stdin.equals(Buffer.from("alpha"))
    ),
    "a.txt must be written with its downloaded buffer"
  );
  assert.ok(
    writes.some(
      (write) =>
        write.shell.includes("/workspace/assistants/bot/sessions/s1/b.txt") &&
        write.stdin.equals(Buffer.from("beta"))
    ),
    "b.txt must be written with its downloaded buffer"
  );
  assert.ok(
    writes.some(
      (write) =>
        write.shell.includes("/workspace/assistants/bot/sessions/s1/c.txt") &&
        write.stdin.equals(Buffer.from("gamma"))
    ),
    "third file must be written with its downloaded buffer"
  );
});

test("ExecPodBridgeService: hydrateBootstrapWorkspaceMounts ignores other sessions in a large workspace", async () => {
  const workspaceId = "ws-large";
  const assistantId = "bot";
  const runtimeSessionId = "s-current";
  const sessionPrefix = `assistant-media/workspaces/${workspaceId}/workspace/assistants/${assistantId}/sessions/${runtimeSessionId}/`;
  const keys = [
    `${sessionPrefix}only.txt`,
    ...Array.from({ length: 40 }, (_, index) => {
      return `assistant-media/workspaces/${workspaceId}/workspace/assistants/${assistantId}/sessions/other-${index}/blob.bin`;
    }),
    ...Array.from({ length: 20 }, (_, index) => {
      return `assistant-media/workspaces/${workspaceId}/workspace/assistants/other-assistant/sessions/s-${index}/blob.bin`;
    })
  ];
  const writes: string[] = [];
  const { hydrateBootstrapWorkspaceMounts, listPrefixCalls } = buildHydrateTestBridge({
    keys,
    downloadObject: async (key) => Buffer.from(key),
    execCommand: async (_podName, _namespace, request) => {
      writes.push(request.args[1] ?? "");
      return { exitCode: 0 };
    }
  });

  await hydrateBootstrapWorkspaceMounts(
    "pod-large",
    "persai-dev",
    workspaceId,
    assistantId,
    runtimeSessionId,
    "session"
  );

  assert.equal(writes.length, 1, "hydrate object count must match the current session only");
  assert.ok(
    writes[0]?.includes(
      `/workspace/assistants/${assistantId}/sessions/${runtimeSessionId}/only.txt`
    ),
    "only the current session object must be hydrated"
  );
  assert.ok(
    !listPrefixCalls.some(
      (prefix) => prefix === `assistant-media/workspaces/${workspaceId}/workspace/`
    ),
    "hydrate must not list the bare workspace prefix"
  );
  assert.ok(
    listPrefixCalls.every(
      (prefix) =>
        prefix.includes(`/assistants/${assistantId}/sessions/${runtimeSessionId}/`) ||
        prefix.includes(`/assistants/${assistantId}/shared/`)
    ),
    "listPrefix must stay scoped to session and shared subtrees"
  );
});

test("ExecPodBridgeService: ensureWorkspaceMountBootstrapped re-hydrates when runtimeSessionId changes on warm pod", async () => {
  let hydratedSessionId: string | null = null;
  const { bridge, listPrefixCalls, ensureWorkspaceMountBootstrapped } = buildHydrateTestBridge({
    keys: [
      "assistant-media/workspaces/ws-switch/workspace/assistants/bot/sessions/s1/a.txt",
      "assistant-media/workspaces/ws-switch/workspace/assistants/bot/sessions/s2/b.txt"
    ],
    downloadObject: async () => Buffer.from("data"),
    execCommand: async (_podName, _namespace, request) => {
      const shell = request.args[1] ?? "";
      if (
        shell.includes("/tmp/.persai_workspace_hydrate_session") &&
        shell.includes("cat ") &&
        !shell.includes("cat >")
      ) {
        return { exitCode: 0, stdout: hydratedSessionId ?? "", stderr: "" };
      }
      if (
        shell.includes("/tmp/.persai_workspace_hydrate_session") &&
        request.stdin !== undefined &&
        request.stdin !== null
      ) {
        hydratedSessionId = request.stdin.toString("utf8");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  });
  void bridge;

  const ensure = async (sessionId: string) => {
    const callsBefore = listPrefixCalls.length;
    await ensureWorkspaceMountBootstrapped(
      "pod-switch",
      "persai-dev",
      "ws-switch",
      "bot",
      sessionId,
      "session"
    );
    return listPrefixCalls.length - callsBefore;
  };

  const first = await ensure("s1");
  const secondSame = await ensure("s1");
  const thirdSwitch = await ensure("s2");

  assert.ok(first > 0, "first session must hydrate from GCS");
  assert.equal(secondSame, 0, "same session on warm pod must not re-list GCS");
  assert.ok(thirdSwitch > 0, "session switch must re-hydrate the new session prefix");
  assert.equal(hydratedSessionId, "s2");
});

test("ExecPodBridgeService: zero-object session hydrate does not suppress a later real hydrate", async () => {
  const keys: string[] = [];
  let hydratedSessionId: string | null = null;
  const { ensureWorkspaceMountBootstrapped, listPrefixCalls } = buildHydrateTestBridge({
    keys,
    downloadObject: async () => Buffer.from("data"),
    execCommand: async (_podName, _namespace, request) => {
      const shell = request.args[1] ?? "";
      if (
        shell.includes("/tmp/.persai_workspace_hydrate_session") &&
        shell.includes("cat ") &&
        !shell.includes("cat >")
      ) {
        return { exitCode: 0, stdout: hydratedSessionId ?? "", stderr: "" };
      }
      if (
        shell.includes("/tmp/.persai_workspace_hydrate_session") &&
        request.stdin !== undefined &&
        request.stdin !== null
      ) {
        hydratedSessionId = request.stdin.toString("utf8");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  });

  const callsBeforeFirst = listPrefixCalls.length;
  await ensureWorkspaceMountBootstrapped(
    "pod-zero",
    "persai-dev",
    "ws-zero",
    "bot",
    "s1",
    "session"
  );
  const firstCallCount = listPrefixCalls.length - callsBeforeFirst;
  assert.ok(firstCallCount > 0, "first empty session bootstrap must still inspect scoped prefixes");
  assert.equal(
    hydratedSessionId,
    null,
    "zero-object hydrate must not mark the session as successfully hydrated"
  );

  keys.push("assistant-media/workspaces/ws-zero/workspace/assistants/bot/sessions/s1/report.txt");
  const callsBeforeSecond = listPrefixCalls.length;
  await ensureWorkspaceMountBootstrapped(
    "pod-zero",
    "persai-dev",
    "ws-zero",
    "bot",
    "s1",
    "session"
  );
  const secondCallCount = listPrefixCalls.length - callsBeforeSecond;
  assert.ok(
    secondCallCount > 0,
    "same-session bootstrap must retry after a zero-object hydrate once real objects appear"
  );
  assert.equal(hydratedSessionId, "s1");
});

test("ExecPodBridgeService: hydrateBootstrapWorkspaceMounts caps in-flight work at the concurrency constant", async () => {
  const totalKeys = WORKSPACE_MOUNT_HYDRATE_CONCURRENCY * 2 + 3;
  const keys = Array.from({ length: totalKeys }, (_, index) => {
    return `assistant-media/workspaces/ws-many/workspace/assistants/bot/sessions/s1/file-${index}.txt`;
  });
  let active = 0;
  let peak = 0;
  let execCount = 0;
  const { hydrateBootstrapWorkspaceMounts } = buildHydrateTestBridge({
    keys,
    downloadObject: async (key) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Buffer.from(key);
    },
    execCommand: async () => {
      execCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { exitCode: 0 };
    }
  });

  await hydrateBootstrapWorkspaceMounts("pod-3", "persai-dev", "ws-many", "bot", "s1", "session");

  assert.equal(execCount, totalKeys, "all keys must still complete");
  assert.ok(
    peak <= WORKSPACE_MOUNT_HYDRATE_CONCURRENCY,
    `peak in-flight work (${peak}) must not exceed the configured concurrency`
  );
  assert.equal(active, 0, "all in-flight work must drain before the hydrate resolves");
});

test("ExecPodBridgeService: hydrateBootstrapWorkspaceMounts logs download failures and continues other blobs", async () => {
  const keys = [
    "assistant-media/workspaces/ws-download/workspace/assistants/bot/sessions/s1/good-a.txt",
    "assistant-media/workspaces/ws-download/workspace/assistants/bot/sessions/s1/bad.txt",
    "assistant-media/workspaces/ws-download/workspace/assistants/bot/sessions/s1/good-b.txt"
  ];
  const writtenPaths: string[] = [];
  const { hydrateBootstrapWorkspaceMounts, warnings } = buildHydrateTestBridge({
    keys,
    downloadObject: async (key) => {
      if (key.endsWith("/bad.txt")) {
        throw new Error("boom");
      }
      return Buffer.from(key);
    },
    execCommand: async (_podName, _namespace, request) => {
      writtenPaths.push(request.args[1] ?? "");
      return { exitCode: 0 };
    }
  });

  await hydrateBootstrapWorkspaceMounts(
    "pod-4",
    "persai-dev",
    "ws-download",
    "bot",
    "s1",
    "session"
  );

  assert.equal(writtenPaths.length, 2, "healthy blobs must still be written");
  assert.ok(
    warnings.some((warning) =>
      warning.includes("workspace_mount_hydrate_download_failed workspace=ws-download")
    ),
    "download failures must be logged"
  );
  assert.ok(
    writtenPaths.some((shell) =>
      shell.includes("/workspace/assistants/bot/sessions/s1/good-a.txt")
    ),
    "good-a must still be written"
  );
  assert.ok(
    writtenPaths.some((shell) =>
      shell.includes("/workspace/assistants/bot/sessions/s1/good-b.txt")
    ),
    "good-b must still be written"
  );
});

test("ExecPodBridgeService: hydrateBootstrapWorkspaceMounts logs non-zero exec exits and still resolves", async () => {
  const keys = [
    "assistant-media/workspaces/ws-exit/workspace/assistants/bot/sessions/s1/ok.txt",
    "assistant-media/workspaces/ws-exit/workspace/assistants/bot/sessions/s1/fail.txt"
  ];
  const executed: string[] = [];
  const { hydrateBootstrapWorkspaceMounts, warnings } = buildHydrateTestBridge({
    keys,
    downloadObject: async (key) => Buffer.from(key),
    execCommand: async (_podName, _namespace, request) => {
      const shell = request.args[1] ?? "";
      executed.push(shell);
      if (shell.includes("/workspace/assistants/bot/sessions/s1/fail.txt")) {
        return { exitCode: 7 };
      }
      return { exitCode: 0 };
    }
  });

  await assert.doesNotReject(() =>
    hydrateBootstrapWorkspaceMounts("pod-5", "persai-dev", "ws-exit", "bot", "s1", "session")
  );

  assert.equal(executed.length, keys.length, "non-zero exits must not stop other writes");
  assert.ok(
    warnings.some(
      (warning) =>
        warning.includes("/workspace/assistants/bot/sessions/s1/fail.txt") &&
        warning.includes("exit=7")
    ),
    "non-zero write exits must be logged"
  );
});

test("ExecPodBridgeService: toPodCwd preserves hierarchical session roots", () => {
  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  const access = bridge as unknown as {
    toPodCwd(workspaceRoot: string, absoluteCwd: string): string;
  };

  assert.equal(access.toPodCwd("/tmp/ws", "/tmp/ws"), "/workspace");
  assert.equal(
    access.toPodCwd("/tmp/ws", "/tmp/ws/assistants/my-bot/sessions/session-1"),
    "/workspace/assistants/my-bot/sessions/session-1"
  );
  assert.equal(
    access.toPodCwd("/tmp/ws", "/tmp/ws/assistants/my-bot/sessions/session-1/reports/daily"),
    "/workspace/assistants/my-bot/sessions/session-1/reports/daily"
  );
  assert.throws(() => access.toPodCwd("/tmp/ws", "/tmp/other"), /escapes workspace root/);
});

test("ExecPodBridgeService: createExecPod creates pod with correct spec", async () => {
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" }
    ],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  const access = bridge as unknown as {
    createExecPod(
      podName: string,
      namespace: string,
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY,
      egressMode: "restricted" | "full_public"
    ): Promise<void>;
  };

  await access.createExecPod(
    "exec-testpod",
    "persai-dev",
    {
      ...DEFAULT_RUNTIME_SANDBOX_POLICY,
      enabled: true
    },
    "restricted"
  );

  assert.equal(ctx.createdPods.length, 1);
  const pod = ctx.createdPods[0];
  assert.ok(pod !== undefined);
  assert.equal(pod.namespace, "persai-dev");
  assert.equal(pod.body.spec?.runtimeClassName, "gvisor");
  assert.equal(pod.body.spec?.nodeSelector?.["workload"], "sandbox");
  assert.equal(pod.body.spec?.serviceAccountName, "sandbox-exec-sa");
  assert.equal(pod.body.spec?.automountServiceAccountToken, false);
  assert.equal(pod.body.spec?.restartPolicy, "Never");
  assert.equal(pod.body.metadata?.labels?.["persai.io/sandbox-egress"], "restricted");
  assert.equal(pod.body.metadata?.annotations?.["persai.io/sandbox-egress"], "restricted");
  const container = pod.body.spec?.containers?.[0];
  assert.ok(container !== undefined);
  assert.equal(container.image, "busybox:1.36");
  assert.deepEqual(container.env, []);
  assert.equal(container.securityContext?.allowPrivilegeEscalation, false);
  assert.equal(container.securityContext?.readOnlyRootFilesystem, true);
  assert.deepEqual(container.securityContext?.capabilities?.drop, ["ALL"]);
  assert.equal(pod.body.spec?.securityContext?.runAsNonRoot, true);
  const workspaceMount = container.volumeMounts?.find((vm) => vm.mountPath === "/workspace");
  assert.ok(workspaceMount !== undefined, "must have /workspace volumeMount");
  const tmpMount = container.volumeMounts?.find((vm) => vm.mountPath === "/tmp");
  assert.ok(tmpMount !== undefined, "must have /tmp volumeMount");
  assert.equal(container.resources?.requests?.memory, "256Mi");
  assert.equal(container.resources?.limits?.memory, "1024Mi");
  const workspaceVolume = pod.body.spec?.volumes?.find((volume) => volume.name === "workspace");
  assert.equal(workspaceVolume?.emptyDir?.sizeLimit, "512Mi");
  const tmpVolume = pod.body.spec?.volumes?.find((volume) => volume.name === "tmp");
  assert.equal(tmpVolume?.emptyDir?.sizeLimit, "512Mi");
});

test("ExecPodBridgeService: waitForPodRunning succeeds when pod reaches Running", async () => {
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Pending", "Pending", "Running"],
    execResponses: [],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  (
    bridge as unknown as {
      k8sApi: { __seedLivePod(name: string, body: V1Pod): void };
    }
  ).k8sApi.__seedLivePod("exec-test", {
    metadata: { name: "exec-test" }
  });
  const access = bridge as unknown as {
    waitForPodRunning(podName: string, namespace: string, timeoutMs: number): Promise<void>;
  };

  await assert.doesNotReject(() => access.waitForPodRunning("exec-test", "persai-dev", 5_000));
});

test("ExecPodBridgeService: waitForPodRunning throws on terminal phase", async () => {
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Pending", "Failed"],
    execResponses: [],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  (
    bridge as unknown as {
      k8sApi: { __seedLivePod(name: string, body: V1Pod): void };
    }
  ).k8sApi.__seedLivePod("exec-test", {
    metadata: { name: "exec-test" }
  });
  const access = bridge as unknown as {
    waitForPodRunning(podName: string, namespace: string, timeoutMs: number): Promise<void>;
  };

  await assert.rejects(
    () => access.waitForPodRunning("exec-test", "persai-dev", 5_000),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(/terminal phase/i.test(error.message));
      return true;
    }
  );
});

test("ExecPodBridgeService: session-scoped pod name is stable across calls with same jobId", () => {
  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  const access = bridge as unknown as { buildPodName(jobId: string): string };

  const jobId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const name = access.buildPodName(jobId);
  assert.equal(access.buildPodName(jobId), name);

  const otherName = access.buildPodName("00000000-0000-0000-0000-000000000001");
  assert.notEqual(name, otherName, "different jobIds must produce different pod names");
});

test("ExecPodBridgeService: createExecPod injects proxy env vars when proxy URL is set", async () => {
  const proxyUrl = "http://sandbox-egress-proxy.persai-dev.svc.cluster.local:3128";
  const noProxy =
    "localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.svc.cluster.local,.cluster.local";
  const configWithProxy: SandboxConfig = {
    ...createConfig(),
    SANDBOX_EXEC_EGRESS_PROXY_URL: proxyUrl,
    SANDBOX_EXEC_NO_PROXY: noProxy
  };

  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" }
    ],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = new ExecPodBridgeService(configWithProxy, createMockPrisma() as never);
  (bridge as unknown as { kc: KubeConfigLike }).kc = {
    loadFromCluster() {},
    makeApiClient() {
      return {
        async createNamespacedPod(params: { namespace: string; body: V1Pod }) {
          ctx.createdPods.push({ namespace: params.namespace, body: params.body });
          return params.body as never;
        },
        async readNamespacedPod() {
          return { status: { phase: "Running" } } as never;
        },
        async deleteNamespacedPod(params: { name: string; namespace: string }) {
          ctx.deletedPods.push(params.name);
          return {} as never;
        }
      } as never;
    }
  };
  (bridge as unknown as { k8sApi: unknown }).k8sApi = {
    async createNamespacedPod(params: { namespace: string; body: V1Pod }) {
      ctx.createdPods.push({ namespace: params.namespace, body: params.body });
      return params.body as never;
    },
    async readNamespacedPod() {
      return { status: { phase: "Running" } } as never;
    },
    async deleteNamespacedPod(params: { name: string; namespace: string }) {
      ctx.deletedPods.push(params.name);
      return {} as never;
    }
  };

  const access = bridge as unknown as {
    createExecPod(
      podName: string,
      namespace: string,
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY,
      egressMode: "restricted" | "full_public"
    ): Promise<void>;
  };

  await access.createExecPod(
    "exec-testproxy",
    "persai-dev",
    {
      ...DEFAULT_RUNTIME_SANDBOX_POLICY,
      enabled: true
    },
    "restricted"
  );

  assert.equal(ctx.createdPods.length, 1);
  const pod = ctx.createdPods[0];
  assert.ok(pod !== undefined);
  const container = pod.body.spec?.containers?.[0];
  assert.ok(container !== undefined);

  const env = container.env ?? [];
  const envMap = Object.fromEntries(env.map((e) => [e.name, e.value]));

  assert.equal(envMap["HTTP_PROXY"], proxyUrl, "HTTP_PROXY must be the proxy URL");
  assert.equal(envMap["HTTPS_PROXY"], proxyUrl, "HTTPS_PROXY must be the proxy URL");
  assert.equal(envMap["http_proxy"], proxyUrl, "http_proxy must be the proxy URL");
  assert.equal(envMap["https_proxy"], proxyUrl, "https_proxy must be the proxy URL");
  assert.equal(envMap["NO_PROXY"], noProxy, "NO_PROXY must be set");
  assert.equal(envMap["no_proxy"], noProxy, "no_proxy must be set");
  assert.equal(env.length, 6, "exactly 6 proxy env vars when proxy URL and NO_PROXY are both set");
});

test("ExecPodBridgeService: buildSessionPodName derives stable k8s-safe name from assistant+workspace", () => {
  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  const access = bridge as unknown as {
    buildSessionPodName(assistantId: string, workspaceId: string): string;
  };

  const assistantId = "assistant-abc-123";
  const workspaceId = "workspace-def-456";
  const name1 = access.buildSessionPodName(assistantId, workspaceId);
  const name2 = access.buildSessionPodName(assistantId, workspaceId);
  assert.equal(name1, name2, "same assistant+workspace must produce same pod name");
  assert.ok(name1.startsWith("ses-"), "session pod name must start with ses-");
  assert.ok(name1.length <= 63, "pod name must fit k8s 63-char limit");
  assert.ok(/^[a-z0-9-]+$/.test(name1), "pod name must be lowercase alphanumeric/hyphens");

  const otherName = access.buildSessionPodName(assistantId, "workspace-other-999");
  assert.notEqual(name1, otherName, "different workspace must produce different pod names");
  assert.notEqual(
    name1,
    access.buildSessionPodName("assistant-other-999", workspaceId),
    "different assistant must produce different pod names"
  );
});

test("ExecPodBridgeService: buildSessionPodName is distinct from buildPodName (no collisions)", () => {
  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  const access = bridge as unknown as {
    buildSessionPodName(assistantId: string, workspaceId: string): string;
    buildPodName(jobId: string): string;
  };

  const sessionName = access.buildSessionPodName("abc123", "ws123");
  const ephemeralName = access.buildPodName("abc123-e29b-41d4-a716-446655440000");
  assert.notEqual(sessionName, ephemeralName, "session and ephemeral pod names must not collide");
  assert.ok(sessionName.startsWith("ses-"));
  assert.ok(ephemeralName.startsWith("exec-"));
});

test("ExecPodBridgeService: workspace push stdin is chunked instead of one huge WebSocket frame", async () => {
  // Live regression (persai-dev): a 52,582,400-byte workspace tar sent as
  // Readable.from([tarball]) arrived in the exec pod as 0 bytes; the same tar
  // split into 64 KiB chunks arrived byte-for-byte and `tar -tf` passed.
  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  const access = bridge as unknown as {
    readBufferInChunks(buffer: Buffer, chunkBytes: number): AsyncIterable<Buffer>;
  };
  const buffer = Buffer.alloc(200_000, 7);
  const chunks: Buffer[] = [];

  for await (const chunk of access.readBufferInChunks(buffer, 64 * 1024)) {
    chunks.push(Buffer.from(chunk));
  }

  assert.ok(chunks.length > 1, "large push payload must be split across multiple chunks");
  assert.ok(
    chunks.every((chunk) => chunk.length <= 64 * 1024),
    "no emitted chunk may exceed the WebSocket-safe push chunk size"
  );
  assert.deepEqual(
    Buffer.concat(chunks),
    buffer,
    "chunked push stream must preserve bytes exactly"
  );
});

test("ExecPodBridgeService: sessionless runInPod leaves retirement to job lifecycle", async () => {
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" }
    ],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-bridge-test-"));
  try {
    await fs.writeFile(join(workspaceRoot, "test.txt"), "hello", "utf8");
    await bridge.runInPod({
      jobId: "job-001",
      leaseToken: "lease-job-001",
      leaseHolderId: "holder-test",
      runtimeSessionId: null,
      assistantId: "assistant-eph",
      assistantHandle: "test-handle",
      siblingHandles: [],
      workspaceId: "workspace-eph",
      workspaceRoot,
      absoluteCwd: workspaceRoot,
      command: "/bin/sh",
      args: ["-c", "echo hi"],
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
    });
  } finally {
    await removePathWithRetries(workspaceRoot);
  }

  assert.equal(ctx.createdPods.length, 1, "must create exactly one pod");
  assert.ok(
    ctx.createdPods[0]?.body.metadata?.name?.startsWith("exec-"),
    "pod name must start exec-"
  );
  assert.deepEqual(
    ctx.createdPods[0]?.body.spec?.containers?.[0]?.command,
    ["/usr/bin/tini", "-g", "--", "sleep", "infinity"],
    "persistent exec pod must start under tini for child reaping"
  );
  assert.equal(ctx.deletedPods.length, 0, "pod must remain until outputs and job state persist");
});

test("ExecPodBridgeService: ephemeral workspace push preserves hierarchical tree and extracts by entry name with --no-same-owner", async () => {
  // Regression: extracting a "." member made the remote tar restore mode/utime on
  // /workspace itself, which the non-root exec user cannot do, failing every push with
  // "Cannot change mode/utime: Operation not permitted". The push must archive top-level
  // entries by name (so no "." member is ever extracted) and pass --no-same-owner.
  // Session pods never push — only ephemeral pods use pushWorkspace.
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" }
    ],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-bridge-push-"));
  const sessionRoot = join(workspaceRoot, "assistants", "test-handle", "sessions", "session-1");
  try {
    await fs.mkdir(join(sessionRoot, "sub"), { recursive: true });
    await fs.writeFile(join(sessionRoot, "report.txt"), "hello", "utf8");
    await fs.writeFile(join(sessionRoot, "sub", "nested.txt"), "data", "utf8");
    await bridge.runInPod({
      jobId: "job-push-001",
      leaseToken: "lease-job-push-001",
      leaseHolderId: "holder-test",
      runtimeSessionId: null,
      assistantId: "assistant-push",
      assistantHandle: "test-handle",
      siblingHandles: [],
      workspaceId: "workspace-push",
      workspaceRoot,
      absoluteCwd: sessionRoot,
      command: "/bin/sh",
      args: ["-c", "echo hi"],
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
    });
  } finally {
    await removePathWithRetries(workspaceRoot);
  }

  const pushCommand = ctx.execCommands.find((command) =>
    command.some((part) => part.includes("-xf") && part.includes("/workspace"))
  );
  assert.ok(pushCommand !== undefined, "a workspace push (tar -xf) command must run");
  const pushScript = pushCommand.find((part) => part.includes("-xf")) ?? "";
  assert.ok(
    pushScript.includes("--no-same-owner"),
    "push must pass --no-same-owner so it does not fail trying to chown into /workspace"
  );
  assert.ok(
    pushScript.includes("tar --no-same-owner -xf - -C /workspace"),
    "push must extract from stdin into /workspace by entry name (never a '.' member)"
  );
  assert.ok(
    !/-xf\s+-\s+-C\s+\/workspace\s+\./.test(pushScript),
    "push must never extract a '.' member"
  );
  const commandExec = ctx.execCommands.find((command) =>
    command.some((part) => part.includes("echo hi"))
  );
  const shell = commandExec?.[2] ?? "";
  assert.ok(
    shell.includes("cd '/workspace/assistants/test-handle/sessions/session-1'") ||
      shell.includes("cd '/workspace'"),
    "command cwd must stay inside the workspace"
  );
});

test("ExecPodBridgeService: session runInPod does not push workspace tree before exec", async () => {
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [
      { exitCode: 0, stdout: "", stderr: "" } // bootstrap probe
    ],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-bridge-session-nopush-"));
  const sessionRoot = join(workspaceRoot, "assistants", "assistant-1", "sessions", "session-1");
  try {
    await fs.mkdir(sessionRoot, { recursive: true });
    await fs.writeFile(join(sessionRoot, "stale.txt"), "OLD", "utf8");
    await bridge.runInPod({
      jobId: "job-session-nopush",
      leaseToken: "lease-job-session-nopush",
      leaseHolderId: "holder-test",
      runtimeSessionId: "session-1",
      assistantId: "assistant-1",
      assistantHandle: "test-handle",
      siblingHandles: [],
      workspaceId: "workspace-1",
      workspaceRoot,
      absoluteCwd: sessionRoot,
      command: "/bin/sh",
      args: ["-c", "echo hi"],
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
    });
  } finally {
    await removePathWithRetries(workspaceRoot);
  }

  const pushCommand = ctx.execCommands.find((command) =>
    command.some((part) => part.includes("-xf") && part.includes("/workspace"))
  );
  assert.equal(
    pushCommand,
    undefined,
    "session pod jobs must not push the control-plane workspace tree into the pod"
  );
  const commandExec = ctx.execCommands.find((command) =>
    command.some((part) => part.includes("echo hi"))
  );
  assert.ok(commandExec !== undefined, "the command must still run against the live pod");
});

test("ExecPodBridgeService: session runInPod guarantees the pod cwd exists before exec", async () => {
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [{ exitCode: 0, stdout: "", stderr: "" }],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-bridge-session-cwd-"));
  const nestedCwd = join(
    workspaceRoot,
    "assistants",
    "assistant-1",
    "sessions",
    "session-1",
    "reports"
  );
  try {
    await fs.mkdir(nestedCwd, { recursive: true });
    await bridge.runInPod({
      jobId: "job-session-cwd",
      leaseToken: "lease-job-session-cwd",
      leaseHolderId: "holder-test",
      runtimeSessionId: "session-1",
      assistantId: "assistant-1",
      assistantHandle: "test-handle",
      siblingHandles: [],
      workspaceId: "workspace-1",
      workspaceRoot,
      absoluteCwd: nestedCwd,
      command: "/bin/sh",
      args: ["-c", "echo hi"],
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
    });
  } finally {
    await removePathWithRetries(workspaceRoot);
  }

  const commandExec = ctx.execCommands.find((command) =>
    command.some((part) => part.includes("echo hi"))
  );
  const shell = commandExec?.[2] ?? "";
  assert.ok(
    shell.includes("mkdir -p '/workspace/assistants/assistant-1/sessions/session-1/reports'"),
    "session exec must create the pod cwd before changing into it"
  );
  assert.ok(
    shell.includes("cd '/workspace/assistants/assistant-1/sessions/session-1/reports'"),
    "session exec must still cd into the requested hierarchical cwd"
  );
  assert.ok(
    shell.includes("export HOME='/workspace/assistants/assistant-1/sessions/session-1'"),
    "session exec must move HOME into the canonical session root"
  );
  assert.ok(
    shell.includes(
      "export PYTHONUSERBASE='/workspace/assistants/assistant-1/sessions/session-1/.local'"
    ),
    "session exec must move PYTHONUSERBASE into the canonical session root"
  );
  assert.ok(
    shell.includes(
      "export NPM_CONFIG_PREFIX='/workspace/assistants/assistant-1/sessions/session-1/.npm-global'"
    ),
    "session exec must move npm global installs into the canonical session root"
  );
});

test("ExecPodBridgeService: later canonical session write is visible to the next shell run", async () => {
  const workspaceId = "ws-fresh-shell";
  const assistantId = "assistant-1";
  const runtimeSessionId = "session-1";
  const visibleSessionRoot = `/workspace/assistants/${assistantId}/sessions/${runtimeSessionId}`;
  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-bridge-fresh-shell-"));
  const sessionRoot = join(workspaceRoot, "assistants", assistantId, "sessions", runtimeSessionId);
  await fs.mkdir(sessionRoot, { recursive: true });

  const objectStorageKeys: string[] = [];
  const storedObjects = new Map<string, Buffer>();
  const podFiles = new Map<string, Buffer>();
  let hydratedSessionId: string | null = null;
  let podAnnotations: Record<string, string> = {
    "persai.io/sandbox-egress": "restricted",
    "persai.io/assistant-id": assistantId,
    "persai.io/workspace-id": workspaceId,
    "persai.io/assistant-handle": "test-handle"
  };

  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  Object.defineProperty(bridge, "objectStorage", {
    configurable: true,
    value: {
      buildWorkspacePrefix: ({
        workspaceId: currentWorkspaceId,
        subPath
      }: {
        workspaceId: string;
        subPath?: string;
      }) => {
        const base = `assistant-media/workspaces/${currentWorkspaceId}/workspace/`;
        if (subPath === undefined || subPath.length === 0) {
          return base;
        }
        return `${base}${subPath.replace(/\/+$/g, "")}/`;
      },
      buildWorkspaceObjectKey: ({
        workspaceId: currentWorkspaceId,
        workspaceRelPath
      }: {
        workspaceId: string;
        workspaceRelPath: string;
      }) => `assistant-media/workspaces/${currentWorkspaceId}${workspaceRelPath}`,
      listPrefix: async (prefix: string) =>
        objectStorageKeys.filter((key) => key.startsWith(prefix)),
      downloadObject: async (key: string) => {
        const buffer = storedObjects.get(key);
        if (buffer === undefined) {
          throw new Error(`missing object ${key}`);
        }
        return Buffer.from(buffer);
      }
    }
  });
  Object.defineProperty(bridge, "k8sApi", {
    configurable: true,
    value: {
      async readNamespacedPod() {
        return {
          status: { phase: "Running" },
          metadata: {
            uid: "uid-canonical-session",
            resourceVersion: "1",
            labels: {
              "app.kubernetes.io/component": "sandbox-exec",
              "persai.io/sandbox-egress": "restricted"
            },
            annotations: podAnnotations
          }
        } as never;
      },
      async createNamespacedPod() {
        return {} as never;
      },
      async deleteNamespacedPod() {
        return {} as never;
      },
      async replaceNamespacedPod(input: { body: V1Pod }) {
        podAnnotations = { ...(input.body.metadata?.annotations ?? {}) };
        return input.body as never;
      }
    }
  });
  Object.defineProperty(bridge, "pullWorkspace", {
    configurable: true,
    value: async () => undefined
  });
  Object.defineProperty(bridge, "runStdinlessProbe", {
    configurable: true,
    value: async () => true
  });
  const execCommandMock = async (
    _podName: string,
    _namespace: string,
    request: {
      command: string;
      args: string[];
      podCwd: string;
      stdin?: Buffer | null;
    }
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> => {
    const shell = request.args[1] ?? "";
    if (shell.includes("for proc in /proc/[0-9]*")) {
      return { exitCode: 0, stdout: "1,2", stderr: "" };
    }
    if (
      request.command === "/bin/sh" &&
      shell.includes("/tmp/.persai_workspace_hydrate_session") &&
      shell.includes("cat ") &&
      !shell.includes("cat >")
    ) {
      return { exitCode: 0, stdout: hydratedSessionId ?? "", stderr: "" };
    }
    if (
      shell.includes("/tmp/.persai_workspace_hydrate_session") &&
      request.stdin !== undefined &&
      request.stdin !== null
    ) {
      hydratedSessionId = request.stdin.toString("utf8");
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    const writeMatch = shell.match(/cat > '([^']+)'$/);
    if (writeMatch !== null) {
      podFiles.set(writeMatch[1]!, Buffer.from(request.stdin ?? Buffer.alloc(0)));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (
      request.command === "/bin/bash" &&
      request.args[0] === "-lc" &&
      request.args[1] === "cat report.txt"
    ) {
      const filePath = `${request.podCwd}/report.txt`;
      const bytes = podFiles.get(filePath);
      if (bytes === undefined) {
        return { exitCode: 1, stdout: "", stderr: "missing report.txt" };
      }
      return { exitCode: 0, stdout: bytes.toString("utf8"), stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  Object.defineProperty(bridge, "execCommand", {
    configurable: true,
    value: execCommandMock
  });
  Object.defineProperty(bridge, "execJobCommand", {
    configurable: true,
    value: async (
      podName: string,
      namespace: string,
      options: {
        command: string;
        args: string[];
        podCwd: string;
        policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY;
      }
    ) =>
      execCommandMock(podName, namespace, {
        command: options.command,
        args: options.args,
        podCwd: options.podCwd
      })
  });

  try {
    await bridge.runInPod({
      jobId: "job-empty-session",
      leaseToken: "lease-job-empty-session",
      leaseHolderId: "holder-test",
      runtimeSessionId,
      assistantId,
      assistantHandle: "test-handle",
      siblingHandles: [],
      workspaceId,
      workspaceRoot,
      absoluteCwd: sessionRoot,
      command: "/bin/bash",
      args: ["-lc", "true"],
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
    });
    assert.equal(
      hydratedSessionId,
      null,
      "an empty first session bootstrap must leave the hydrate marker unset"
    );

    const reportPath = `${visibleSessionRoot}/report.txt`;
    const objectKey = `assistant-media/workspaces/${workspaceId}${reportPath}`;
    objectStorageKeys.push(objectKey);
    storedObjects.set(objectKey, Buffer.from("hello from storage plane", "utf8"));

    const result = await bridge.runInPod({
      jobId: "job-empty-session",
      leaseToken: "lease-job-empty-session",
      leaseHolderId: "holder-test",
      runtimeSessionId,
      assistantId,
      assistantHandle: "test-handle",
      siblingHandles: [],
      workspaceId,
      workspaceRoot,
      absoluteCwd: sessionRoot,
      command: "/bin/bash",
      args: ["-lc", "cat report.txt"],
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "hello from storage plane");
    assert.equal(hydratedSessionId, runtimeSessionId);
  } finally {
    await removePathWithRetries(workspaceRoot);
  }
});

test("ExecPodBridgeService: session runInPod writes staging files directly into the pod", async () => {
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [{ exitCode: 0, stdout: "", stderr: "" }],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-bridge-session-staging-"));
  const sessionRoot = join(workspaceRoot, "assistants", "assistant-1", "sessions", "session-1");
  try {
    await fs.mkdir(sessionRoot, { recursive: true });
    await bridge.runInPod({
      jobId: "job-session-staging",
      leaseToken: "lease-job-session-staging",
      leaseHolderId: "holder-test",
      runtimeSessionId: "session-1",
      assistantId: "assistant-1",
      assistantHandle: "test-handle",
      siblingHandles: [],
      workspaceId: "workspace-1",
      workspaceRoot,
      absoluteCwd: sessionRoot,
      command: "/bin/sh",
      args: ["-c", "echo staged"],
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
      stagingFiles: [
        {
          absolutePath: "/workspace/assistants/assistant-1/sessions/session-1/.job-input.txt",
          contents: Buffer.from("STAGED_BYTES", "utf8")
        }
      ]
    });
  } finally {
    await removePathWithRetries(workspaceRoot);
  }

  const stagingWrite = ctx.execCommands.find((command) => {
    const shell = command.find((part) => part.includes("cat >")) ?? "";
    return shell.includes(".job-input.txt");
  });
  assert.ok(stagingWrite !== undefined, "staging files must be written directly into the pod");
  assert.ok(
    !ctx.execCommands.some((command) =>
      command.some((part) => part.includes("-xf") && part.includes("/workspace"))
    ),
    "staging must not rely on a workspace push"
  );
});

test("ExecPodBridgeService: workspace push success comes from the stdin-less verify, not the push channel", async () => {
  // Root regression (live-cluster verified): @kubernetes/client-node drops the exec
  // stdout channel and races the status frame when a non-trivial payload is streamed
  // on stdin, so the push exec's own return is unusable. Success MUST be asserted by
  // the separate stdin-less verify probe. Here the push exec succeeds but the
  // verify exec reports the marker missing (exit 1) → the whole push must fail
  // as a retryable spawn failure, and the command/pull must never run.
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [
      // Phase 1 marker check → exit 0 → alreadyBootstrapped=true → skip Phase 2/2b/3/4
      { exitCode: 0, stdout: "", stderr: "" }, // ensureWorkspaceMountBootstrapped probe
      { exitCode: 0, stdout: "", stderr: "" }, // execWorkspaceTarPush (exit code ignored)
      { exitCode: 1, stdout: "", stderr: "" } // verifyWorkspacePushed → marker missing
    ],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-bridge-verify-"));
  try {
    await fs.writeFile(join(workspaceRoot, "report.txt"), "hello", "utf8");
    await assert.rejects(
      bridge.runInPod({
        jobId: "job-verify-001",
        leaseToken: "lease-job-verify-001",
        leaseHolderId: "holder-test",
        runtimeSessionId: null,
        assistantId: "assistant-verify",
        assistantHandle: "test-handle",
        siblingHandles: [],
        workspaceId: "workspace-verify",
        workspaceRoot,
        absoluteCwd: workspaceRoot,
        command: "/bin/sh",
        args: ["-c", "echo hi"],
        policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
      }),
      /verification failed/
    );
  } finally {
    await removePathWithRetries(workspaceRoot);
  }

  const verifyCommand = ctx.execCommands.find((command) =>
    command.some((part) => part.includes("test -f") && part.includes(".persai_push_ok"))
  );
  assert.ok(verifyCommand !== undefined, "a stdin-less verify probe must run after the push");
  assert.ok(
    !ctx.execCommands.some((command) => command.some((part) => part.includes("echo hi"))),
    "the command must not run when the workspace push verification fails"
  );
});

test("ExecPodBridgeService: next lease recycles stale annotated UID before execution", async () => {
  const createdPods: string[] = [];
  const deletedPods: string[] = [];
  let generation = 0;
  let livePod: V1Pod | null = null;

  const mockCoreV1Api = {
    async createNamespacedPod(params: { namespace: string; body: V1Pod }) {
      createdPods.push(params.body.metadata?.name ?? "");
      generation += 1;
      livePod = {
        ...structuredClone(params.body),
        metadata: {
          ...params.body.metadata,
          uid: `uid-generation-${generation}`,
          resourceVersion: "1"
        }
      };
      return livePod as never;
    },
    async readNamespacedPod() {
      if (livePod === null) {
        const err = Object.assign(new Error("pod not found"), { statusCode: 404 });
        throw err;
      }
      return { ...structuredClone(livePod), status: { phase: "Running" } } as never;
    },
    async deleteNamespacedPod(params: { name: string }) {
      deletedPods.push(params.name);
      livePod = null;
      return {} as never;
    },
    async replaceNamespacedPod(params: { body: V1Pod }) {
      livePod = {
        ...structuredClone(params.body),
        metadata: {
          ...params.body.metadata,
          resourceVersion: String(Number(params.body.metadata?.resourceVersion ?? "1") + 1)
        }
      };
      return livePod as never;
    }
  };

  const mockExec = {
    exec(
      _namespace: string,
      _podName: string,
      _containerName: string,
      command: string[],
      stdout: { write(chunk: string): boolean } | null,
      _stderr: unknown,
      _stdin: unknown,
      _tty: boolean,
      statusCallback?: (status: { status: string }) => void
    ) {
      const ws = { on: () => undefined };
      Promise.resolve().then(() => {
        if (stdout !== null && isBaselineProcessProbe(command)) {
          stdout.write("1,2");
        } else if (stdout !== null && isWorkspacePull(command)) {
          stdout.write(VALID_EMPTY_TAR);
        }
        if (statusCallback !== undefined) {
          statusCallback({ status: "Success" });
        }
      });
      return Promise.resolve(ws as never);
    }
  };

  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  (bridge as unknown as { k8sApi: unknown }).k8sApi = mockCoreV1Api;
  (bridge as unknown as { execApi: unknown }).execApi = mockExec;

  const sessionId = "session-reuse-test";
  const assistantId = "assistant-reuse";
  const workspaceId = "workspace-reuse";
  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-bridge-session-"));
  try {
    await fs.writeFile(join(workspaceRoot, "test.txt"), "data", "utf8");

    // First job: pod doesn't exist, must create.
    await bridge.runInPod({
      jobId: "job-s1",
      leaseToken: "lease-job-s1",
      leaseHolderId: "holder-test",
      runtimeSessionId: sessionId,
      assistantId,
      assistantHandle: "test-handle",
      siblingHandles: [],
      workspaceId,
      workspaceRoot,
      absoluteCwd: workspaceRoot,
      command: "/bin/sh",
      args: ["-c", "echo first"],
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
    });

    // Second job has a new lease token, so the first generation is contamination.
    await bridge.runInPod({
      jobId: "job-s2",
      leaseToken: "lease-job-s2",
      leaseHolderId: "holder-test",
      runtimeSessionId: sessionId,
      assistantId,
      assistantHandle: "test-handle",
      siblingHandles: [],
      workspaceId,
      workspaceRoot,
      absoluteCwd: workspaceRoot,
      command: "/bin/sh",
      args: ["-c", "echo second"],
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
    });

    assert.equal(createdPods.length, 2, "new lease must create a clean generation");
    assert.equal(deletedPods.length, 1, "stale annotated UID must be retired once");
  } finally {
    await removePathWithRetries(workspaceRoot);
  }
});

test("ExecPodBridgeService: reaper evicts idle pods by cluster truth + DB activity", async () => {
  // Cluster-truth reaper: lists live exec pods and derives last-activity from the
  // sandboxJob table by assistant+workspace annotations. This survives control-plane
  // restarts and works across replicas (the old in-memory map leaked both cases).
  const now = Date.now();
  const idleTtlMs = createConfig().SANDBOX_EXEC_SESSION_IDLE_TTL_MS;
  const oldTs = new Date(now - idleTtlMs - 600_000);
  const deletedPods: string[] = [];

  const mockCoreV1Api = {
    async listNamespacedPod() {
      return {
        items: [
          {
            metadata: {
              name: "ses-stale",
              uid: "uid-ses-stale",
              resourceVersion: "1",
              creationTimestamp: oldTs,
              annotations: {
                "persai.io/assistant-id": "a-stale",
                "persai.io/workspace-id": "w-stale"
              }
            }
          },
          {
            metadata: {
              name: "ses-active",
              uid: "uid-ses-active",
              resourceVersion: "1",
              creationTimestamp: oldTs,
              annotations: {
                "persai.io/assistant-id": "a-active",
                "persai.io/workspace-id": "w-active"
              }
            }
          },
          // Ephemeral orphan: no workspace annotations, old creation → evicted by age.
          {
            metadata: {
              name: "exec-orphan",
              uid: "uid-exec-orphan",
              resourceVersion: "1",
              creationTimestamp: oldTs
            }
          }
        ]
      } as never;
    },
    async deleteNamespacedPod(params: { name: string }) {
      deletedPods.push(params.name);
      return {} as never;
    },
    async readNamespacedPod(params: { name: string }) {
      if (deletedPods.includes(params.name)) {
        throw Object.assign(new Error("not found"), { code: 404 });
      }
      return { metadata: { uid: `uid-${params.name}` } } as never;
    }
  };

  const prisma = createMockPrisma({
    "a-stale:w-stale": {
      createdAt: new Date(now - idleTtlMs - 120_000),
      completedAt: new Date(now - idleTtlMs - 100_000)
    },
    "a-active:w-active": { createdAt: new Date(now - 5_000), completedAt: null }
  });

  const bridge = new ExecPodBridgeService(createConfig(), prisma as never);
  (bridge as unknown as { k8sApi: unknown }).k8sApi = mockCoreV1Api;

  await bridge.runReaperTick();

  assert.ok(deletedPods.includes("ses-stale"), "idle workspace pod must be evicted");
  assert.ok(deletedPods.includes("exec-orphan"), "old ephemeral orphan must be evicted");
  assert.ok(!deletedPods.includes("ses-active"), "workspace with a fresh job must be kept");
  assert.equal(deletedPods.length, 2, "exactly the two idle pods are evicted");
});

test("ExecPodBridgeService: reaper keeps pods when activity is fresh", async () => {
  const now = Date.now();
  const deletedPods: string[] = [];
  const mockCoreV1Api = {
    async listNamespacedPod() {
      return {
        items: [
          {
            metadata: {
              name: "ses-recent",
              uid: "uid-ses-recent",
              resourceVersion: "1",
              creationTimestamp: new Date(now - 5_000),
              annotations: {
                "persai.io/assistant-id": "a-recent",
                "persai.io/workspace-id": "w-recent"
              }
            }
          }
        ]
      } as never;
    },
    async deleteNamespacedPod(params: { name: string }) {
      deletedPods.push(params.name);
      return {} as never;
    }
  };
  const prisma = createMockPrisma({
    "a-recent:w-recent": { createdAt: new Date(now - 1_000), completedAt: null }
  });
  const bridge = new ExecPodBridgeService(createConfig(), prisma as never);
  (bridge as unknown as { k8sApi: unknown }).k8sApi = mockCoreV1Api;

  await bridge.runReaperTick();

  assert.equal(deletedPods.length, 0, "no pods should be evicted when activity is fresh");
});

test("ExecPodBridgeService: reaper does not evict when activity lookup fails", async () => {
  // If we cannot determine activity for an annotated pod, we must not risk evicting
  // a live session pod.
  const now = Date.now();
  const idleTtlMs = createConfig().SANDBOX_EXEC_SESSION_IDLE_TTL_MS;
  const deletedPods: string[] = [];
  const mockCoreV1Api = {
    async listNamespacedPod() {
      return {
        items: [
          {
            metadata: {
              name: "ses-unknown",
              uid: "uid-ses-unknown",
              resourceVersion: "1",
              creationTimestamp: new Date(now - idleTtlMs - 600_000),
              annotations: {
                "persai.io/assistant-id": "a-unknown",
                "persai.io/workspace-id": "w-unknown"
              }
            }
          }
        ]
      } as never;
    },
    async deleteNamespacedPod(params: { name: string }) {
      deletedPods.push(params.name);
      return {} as never;
    }
  };
  const prisma = {
    sandboxJob: {
      findFirst: async () => {
        throw new Error("db unavailable");
      }
    }
  };
  const bridge = new ExecPodBridgeService(createConfig(), prisma as never);
  (bridge as unknown as { k8sApi: unknown }).k8sApi = mockCoreV1Api;

  await bridge.runReaperTick();

  assert.equal(deletedPods.length, 0, "must not evict when activity cannot be determined");
});

test("ExecPodBridgeService: warmSessionPod creates session pod when absent and returns alreadyRunning=false", async () => {
  let readCallCount = 0;
  const createdPods: string[] = [];

  const mockCoreV1Api = {
    async createNamespacedPod(params: { namespace: string; body: V1Pod }) {
      createdPods.push(params.body.metadata?.name ?? "");
      return params.body as never;
    },
    async readNamespacedPod() {
      readCallCount += 1;
      if (readCallCount === 1) {
        // First read: pod not found → triggers create path.
        const err = Object.assign(new Error("pod not found"), { statusCode: 404 });
        throw err;
      }
      // After create: pod is Running with egress metadata.
      return labeledRunningPod({
        assistantId: "assistant-warm-1",
        workspaceId: "workspace-warm-1",
        handle: "test-handle"
      }) as never;
    },
    async deleteNamespacedPod(params: { name: string }) {
      return params as never;
    }
  };

  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  (bridge as unknown as { k8sApi: unknown }).k8sApi = mockCoreV1Api;

  const result = await bridge.warmSessionPod({
    assistantId: "assistant-warm-1",
    assistantHandle: "test-handle",
    workspaceId: "workspace-warm-1",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
  });

  assert.ok(result.podName.startsWith("ses-"), "warm pod name must start with ses-");
  assert.equal(result.alreadyRunning, false, "alreadyRunning must be false when pod was created");
  assert.equal(createdPods.length, 1, "must create exactly one pod");
  assert.equal(createdPods[0], result.podName);
});

test("ExecPodBridgeService: warmSessionPod skips create when pod is already Running", async () => {
  const createdPods: string[] = [];

  const mockCoreV1Api = {
    async createNamespacedPod(params: { namespace: string; body: V1Pod }) {
      createdPods.push(params.body.metadata?.name ?? "");
      return params.body as never;
    },
    async readNamespacedPod() {
      return labeledRunningPod({
        assistantId: "assistant-warm-2",
        workspaceId: "workspace-warm-2",
        handle: "test-handle"
      }) as never;
    },
    async deleteNamespacedPod(params: { name: string }) {
      return params as never;
    }
  };

  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  (bridge as unknown as { k8sApi: unknown }).k8sApi = mockCoreV1Api;

  const result = await bridge.warmSessionPod({
    assistantId: "assistant-warm-2",
    assistantHandle: "test-handle",
    workspaceId: "workspace-warm-2",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
  });

  assert.equal(
    result.alreadyRunning,
    true,
    "alreadyRunning must be true when pod was already Running"
  );
  assert.equal(
    createdPods.length,
    0,
    "must NOT call createNamespacedPod when pod is already Running"
  );
  assert.ok(result.podName.startsWith("ses-"), "pod name must start with ses-");
});

test("ExecPodBridgeService: warmSessionPod tolerates 409 Conflict from concurrent create", async () => {
  let readCallCount = 0;

  const mockCoreV1Api = {
    async createNamespacedPod(params: { namespace: string; body: V1Pod }) {
      // Simulate 409: another caller already created the pod concurrently.
      const err = Object.assign(new Error("pod already exists"), { statusCode: 409 });
      throw err;
      return params.body as never;
    },
    async readNamespacedPod() {
      readCallCount += 1;
      if (readCallCount === 1) {
        // First read: pod not found → triggers create attempt.
        const err = Object.assign(new Error("pod not found"), { statusCode: 404 });
        throw err;
      }
      // After the 409-tolerant create falls through: concurrent caller left a
      // correctly labelled Running pod.
      return labeledRunningPod({
        assistantId: "assistant-warm-3",
        workspaceId: "workspace-warm-3",
        handle: "test-handle"
      }) as never;
    },
    async deleteNamespacedPod(params: { name: string }) {
      return params as never;
    }
  };

  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  (bridge as unknown as { k8sApi: unknown }).k8sApi = mockCoreV1Api;

  // Must NOT throw even though createNamespacedPod returns 409.
  const result = await bridge.warmSessionPod({
    assistantId: "assistant-warm-3",
    assistantHandle: "test-handle",
    workspaceId: "workspace-warm-3",
    policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
  });

  assert.equal(
    result.alreadyRunning,
    false,
    "alreadyRunning must be false when create was 409 (another caller created it, not us)"
  );
  assert.ok(result.podName.startsWith("ses-"), "pod name must start with ses-");
});

test("ExecPodBridgeService: createExecPod injects no env vars when proxy URL is empty", async () => {
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" }
    ],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  const access = bridge as unknown as {
    createExecPod(
      podName: string,
      namespace: string,
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY,
      egressMode: "restricted" | "full_public"
    ): Promise<void>;
  };

  await access.createExecPod(
    "exec-noproxy",
    "persai-dev",
    {
      ...DEFAULT_RUNTIME_SANDBOX_POLICY,
      enabled: true
    },
    "restricted"
  );

  assert.equal(ctx.createdPods.length, 1);
  const pod = ctx.createdPods[0];
  assert.ok(pod !== undefined);
  const container = pod.body.spec?.containers?.[0];
  assert.ok(container !== undefined);
  assert.deepEqual(container.env, [], "env must be empty when proxy URL is not configured");
});

test("ExecPodBridgeService: removeWorkspaceFileFromWarmPods rm's each warm pod", async () => {
  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  const execCalls: Array<{ podName: string; shellCommand: string }> = [];
  Object.defineProperty(bridge, "k8sApi", {
    configurable: true,
    value: {
      async listNamespacedPod() {
        return {
          items: [
            {
              metadata: {
                name: "ses-pod-1",
                uid: "uid-ses-pod-1",
                labels: { "persai.io/sandbox-egress": "restricted" },
                annotations: {
                  "persai.io/workspace-id": "ws-rm",
                  "persai.io/assistant-id": "assistant-1",
                  "persai.io/assistant-handle": "bot-one",
                  "persai.io/sandbox-egress": "restricted"
                }
              },
              status: { phase: "Running" }
            }
          ]
        };
      }
    }
  });
  Object.defineProperty(bridge, "execCommand", {
    configurable: true,
    value: async (
      podName: string,
      _namespace: string,
      request: { args: string[] }
    ): Promise<{ exitCode: number | null }> => {
      execCalls.push({ podName, shellCommand: request.args[1] ?? "" });
      return { exitCode: 0 };
    }
  });

  const result = await bridge.removeWorkspaceFileFromWarmPods({
    workspaceId: "ws-rm",
    path: "/workspace/report.txt"
  });

  assert.equal(result.removedFromPods, 1);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(execCalls, [
    {
      podName: "ses-pod-1",
      shellCommand: "rm -f -- '/workspace/report.txt'"
    }
  ]);
});

test("ExecPodBridgeService: removeWorkspaceFileFromWarmPods returns zero when no warm pod exists", async () => {
  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  Object.defineProperty(bridge, "k8sApi", {
    configurable: true,
    value: {
      async listNamespacedPod() {
        return { items: [] };
      }
    }
  });

  const result = await bridge.removeWorkspaceFileFromWarmPods({
    workspaceId: "ws-empty",
    path: "/workspace/missing.txt"
  });

  assert.equal(result.removedFromPods, 0);
  assert.deepEqual(result.failures, []);
});

test("ExecPodBridgeService: cold-start runInPod bootstraps only the writable workspace mount", async () => {
  // Phase 1 returns false (exitCode: 1 + no sentinel) so cold bootstrap runs.
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [
      { exitCode: 1, stdout: "", stderr: "" }, // Phase 1 marker check → false → cold bootstrap
      { exitCode: 0, stdout: "", stderr: "" }, // Phase 2 dirs script → ok
      { exitCode: 0, stdout: "", stderr: "" } // Phase 4 chmod + marker script → ok
      // workspace push, verify, command, pull → unseeded → default success
    ],
    deletedPods: [],
    execCallCount: 0,
    execCommands: []
  };

  const bridge = buildMockBridge(ctx);
  const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "persai-bridge-cold-"));
  const workspaceId = "c3d4e5f6-a7b8-9012-cdef-123456789012";
  try {
    await fs.writeFile(join(workspaceRoot, "file.txt"), "data", "utf8");
    await bridge.runInPod({
      jobId: "job-cold-001",
      leaseToken: "lease-job-cold-001",
      leaseHolderId: "holder-test",
      runtimeSessionId: null,
      assistantId: "assistant-cold",
      assistantHandle: "cold-handle",
      siblingHandles: [],
      workspaceId,
      workspaceRoot,
      absoluteCwd: workspaceRoot,
      command: "/bin/sh",
      args: ["-c", "echo cold"],
      policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true }
    });
  } finally {
    await removePathWithRetries(workspaceRoot);
  }

  assert.ok(ctx.execCallCount >= 3, "cold bootstrap must fire marker, dirs, and bootstrap execs");
  const dirsExec = ctx.execCommands.find((command) =>
    command.some((part) => part.includes("test -d '/workspace'"))
  );
  assert.ok(dirsExec !== undefined, "dirs exec must verify /workspace exists and is writable");
  const dirsScript = dirsExec?.find((part) => part.includes("test -d")) ?? "";
  assert.ok(dirsScript.includes("test -w '/workspace'"));
  assert.ok(!dirsScript.includes("chmod 0755 '/workspace'"));
  assert.ok(!dirsScript.includes("ln -sfn"), "bootstrap must not create symlink aliases");
  assert.ok(
    !dirsScript.includes("/workspace/assistants/"),
    "bootstrap must not hardcode assistant/session subdirs; hydrate/push materialize the tree"
  );
});

void test("LimitedCollector stops retaining chunks once the byte limit is crossed, while still draining", async () => {
  const limitBytes = 1_000;
  const collector = new LimitedCollector(
    limitBytes,
    "stdout_limit_exceeded",
    `Sandbox stdout exceeded ${String(limitBytes)} bytes.`
  );

  const chunk = Buffer.alloc(200, "a");
  const totalChunks = 500; // 100,000 bytes written; far beyond the 1,000-byte limit.
  for (let i = 0; i < totalChunks; i += 1) {
    await new Promise<void>((resolve, reject) => {
      collector.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  }

  assert.ok(collector.limitError !== null, "limit must be flagged once crossed");
  assert.equal(collector.limitError?.code, "stdout_limit_exceeded");

  assert.equal(collector.collect().length, limitBytes);
});

void test("LimitedCollector retains at most limitBytes when one chunk is oversized", async () => {
  const collector = new LimitedCollector(
    1_000,
    "stdout_limit_exceeded",
    "Sandbox stdout exceeded 1000 bytes."
  );
  await new Promise<void>((resolve, reject) => {
    collector.write(Buffer.alloc(100_000, "x"), (error) => (error ? reject(error) : resolve()));
  });
  assert.equal(collector.limitError?.code, "stdout_limit_exceeded");
  assert.equal(collector.collect().length, 1_000);
});

void test("LimitedCollector never flags the limit when total bytes stay within it", async () => {
  const limitBytes = 1_000;
  const collector = new LimitedCollector(
    limitBytes,
    "stderr_limit_exceeded",
    `Sandbox stderr exceeded ${String(limitBytes)} bytes.`
  );
  const chunk = Buffer.alloc(100, "b");
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve, reject) => {
      collector.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  }
  assert.equal(collector.limitError, null);
  assert.equal(collector.collect().length, 500);
});
