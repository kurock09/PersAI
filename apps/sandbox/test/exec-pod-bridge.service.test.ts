import assert from "node:assert/strict";
import { test } from "node:test";
import type { SandboxConfig } from "@persai/config";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import type { CoreV1Api, V1Pod } from "@kubernetes/client-node";
import { ExecPodBridgeService } from "../src/exec-pod-bridge.service";

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
    SANDBOX_EXEC_NODE_SELECTOR_VALUE: "sandbox"
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
      _command: string[],
      stdout: { write(chunk: string): boolean } | null,
      stderr: { write(chunk: string): boolean } | null,
      _stdin: unknown,
      _tty: boolean,
      statusCallback?: (status: { status: string }) => void
    ) {
      const response = ctx.execResponses[execCallIndex];
      execCallIndex += 1;
      ctx.execCallCount += 1;

      if (response === undefined) {
        return Promise.resolve({
          on: () => undefined
        } as never);
      }

      const ws = {
        on: () => undefined
      };

      Promise.resolve().then(() => {
        if (stdout !== null && response.stdout.length > 0) {
          stdout.write(response.stdout);
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

  const bridge = new ExecPodBridgeService(createConfig());
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

test("ExecPodBridgeService: buildPodName derives stable name from jobId", () => {
  const bridge = new ExecPodBridgeService(createConfig());
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

test("ExecPodBridgeService: toPodCwd maps workspace root to /workspace", () => {
  const bridge = new ExecPodBridgeService(createConfig());
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
    execCallCount: 0
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
    execCallCount: 0
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
    execCallCount: 0
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
  const bridge = new ExecPodBridgeService(createConfig());
  const access = bridge as unknown as { buildPodName(jobId: string): string };

  const jobId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const name = access.buildPodName(jobId);
  assert.equal(access.buildPodName(jobId), name);

  const otherName = access.buildPodName("00000000-0000-0000-0000-000000000001");
  assert.notEqual(name, otherName, "different jobIds must produce different pod names");
});
