import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
import {
  ExecPodBridgeService,
  SHARED_MOUNT_HYDRATE_CONCURRENCY
} from "../src/exec-pod-bridge.service";

// A valid, empty tar archive: two+ all-zero 512-byte blocks signal end-of-archive.
// The control plane's workspace pull (`tar -cf - -C /workspace .`) always produces a
// real archive in production; the exec mock returns this empty-but-valid archive so the
// pull path's real `tar -xf` exits 0 on every tar implementation (GNU tar on CI rejects
// non-tar / zero-length input that BSD tar silently tolerates).
const VALID_EMPTY_TAR = "\0".repeat(10240);

function isWorkspacePull(command: string[]): boolean {
  return command.includes("-cf") && command.includes("/workspace");
}

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
    SANDBOX_EXEC_EGRESS_PROXY_URL: "",
    SANDBOX_EXEC_NO_PROXY: "",
    SANDBOX_EXEC_SESSION_IDLE_TTL_MS: 900_000,
    SANDBOX_EXEC_REAPER_INTERVAL_MS: 120_000,
    SANDBOX_EXEC_POD_PROVISION_BUDGET_MS: 240_000,
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
  latestByWorkspace: Record<string, { createdAt: Date; completedAt: Date | null } | null> = {}
) {
  return {
    sandboxJob: {
      findFirst: async ({ where }: { where: { assistantId: string; workspaceId: string } }) =>
        latestByWorkspace[`${where.assistantId}:${where.workspaceId}`] ?? null
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

function buildMockBridge(ctx: MockK8sContext): ExecPodBridgeService {
  let phaseIndex = 0;
  let execCallIndex = 0;

  const mockCoreV1Api: Partial<CoreV1Api> = {
    async createNamespacedPod(params: { namespace: string; body: V1Pod }) {
      ctx.createdPods.push({ namespace: params.namespace, body: params.body });
      return params.body as never;
    },
    async readNamespacedPod() {
      const phaseOrError = ctx.podPhaseSequence[phaseIndex];
      phaseIndex += 1;
      if (phaseOrError instanceof Error) {
        throw phaseOrError;
      }
      return { status: { phase: phaseOrError } } as never;
    },
    async deleteNamespacedPod(params: { name: string; namespace: string }) {
      ctx.deletedPods.push(params.name);
      return {} as never;
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
  Object.defineProperty(bridge, "objectStorage", {
    configurable: true,
    value: {
      buildSharedPrefix: ({ workspaceId }: { workspaceId: string }) =>
        `assistant-media/workspaces/${workspaceId}/shared/`,
      listPrefix: async () => input.keys,
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
        return { exitCode: 0 };
      })
  });
  return {
    bridge,
    warnings,
    infos,
    async hydrateSharedMountFromGcs(
      podName: string,
      namespace: string,
      workspaceId: string
    ): Promise<void> {
      const method = Reflect.get(bridge, "hydrateSharedMountFromGcs");
      assert.equal(typeof method, "function", "hydrateSharedMountFromGcs must exist on the bridge");
      await (
        method as (
          this: ExecPodBridgeService,
          podName: string,
          namespace: string,
          workspaceId: string
        ) => Promise<void>
      ).call(bridge, podName, namespace, workspaceId);
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

test("ExecPodBridgeService: hydrateSharedMountFromGcs no-ops when no shared keys exist", async () => {
  let downloadCount = 0;
  let execCount = 0;
  const { hydrateSharedMountFromGcs, warnings } = buildHydrateTestBridge({
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

  await hydrateSharedMountFromGcs("pod-1", "persai-dev", "ws-empty");

  assert.equal(downloadCount, 0, "empty hydrate must not download any blobs");
  assert.equal(execCount, 0, "empty hydrate must not open pod exec sessions");
  assert.deepEqual(warnings, [], "empty hydrate should not warn");
});

test("ExecPodBridgeService: hydrateSharedMountFromGcs executes every file when key count is within concurrency", async () => {
  const keys = [
    "assistant-media/workspaces/ws-small/shared/input/a.txt",
    "assistant-media/workspaces/ws-small/shared/input/b.txt",
    "assistant-media/workspaces/ws-small/shared/outbound/self/c.txt"
  ];
  const buffers = new Map<string, Buffer>([
    [keys[0]!, Buffer.from("alpha")],
    [keys[1]!, Buffer.from("beta")],
    [keys[2]!, Buffer.from("gamma")]
  ]);
  const writes: Array<{ shell: string; stdin: Buffer }> = [];
  const { hydrateSharedMountFromGcs, warnings } = buildHydrateTestBridge({
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

  await hydrateSharedMountFromGcs("pod-2", "persai-dev", "ws-small");

  assert.equal(writes.length, keys.length, "every listed blob must be written into the pod");
  assert.deepEqual(warnings, [], "happy-path hydrate should not warn");
  assert.ok(
    writes.some(
      (write) =>
        write.shell.includes("/shared/ws-small/input/a.txt") &&
        write.stdin.equals(Buffer.from("alpha"))
    ),
    "a.txt must be written with its downloaded buffer"
  );
  assert.ok(
    writes.some(
      (write) =>
        write.shell.includes("/shared/ws-small/input/b.txt") &&
        write.stdin.equals(Buffer.from("beta"))
    ),
    "b.txt must be written with its downloaded buffer"
  );
  assert.ok(
    writes.some(
      (write) =>
        write.shell.includes("/shared/ws-small/outbound/self/c.txt") &&
        write.stdin.equals(Buffer.from("gamma"))
    ),
    "outbound file must be written with its downloaded buffer"
  );
});

test("ExecPodBridgeService: hydrateSharedMountFromGcs caps in-flight work at the concurrency constant", async () => {
  const totalKeys = SHARED_MOUNT_HYDRATE_CONCURRENCY * 2 + 3;
  const keys = Array.from({ length: totalKeys }, (_, index) => {
    return `assistant-media/workspaces/ws-many/shared/input/file-${index}.txt`;
  });
  let active = 0;
  let peak = 0;
  let execCount = 0;
  const { hydrateSharedMountFromGcs } = buildHydrateTestBridge({
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

  await hydrateSharedMountFromGcs("pod-3", "persai-dev", "ws-many");

  assert.equal(execCount, totalKeys, "all keys must still complete");
  assert.ok(
    peak <= SHARED_MOUNT_HYDRATE_CONCURRENCY,
    `peak in-flight work (${peak}) must not exceed the configured concurrency`
  );
  assert.equal(active, 0, "all in-flight work must drain before the hydrate resolves");
});

test("ExecPodBridgeService: hydrateSharedMountFromGcs logs download failures and continues other blobs", async () => {
  const keys = [
    "assistant-media/workspaces/ws-download/shared/input/good-a.txt",
    "assistant-media/workspaces/ws-download/shared/input/bad.txt",
    "assistant-media/workspaces/ws-download/shared/input/good-b.txt"
  ];
  const writtenPaths: string[] = [];
  const { hydrateSharedMountFromGcs, warnings } = buildHydrateTestBridge({
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

  await hydrateSharedMountFromGcs("pod-4", "persai-dev", "ws-download");

  assert.equal(writtenPaths.length, 2, "healthy blobs must still be written");
  assert.ok(
    warnings.some((warning) =>
      warning.includes("shared_mount_hydrate_download_failed workspace=ws-download")
    ),
    "download failures must be logged"
  );
  assert.ok(
    writtenPaths.some((shell) => shell.includes("/shared/ws-download/input/good-a.txt")),
    "good-a must still be written"
  );
  assert.ok(
    writtenPaths.some((shell) => shell.includes("/shared/ws-download/input/good-b.txt")),
    "good-b must still be written"
  );
});

test("ExecPodBridgeService: hydrateSharedMountFromGcs logs non-zero exec exits and still resolves", async () => {
  const keys = [
    "assistant-media/workspaces/ws-exit/shared/input/ok.txt",
    "assistant-media/workspaces/ws-exit/shared/input/fail.txt"
  ];
  const executed: string[] = [];
  const { hydrateSharedMountFromGcs, warnings } = buildHydrateTestBridge({
    keys,
    downloadObject: async (key) => Buffer.from(key),
    execCommand: async (_podName, _namespace, request) => {
      const shell = request.args[1] ?? "";
      executed.push(shell);
      if (shell.includes("/shared/ws-exit/input/fail.txt")) {
        return { exitCode: 7 };
      }
      return { exitCode: 0 };
    }
  });

  await assert.doesNotReject(() => hydrateSharedMountFromGcs("pod-5", "persai-dev", "ws-exit"));

  assert.equal(executed.length, keys.length, "non-zero exits must not stop other writes");
  assert.ok(
    warnings.some((warning) =>
      warning.includes(
        "shared_mount_hydrate_write_failed workspace=ws-exit path=/shared/ws-exit/input/fail.txt exit=7"
      )
    ),
    "non-zero write exits must be logged"
  );
});

test("ExecPodBridgeService: toPodCwd maps workspace root to /workspace", () => {
  const bridge = new ExecPodBridgeService(createConfig(), createMockPrisma() as never);
  const access = bridge as unknown as {
    toPodCwd(workspaceRoot: string, absoluteCwd: string): string;
  };

  assert.equal(access.toPodCwd("/tmp/ws", "/tmp/ws"), "/workspace");
  assert.equal(access.toPodCwd("/tmp/ws", "/tmp/ws/subdir"), "/workspace/subdir");
  assert.equal(access.toPodCwd("/tmp/ws", "/tmp/ws/a/b"), "/workspace/a/b");
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
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY
    ): Promise<void>;
  };

  await access.createExecPod("exec-testpod", "persai-dev", {
    ...DEFAULT_RUNTIME_SANDBOX_POLICY,
    enabled: true
  });

  assert.equal(ctx.createdPods.length, 1);
  const pod = ctx.createdPods[0];
  assert.ok(pod !== undefined);
  assert.equal(pod.namespace, "persai-dev");
  assert.equal(pod.body.spec?.runtimeClassName, "gvisor");
  assert.equal(pod.body.spec?.nodeSelector?.["workload"], "sandbox");
  assert.equal(pod.body.spec?.automountServiceAccountToken, false);
  assert.equal(pod.body.spec?.restartPolicy, "Never");
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
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY
    ): Promise<void>;
  };

  await access.createExecPod("exec-testproxy", "persai-dev", {
    ...DEFAULT_RUNTIME_SANDBOX_POLICY,
    enabled: true
  });

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

test("ExecPodBridgeService: sessionless runInPod creates and deletes ephemeral pod", async () => {
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
  assert.equal(ctx.deletedPods.length, 1, "ephemeral pod must be deleted after job");
  assert.equal(ctx.deletedPods[0], ctx.createdPods[0]?.body.metadata?.name);
});

test("ExecPodBridgeService: workspace push extracts by entry name with --no-same-owner (never '.')", async () => {
  // Regression: extracting a "." member made the remote tar restore mode/utime on
  // /workspace itself, which the non-root exec user cannot do, failing every push with
  // "Cannot change mode/utime: Operation not permitted". The push must archive top-level
  // entries by name (so no "." member is ever extracted) and pass --no-same-owner.
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
  try {
    await fs.writeFile(join(workspaceRoot, "report.txt"), "hello", "utf8");
    await fs.mkdir(join(workspaceRoot, "sub"));
    await fs.writeFile(join(workspaceRoot, "sub", "nested.txt"), "data", "utf8");
    await bridge.runInPod({
      jobId: "job-push-001",
      runtimeSessionId: null,
      assistantId: "assistant-push",
      assistantHandle: "test-handle",
      siblingHandles: [],
      workspaceId: "workspace-push",
      workspaceRoot,
      absoluteCwd: workspaceRoot,
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
});

test("ExecPodBridgeService: workspace push success comes from the stdin-less verify, not the push channel", async () => {
  // Root regression (live-cluster verified): @kubernetes/client-node drops the exec
  // stdout channel and races the status frame when a non-trivial payload is streamed
  // on stdin, so the push exec's own return is unusable. Success MUST be asserted by
  // the separate stdin-less verify probe. Here the push exec (call 0) succeeds but the
  // verify exec (call 1) reports the marker missing (exit 1) → the whole push must fail
  // as a retryable spawn failure, and the command/pull must never run.
  const ctx: MockK8sContext = {
    createdPods: [],
    podPhaseSequence: ["Running"],
    execResponses: [
      { exitCode: 0, stdout: "", stderr: "" }, // ensureSharedMountBootstrapped probe
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

test("ExecPodBridgeService: session runInPod reuses pod on second call (no recreate, no delete)", async () => {
  // First call: pod does not exist (readNamespacedPod returns 404) → create it.
  // Second call: pod is Running → reuse; must NOT create a second pod or delete.
  let readCallCount = 0;

  const createdPods: string[] = [];
  const deletedPods: string[] = [];

  const mockCoreV1Api = {
    async createNamespacedPod(params: { namespace: string; body: V1Pod }) {
      createdPods.push(params.body.metadata?.name ?? "");
      return params.body as never;
    },
    async readNamespacedPod() {
      readCallCount += 1;
      if (readCallCount === 1) {
        // First call: simulate pod not found → should trigger create path.
        const err = Object.assign(new Error("pod not found"), { statusCode: 404 });
        throw err;
      }
      // Subsequent calls: pod is Running.
      return { status: { phase: "Running" } } as never;
    },
    async deleteNamespacedPod(params: { name: string }) {
      deletedPods.push(params.name);
      return {} as never;
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
        if (stdout !== null && isWorkspacePull(command)) {
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

    assert.equal(createdPods.length, 1, "first session job must create exactly one pod");
    assert.equal(deletedPods.length, 0, "session pod must NOT be deleted after first job");

    // Second job: pod is Running → must reuse, no create, no delete.
    await bridge.runInPod({
      jobId: "job-s2",
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
  } finally {
    await removePathWithRetries(workspaceRoot);
  }

  assert.equal(createdPods.length, 1, "second session job must NOT create a new pod");
  assert.equal(deletedPods.length, 0, "session pod must NOT be deleted after second job");
  assert.ok(createdPods[0]?.startsWith("ses-"), "session pod name must start with ses-");
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
              creationTimestamp: oldTs,
              annotations: {
                "persai.io/assistant-id": "a-active",
                "persai.io/workspace-id": "w-active"
              }
            }
          },
          // Ephemeral orphan: no workspace annotations, old creation → evicted by age.
          { metadata: { name: "exec-orphan", creationTimestamp: oldTs } }
        ]
      } as never;
    },
    async deleteNamespacedPod(params: { name: string }) {
      deletedPods.push(params.name);
      return {} as never;
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
      // After create: pod is Running.
      return { status: { phase: "Running" } } as never;
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
      return { status: { phase: "Running" } } as never;
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
      // After the 409-tolerant create falls through: pod is Running (the concurrent caller created it).
      return { status: { phase: "Running" } } as never;
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
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY
    ): Promise<void>;
  };

  await access.createExecPod("exec-noproxy", "persai-dev", {
    ...DEFAULT_RUNTIME_SANDBOX_POLICY,
    enabled: true
  });

  assert.equal(ctx.createdPods.length, 1);
  const pod = ctx.createdPods[0];
  assert.ok(pod !== undefined);
  const container = pod.body.spec?.containers?.[0];
  assert.ok(container !== undefined);
  assert.deepEqual(container.env, [], "env must be empty when proxy URL is not configured");
});
