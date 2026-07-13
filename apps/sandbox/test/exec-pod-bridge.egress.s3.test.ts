import assert from "node:assert/strict";
import { test } from "node:test";
import type { SandboxConfig } from "@persai/config";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import type { CoreV1Api, V1Pod } from "@kubernetes/client-node";
import { ExecPodBridgeService } from "../src/exec-pod-bridge.service";
import { SANDBOX_EGRESS_MODE_KEY } from "../src/sandbox-egress-mode";
import { SandboxObservabilityService } from "../src/sandbox-observability.service";

type KubeConfigLike = {
  loadFromCluster(): void;
  makeApiClient<T>(apiClass: new (...args: unknown[]) => T): T;
};

function createConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    APP_ENV: "local" as const,
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    PORT: 3013,
    LOG_LEVEL: "info" as const,
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
    SANDBOX_EXEC_EGRESS_PROXY_URL: "http://sandbox-egress-proxy:3128",
    SANDBOX_EXEC_NO_PROXY: "10.0.0.0/8,192.168.0.0/16",
    SANDBOX_EXEC_SESSION_IDLE_TTL_MS: 900_000,
    SANDBOX_EXEC_REAPER_INTERVAL_MS: 120_000,
    SANDBOX_EXEC_POD_PROVISION_BUDGET_MS: 2_000,
    SANDBOX_WARM_POOL_SIZE_PER_ASSISTANT: 1,
    SANDBOX_SHARED_EMPTYDIR_SIZE_MIB: 512,
    SANDBOX_GC_INTERVAL_MS: 300_000,
    PERSAI_MEDIA_OBJECT_PREFIX: "assistant-media",
    ...overrides
  } as SandboxConfig;
}

type StoredPod = {
  body: V1Pod;
  phase: string;
};

type MockCtx = {
  pods: Map<string, StoredPod>;
  createdPods: V1Pod[];
  deletedPods: string[];
  execCommands: string[][];
  conflictOnCreateNames: Set<string>;
  createCalls: number;
  deleteUids?: string[];
  deleteResourceVersions?: string[];
  replacementOnDelete?: Map<string, StoredPod>;
};

function createMockPrisma(modeByAssistant: Record<string, string | null> = {}) {
  return {
    sandboxJob: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 1 })
    },
    assistantWorkspaceLease: {
      findFirst: async () => ({ id: "active-lease" })
    },
    assistant: {
      findUnique: async ({
        where
      }: {
        where: { id: string };
      }): Promise<{ sandboxEgressMode: string } | null> => {
        if (!Object.prototype.hasOwnProperty.call(modeByAssistant, where.id)) {
          return null;
        }
        const mode = modeByAssistant[where.id] as string | null;
        if (mode === null) {
          throw new Error("db_unavailable");
        }
        return { sandboxEgressMode: mode };
      }
    }
  };
}

function notFoundError(): Error & { code: number } {
  const error = new Error("not found") as Error & { code: number };
  error.code = 404;
  return error;
}

function conflictError(): Error & { code: number } {
  const error = new Error("conflict") as Error & { code: number };
  error.code = 409;
  return error;
}

function buildBridge(
  ctx: MockCtx,
  modeByAssistant: Record<string, string | null>,
  observability?: SandboxObservabilityService
): ExecPodBridgeService {
  const mockCoreV1Api: Partial<CoreV1Api> = {
    async createNamespacedPod(params: { namespace: string; body: V1Pod }) {
      ctx.createCalls += 1;
      const name = params.body.metadata?.name;
      if (name === undefined) {
        throw new Error("missing pod name");
      }
      if (ctx.conflictOnCreateNames.has(name) && ctx.pods.has(name)) {
        throw conflictError();
      }
      if (ctx.pods.has(name)) {
        throw conflictError();
      }
      const body = structuredClone(params.body);
      body.metadata = {
        ...body.metadata,
        uid: body.metadata?.uid ?? `uid-${name}-${ctx.createCalls}`,
        resourceVersion: body.metadata?.resourceVersion ?? "1"
      };
      ctx.createdPods.push(body);
      ctx.pods.set(name, { body, phase: "Running" });
      return body as never;
    },
    async readNamespacedPod(params: { name: string; namespace: string }) {
      const stored = ctx.pods.get(params.name);
      if (stored === undefined) {
        throw notFoundError();
      }
      return {
        ...stored.body,
        status: { phase: stored.phase },
        metadata: stored.body.metadata
      } as never;
    },
    async deleteNamespacedPod(params: { name: string; namespace: string }) {
      const stored = ctx.pods.get(params.name);
      const preconditions = (
        params as unknown as {
          body?: { preconditions?: { uid?: string; resourceVersion?: string } };
        }
      ).body?.preconditions;
      const expectedUid = preconditions?.uid;
      const expectedResourceVersion = preconditions?.resourceVersion;
      if (expectedResourceVersion !== undefined) {
        ctx.deleteResourceVersions?.push(expectedResourceVersion);
      }
      if (expectedUid !== undefined) {
        ctx.deleteUids?.push(expectedUid);
      }
      if (
        stored !== undefined &&
        expectedUid !== undefined &&
        stored.body.metadata?.uid !== expectedUid
      ) {
        throw conflictError();
      }
      if (
        stored !== undefined &&
        expectedResourceVersion !== undefined &&
        stored.body.metadata?.resourceVersion !== expectedResourceVersion
      ) {
        throw conflictError();
      }
      ctx.deletedPods.push(params.name);
      const replacement = ctx.replacementOnDelete?.get(params.name);
      if (replacement === undefined) {
        ctx.pods.delete(params.name);
      } else {
        ctx.pods.set(params.name, replacement);
      }
      return {} as never;
    },
    async replaceNamespacedPod(params: { name: string; namespace: string; body: V1Pod }) {
      const stored = ctx.pods.get(params.name);
      if (stored === undefined) {
        throw notFoundError();
      }
      const body = structuredClone(params.body);
      body.metadata = { ...body.metadata, uid: stored.body.metadata?.uid ?? `uid-${params.name}` };
      body.metadata.resourceVersion = String(
        Number(stored.body.metadata?.resourceVersion ?? "1") + 1
      );
      ctx.pods.set(params.name, { body, phase: stored.phase });
      return body as never;
    },
    async listNamespacedPod() {
      return {
        items: Array.from(ctx.pods.entries()).map(([name, stored]) => ({
          ...stored.body,
          metadata: {
            ...stored.body.metadata,
            name
          },
          status: { phase: stored.phase }
        }))
      } as never;
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
      ctx.execCommands.push([...command]);
      const ws = { on: () => undefined };
      void Promise.resolve().then(() => {
        const joined = command.join(" ");
        if (stdout !== null && joined.includes("survivors:")) {
          stdout.write("survivors");
        }
        statusCallback?.({
          status: joined.includes("survivors:") ? "Failure" : "Success"
        });
      });
      return Promise.resolve(ws as never);
    }
  };

  const bridge = new ExecPodBridgeService(
    createConfig(),
    createMockPrisma(modeByAssistant) as never,
    null,
    observability ?? null
  );
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

function seedPod(
  ctx: MockCtx,
  name: string,
  input: {
    assistantId: string;
    workspaceId: string;
    modeLabel?: string | null;
    modeAnnotation?: string | null;
    phase?: string;
    jobId?: string;
    leaseToken?: string;
    uid?: string;
  }
): void {
  const labels: Record<string, string> = {
    "app.kubernetes.io/name": "exec-pod",
    "app.kubernetes.io/component": "sandbox-exec"
  };
  const annotations: Record<string, string> = {
    "persai.io/assistant-id": input.assistantId,
    "persai.io/workspace-id": input.workspaceId,
    "persai.io/assistant-handle": "handle-1"
  };
  if (input.modeLabel) {
    labels[SANDBOX_EGRESS_MODE_KEY] = input.modeLabel;
  }
  if (input.modeAnnotation) {
    annotations[SANDBOX_EGRESS_MODE_KEY] = input.modeAnnotation;
  }
  if (input.jobId) {
    annotations["persai.io/sandbox-job-id"] = input.jobId;
  }
  if (input.leaseToken) {
    annotations["persai.io/sandbox-lease-token"] = input.leaseToken;
  }
  ctx.pods.set(name, {
    phase: input.phase ?? "Running",
    body: {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name,
        uid: input.uid ?? `uid-${name}`,
        resourceVersion: "1",
        labels,
        annotations
      },
      spec: { containers: [{ name: "exec", image: "busybox:1.36", env: [] }] }
    }
  });
}

test("ExecPodBridge S3: restricted pod gets label/annotation + six proxy env vars", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const observability = new SandboxObservabilityService();
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" }, observability);
  const access = bridge as unknown as {
    createExecPod(
      podName: string,
      namespace: string,
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY,
      egressMode: "restricted" | "full_public",
      annotations?: Record<string, string>
    ): Promise<void>;
  };

  await access.createExecPod(
    "ses-restricted",
    "persai-dev",
    DEFAULT_RUNTIME_SANDBOX_POLICY,
    "restricted",
    {
      "persai.io/assistant-id": "assistant-1"
    }
  );

  const pod = ctx.createdPods[0];
  assert.ok(pod);
  assert.equal(pod.metadata?.labels?.[SANDBOX_EGRESS_MODE_KEY], "restricted");
  assert.equal(pod.metadata?.annotations?.[SANDBOX_EGRESS_MODE_KEY], "restricted");
  const env = pod.spec?.containers?.[0]?.env ?? [];
  assert.deepEqual(
    env.map((entry) => entry.name),
    ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NO_PROXY", "no_proxy"]
  );
});

test("ExecPodBridge S3: full_public pod gets full-public label and no proxy env", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const bridge = buildBridge(ctx, { "assistant-1": "full_public" });
  const access = bridge as unknown as {
    createExecPod(
      podName: string,
      namespace: string,
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY,
      egressMode: "restricted" | "full_public"
    ): Promise<void>;
  };

  await access.createExecPod(
    "ses-full",
    "persai-dev",
    DEFAULT_RUNTIME_SANDBOX_POLICY,
    "full_public"
  );

  const pod = ctx.createdPods[0];
  assert.ok(pod);
  assert.equal(pod.metadata?.labels?.[SANDBOX_EGRESS_MODE_KEY], "full-public");
  assert.equal(pod.metadata?.annotations?.[SANDBOX_EGRESS_MODE_KEY], "full-public");
  assert.deepEqual(pod.spec?.containers?.[0]?.env ?? [], []);
});

test("ExecPodBridge S3: DB resolve failure fails closed with no runtime authority", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const bridge = buildBridge(ctx, { "assistant-1": null });

  await assert.rejects(
    () =>
      bridge.warmSessionPod({
        assistantId: "assistant-1",
        assistantHandle: "handle-1",
        workspaceId: "workspace-1",
        policy: DEFAULT_RUNTIME_SANDBOX_POLICY
      }),
    /sandbox egress mode|db_unavailable|unresolved/i
  );
  assert.equal(ctx.createdPods.length, 0);
});

test("ExecPodBridge S3: missing assistant row fails closed", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const bridge = buildBridge(ctx, {});

  await assert.rejects(
    () =>
      bridge.warmSessionPod({
        assistantId: "missing",
        assistantHandle: "handle-1",
        workspaceId: "workspace-1",
        policy: DEFAULT_RUNTIME_SANDBOX_POLICY
      }),
    /missing or invalid|unresolved/i
  );
});

test("ExecPodBridge S3: mismatched warm pod is deleted, waited absent, and recreated", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const podName = "ses-mismatch";
  seedPod(ctx, podName, {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    modeLabel: "restricted",
    modeAnnotation: "restricted"
  });
  // Force stable session name by stubbing buildSessionPodName.
  const observability = new SandboxObservabilityService();
  const bridge = buildBridge(ctx, { "assistant-1": "full_public" }, observability);
  (bridge as unknown as { buildSessionPodName: () => string }).buildSessionPodName = () => podName;

  const result = await bridge.warmSessionPod({
    assistantId: "assistant-1",
    assistantHandle: "handle-1",
    workspaceId: "workspace-1",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY
  });

  assert.equal(result.alreadyRunning, false);
  assert.ok(ctx.deletedPods.includes(podName));
  assert.equal(ctx.createdPods.length, 1);
  assert.equal(ctx.createdPods[0]?.metadata?.labels?.[SANDBOX_EGRESS_MODE_KEY], "full-public");
  assert.equal(
    ctx.pods.get(podName)?.body.metadata?.labels?.[SANDBOX_EGRESS_MODE_KEY],
    "full-public"
  );
  const counters = observability.getCounters();
  assert.equal(counters.egressPodRecycles.mismatch, 1);
  assert.equal(counters.egressPodCreates.full_public, 1);
});

test("ExecPodBridge S3: malformed label/annotation recycles before reuse", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const podName = "ses-malformed";
  seedPod(ctx, podName, {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    modeLabel: "restricted",
    modeAnnotation: "full-public"
  });
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" });
  (bridge as unknown as { buildSessionPodName: () => string }).buildSessionPodName = () => podName;

  await bridge.warmSessionPod({
    assistantId: "assistant-1",
    assistantHandle: "handle-1",
    workspaceId: "workspace-1",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY
  });

  assert.ok(ctx.deletedPods.includes(podName));
  assert.equal(ctx.createdPods[0]?.metadata?.labels?.[SANDBOX_EGRESS_MODE_KEY], "restricted");
});

test("ExecPodBridge S3: unlabeled pod recycles", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const podName = "ses-unlabeled";
  seedPod(ctx, podName, {
    assistantId: "assistant-1",
    workspaceId: "workspace-1"
  });
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" });
  (bridge as unknown as { buildSessionPodName: () => string }).buildSessionPodName = () => podName;

  await bridge.warmSessionPod({
    assistantId: "assistant-1",
    assistantHandle: "handle-1",
    workspaceId: "workspace-1",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY
  });

  assert.ok(ctx.deletedPods.includes(podName));
  assert.equal(ctx.createdPods.length, 1);
});

test("ExecPodBridge S3: create 409 with wrong-mode concurrent pod converges by recycle", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const podName = "ses-race";
  seedPod(ctx, podName, {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    modeLabel: "restricted",
    modeAnnotation: "restricted"
  });
  ctx.conflictOnCreateNames.add(podName);
  const bridge = buildBridge(ctx, { "assistant-1": "full_public" });
  const access = bridge as unknown as {
    createExecPodIdempotent(
      podName: string,
      namespace: string,
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY,
      egressMode: "restricted" | "full_public",
      annotations: Record<string, string>,
      assistantId: string,
      jobId: string | null
    ): Promise<void>;
  };

  await access.createExecPodIdempotent(
    podName,
    "persai-dev",
    DEFAULT_RUNTIME_SANDBOX_POLICY,
    "full_public",
    {
      "persai.io/assistant-id": "assistant-1",
      "persai.io/workspace-id": "workspace-1",
      "persai.io/assistant-handle": "handle-1"
    },
    "assistant-1",
    "job-1"
  );

  assert.ok(ctx.deletedPods.includes(podName));
  assert.equal(
    ctx.pods.get(podName)?.body.metadata?.labels?.[SANDBOX_EGRESS_MODE_KEY],
    "full-public"
  );
});

test("ExecPodBridge S3: restricted-to-full race immediately before exec fails closed", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const modes: Record<string, string | null> = { "assistant-1": "restricted" };
  const bridge = buildBridge(ctx, modes);
  const podName = bridge.buildSessionPodName("assistant-1", "ws-1");
  seedPod(ctx, podName, {
    assistantId: "assistant-1",
    workspaceId: "ws-1",
    modeLabel: "restricted",
    modeAnnotation: "restricted"
  });
  modes["assistant-1"] = "full_public";

  const access = bridge as unknown as {
    executionIdentityContext: {
      run<T>(identity: Record<string, unknown>, callback: () => Promise<T>): Promise<T>;
    };
    execCommand(
      name: string,
      namespace: string,
      options: {
        command: string;
        args: string[];
        podCwd: string;
        policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY;
      }
    ): Promise<unknown>;
  };
  await assert.rejects(
    access.executionIdentityContext.run(
      {
        namespace: "persai-dev",
        podName,
        podUid: `uid-${podName}`,
        assistantId: "assistant-1",
        workspaceId: "ws-1",
        assistantHandle: "handle-1",
        mode: "restricted"
      },
      async () =>
        access.execCommand(podName, "persai-dev", {
          command: "echo",
          args: ["must-not-run"],
          podCwd: "/workspace",
          policy: DEFAULT_RUNTIME_SANDBOX_POLICY
        })
    ),
    /UID\/assistant\/workspace\/handle\/mode changed immediately before exec/i
  );
  assert.deepEqual(ctx.deletedPods, []);
  assert.deepEqual(ctx.execCommands, []);
});

test("ExecPodBridge S3: pre-job mode mismatch increments fail-closed metric", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const observability = new SandboxObservabilityService();
  const bridge = buildBridge(ctx, { "assistant-1": "full_public" }, observability);
  const access = bridge as unknown as {
    execJobCommand(
      podName: string,
      namespace: string,
      options: {
        jobId: string;
        assistantId: string;
        egressMode: "restricted" | "full_public";
        command: string;
        args: string[];
        podCwd: string;
        policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY;
      }
    ): Promise<unknown>;
  };

  await assert.rejects(
    () =>
      access.execJobCommand("ses-metric-mismatch", "persai-dev", {
        jobId: "job-metric-mismatch",
        assistantId: "assistant-1",
        egressMode: "restricted",
        command: "echo",
        args: ["must-not-run"],
        podCwd: "/workspace",
        policy: DEFAULT_RUNTIME_SANDBOX_POLICY
      }),
    /mode changed immediately before/
  );
  assert.equal(observability.getCounters().egressModeMismatchFailures, 1);
  assert.deepEqual(ctx.execCommands, []);
});

test("ExecPodBridge S3: repeated create conflicts fail closed after bounded convergence attempts", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const bridge = buildBridge(ctx, { "assistant-1": "full_public" });
  const podName = "ses-repeat-race";
  const api = (bridge as unknown as { k8sApi: Partial<CoreV1Api> }).k8sApi;
  api.createNamespacedPod = async () => {
    ctx.createCalls += 1;
    seedPod(ctx, podName, {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      modeLabel: "restricted",
      modeAnnotation: "restricted"
    });
    throw conflictError();
  };
  const access = bridge as unknown as {
    createExecPodIdempotent(
      podName: string,
      namespace: string,
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY,
      egressMode: "restricted" | "full_public",
      annotations: Record<string, string>,
      assistantId: string,
      jobId: string | null
    ): Promise<void>;
  };

  await assert.rejects(
    () =>
      access.createExecPodIdempotent(
        podName,
        "persai-dev",
        DEFAULT_RUNTIME_SANDBOX_POLICY,
        "full_public",
        {
          "persai.io/assistant-id": "assistant-1",
          "persai.io/workspace-id": "workspace-1",
          "persai.io/assistant-handle": "handle-1"
        },
        "assistant-1",
        "job-repeat-race"
      ),
    /did not converge after 3 attempts/
  );
  assert.equal(ctx.createCalls, 3);
  assert.deepEqual(ctx.deletedPods, [podName, podName, podName]);
  assert.deepEqual(ctx.execCommands, []);
});

test("ExecPodBridge S3: caller cannot override canonical mode annotation", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" });
  const access = bridge as unknown as {
    createExecPod(
      podName: string,
      namespace: string,
      policy: typeof DEFAULT_RUNTIME_SANDBOX_POLICY,
      egressMode: "restricted" | "full_public",
      annotations: Record<string, string>
    ): Promise<void>;
  };
  await assert.rejects(
    () =>
      access.createExecPod(
        "ses-conflicting-meta",
        "persai-dev",
        DEFAULT_RUNTIME_SANDBOX_POLICY,
        "restricted",
        {
          "persai.io/assistant-id": "assistant-1",
          "persai.io/workspace-id": "workspace-1",
          [SANDBOX_EGRESS_MODE_KEY]: "full-public"
        }
      ),
    /Conflicting sandbox egress annotation/
  );
  assert.equal(ctx.createCalls, 0);
});

test("ExecPodBridge S3: owner reconcile evicts only idle stale-mode pods", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  seedPod(ctx, "ses-a", {
    assistantId: "assistant-1",
    workspaceId: "ws-1",
    modeLabel: "full-public",
    modeAnnotation: "full-public"
  });
  seedPod(ctx, "ses-b", {
    assistantId: "assistant-1",
    workspaceId: "ws-2",
    modeLabel: "restricted",
    modeAnnotation: "restricted"
  });
  seedPod(ctx, "ses-other", {
    assistantId: "assistant-2",
    workspaceId: "ws-1",
    modeLabel: "restricted",
    modeAnnotation: "restricted"
  });
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" });

  const result = await bridge.reconcileAssistantEgressPods({
    assistantId: "assistant-1",
    expectedMode: "restricted",
    scope: "all"
  });

  assert.equal(result.recycled, true);
  assert.equal(result.deletedPodCount, 1);
  assert.ok(ctx.deletedPods.includes("ses-a"));
  assert.equal(ctx.deletedPods.includes("ses-b"), false);
  assert.equal(ctx.deletedPods.includes("ses-other"), false);
  assert.equal(ctx.pods.has("ses-a"), false);
  assert.equal(ctx.pods.has("ses-b"), true);
  assert.equal(ctx.pods.has("ses-other"), true);
});

test("ExecPodBridge S3: same-mode stale_only reconciles only mismatched pods", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  seedPod(ctx, "ses-ok", {
    assistantId: "assistant-1",
    workspaceId: "ws-1",
    modeLabel: "restricted",
    modeAnnotation: "restricted"
  });
  seedPod(ctx, "ses-stale", {
    assistantId: "assistant-1",
    workspaceId: "ws-2",
    modeLabel: "full-public",
    modeAnnotation: "full-public"
  });
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" });

  const result = await bridge.reconcileAssistantEgressPods({
    assistantId: "assistant-1",
    expectedMode: "restricted",
    scope: "stale_only"
  });

  assert.equal(result.recycled, true);
  assert.equal(result.deletedPodCount, 1);
  assert.deepEqual(ctx.deletedPods, ["ses-stale"]);
  assert.equal(ctx.pods.has("ses-ok"), true);
});

test("ExecPodBridge S3: reconcile rejects request mode that differs from DB truth", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  seedPod(ctx, "ses-full", {
    assistantId: "assistant-1",
    workspaceId: "ws-1",
    modeLabel: "full-public",
    modeAnnotation: "full-public"
  });
  const bridge = buildBridge(ctx, { "assistant-1": "full_public" });

  await assert.rejects(
    () =>
      bridge.reconcileAssistantEgressPods({
        assistantId: "assistant-1",
        expectedMode: "restricted",
        scope: "all"
      }),
    /does not match canonical Assistant mode/
  );
  assert.deepEqual(ctx.deletedPods, []);
});

test("ExecPodBridge S3: model-job pod retirement deletes exact pod and waits absent", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const observability = new SandboxObservabilityService();
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" }, observability);
  const podName = bridge.buildSessionPodName("assistant-1", "ws-1");
  seedPod(ctx, podName, {
    assistantId: "assistant-1",
    workspaceId: "ws-1",
    modeLabel: "restricted",
    modeAnnotation: "restricted",
    jobId: "job-completed-with-escaped-background-child",
    leaseToken: "lease-completed"
  });
  seedPod(ctx, "ses-unrelated", {
    assistantId: "assistant-2",
    workspaceId: "ws-2",
    modeLabel: "restricted",
    modeAnnotation: "restricted"
  });

  const result = await bridge.retireModelJobPod({
    binding: {
      namespace: "persai-dev",
      podName,
      podUid: `uid-${podName}`,
      podResourceVersion: "1",
      leaseToken: "lease-completed",
      leaseHolderId: "holder-test",
      jobId: "job-completed-with-escaped-background-child",
      assistantId: "assistant-1",
      workspaceId: "ws-1",
      assistantHandle: "handle-1",
      mode: "restricted"
    }
  });

  assert.deepEqual(result, { podName, podUid: `uid-${podName}`, retired: true });
  assert.deepEqual(ctx.deletedPods, [podName]);
  assert.equal(ctx.pods.has(podName), false);
  assert.equal(ctx.pods.has("ses-unrelated"), true);
  assert.equal(observability.getCounters().egressPodRetirements.retired, 1);
});

test("ExecPodBridge S3: retirement refuses an unrelated pod at the derived name", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" });
  const podName = bridge.buildSessionPodName("assistant-1", "ws-1");
  seedPod(ctx, podName, {
    assistantId: "assistant-other",
    workspaceId: "ws-other",
    modeLabel: "restricted",
    modeAnnotation: "restricted"
  });

  await assert.rejects(
    () =>
      bridge.retireModelJobPod({
        binding: {
          namespace: "persai-dev",
          podName,
          podUid: `uid-${podName}`,
          podResourceVersion: "1",
          leaseToken: "lease-error",
          leaseHolderId: "holder-test",
          jobId: "job-error-or-timeout",
          assistantId: "assistant-1",
          workspaceId: "ws-1",
          assistantHandle: "handle-1",
          mode: "restricted"
        }
      }),
    /bound identity tuple changed/
  );
  assert.deepEqual(ctx.deletedPods, []);
  assert.equal(ctx.pods.has(podName), true);
});

test("ExecPodBridge S3: UID retirement proves UID1 gone without deleting same-name UID2", async () => {
  const deleteUids: string[] = [];
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0,
    deleteUids,
    replacementOnDelete: new Map()
  };
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" });
  const podName = bridge.buildSessionPodName("assistant-1", "ws-1");
  seedPod(ctx, podName, {
    assistantId: "assistant-1",
    workspaceId: "ws-1",
    modeLabel: "restricted",
    modeAnnotation: "restricted",
    jobId: "job-1",
    leaseToken: "lease-1",
    uid: "uid-1"
  });
  const replacement = structuredClone(ctx.pods.get(podName)!);
  replacement.body.metadata = { ...replacement.body.metadata, uid: "uid-2" };
  ctx.replacementOnDelete!.set(podName, replacement);

  await bridge.retireModelJobPod({
    binding: {
      namespace: "persai-dev",
      podName,
      podUid: "uid-1",
      podResourceVersion: "1",
      leaseToken: "lease-1",
      leaseHolderId: "holder-test",
      jobId: "job-1",
      assistantId: "assistant-1",
      workspaceId: "ws-1",
      assistantHandle: "handle-1",
      mode: "restricted"
    }
  });

  assert.deepEqual(deleteUids, ["uid-1"]);
  assert.equal(ctx.pods.get(podName)?.body.metadata?.uid, "uid-2");
});

test("ExecPodBridge S3: final retirement uses fresh RV and fails closed on mutation", async () => {
  const deleteUids: string[] = [];
  const deleteResourceVersions: string[] = [];
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0,
    deleteUids,
    deleteResourceVersions
  };
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" });
  const podName = bridge.buildSessionPodName("assistant-1", "ws-1");
  seedPod(ctx, podName, {
    assistantId: "assistant-1",
    workspaceId: "ws-1",
    modeLabel: "restricted",
    modeAnnotation: "restricted",
    jobId: "job-1",
    leaseToken: "lease-1",
    uid: "uid-1"
  });
  ctx.pods.get(podName)!.body.metadata = {
    ...ctx.pods.get(podName)!.body.metadata,
    resourceVersion: "7"
  };
  const api = (
    bridge as unknown as {
      k8sApi: {
        readNamespacedPod(input: { name: string; namespace: string }): Promise<V1Pod>;
      };
    }
  ).k8sApi;
  const originalRead = api.readNamespacedPod.bind(api);
  api.readNamespacedPod = async (input) => {
    const validatedSnapshot = structuredClone(await originalRead(input));
    ctx.pods.get(podName)!.body.metadata = {
      ...ctx.pods.get(podName)!.body.metadata,
      resourceVersion: "8"
    };
    return validatedSnapshot;
  };

  await assert.rejects(
    () =>
      bridge.retireModelJobPod({
        binding: {
          namespace: "persai-dev",
          podName,
          podUid: "uid-1",
          podResourceVersion: "binding-stale-rv",
          leaseToken: "lease-1",
          leaseHolderId: "holder-test",
          jobId: "job-1",
          assistantId: "assistant-1",
          workspaceId: "ws-1",
          assistantHandle: "handle-1",
          mode: "restricted"
        }
      }),
    /conflict/
  );
  assert.deepEqual(deleteUids, ["uid-1"]);
  assert.deepEqual(deleteResourceVersions, ["7"]);
  assert.deepEqual(ctx.deletedPods, []);
  assert.equal(ctx.pods.get(podName)?.body.metadata?.uid, "uid-1");
  assert.equal(ctx.pods.get(podName)?.body.metadata?.resourceVersion, "8");
});

test("ExecPodBridge S3: owner reconcile preserves a same-name replacement UID", async () => {
  const deleteUids: string[] = [];
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0,
    deleteUids,
    replacementOnDelete: new Map()
  };
  seedPod(ctx, "ses-owner-race", {
    assistantId: "assistant-1",
    workspaceId: "ws-1",
    modeLabel: "restricted",
    modeAnnotation: "restricted",
    uid: "uid-owner-1"
  });
  const replacement = structuredClone(ctx.pods.get("ses-owner-race")!);
  replacement.body.metadata = { ...replacement.body.metadata, uid: "uid-owner-2" };
  ctx.replacementOnDelete!.set("ses-owner-race", replacement);
  const bridge = buildBridge(ctx, { "assistant-1": "full_public" });

  await bridge.reconcileAssistantEgressPods({
    assistantId: "assistant-1",
    expectedMode: "full_public",
    scope: "all"
  });

  assert.deepEqual(deleteUids, ["uid-owner-1"]);
  assert.equal(ctx.pods.get("ses-owner-race")?.body.metadata?.uid, "uid-owner-2");
});

test("ExecPodBridge S3: owner reconcile skips active generation and RV conflicts", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  seedPod(ctx, "ses-active-stale", {
    assistantId: "assistant-owner-race",
    workspaceId: "workspace-active",
    modeLabel: "restricted",
    modeAnnotation: "restricted",
    jobId: "job-active",
    leaseToken: "lease-active",
    uid: "uid-active"
  });
  seedPod(ctx, "ses-rv-race", {
    assistantId: "assistant-owner-race",
    workspaceId: "workspace-rv",
    modeLabel: "restricted",
    modeAnnotation: "restricted",
    uid: "uid-rv"
  });
  const bridge = buildBridge(ctx, { "assistant-owner-race": "full_public" });
  const access = bridge as unknown as {
    prisma: {
      sandboxJob: { findFirst(input: { where: Record<string, unknown> }): Promise<unknown> };
      assistantWorkspaceLease: {
        findFirst(input: { where: Record<string, unknown> }): Promise<unknown>;
      };
    };
    k8sApi: {
      readNamespacedPod(input: { name: string; namespace: string }): Promise<V1Pod>;
    };
  };
  access.prisma.sandboxJob.findFirst = async ({ where }) =>
    where.id === "job-active" ? { id: "job-active" } : null;
  access.prisma.assistantWorkspaceLease.findFirst = async ({ where }) =>
    where.leaseToken === "lease-active" ? { id: "lease-active" } : null;
  const originalRead = access.k8sApi.readNamespacedPod.bind(access.k8sApi);
  access.k8sApi.readNamespacedPod = async (input) => {
    const observed = await originalRead(input);
    if (input.name === "ses-rv-race") {
      const stored = ctx.pods.get(input.name);
      if (stored !== undefined) {
        stored.body.metadata = {
          ...stored.body.metadata,
          resourceVersion: "2",
          annotations: {
            ...stored.body.metadata?.annotations,
            "persai.io/sandbox-job-id": "job-admitted",
            "persai.io/sandbox-lease-token": "lease-admitted"
          }
        };
      }
    }
    return observed;
  };

  const result = await bridge.reconcileAssistantEgressPods({
    assistantId: "assistant-owner-race",
    expectedMode: "full_public",
    scope: "all"
  });
  assert.deepEqual(result, { recycled: false, deletedPodCount: 0 });
  assert.deepEqual(ctx.deletedPods, []);
});

test("ExecPodBridge S3: reaper skips old active jobs and active leases, UID-deletes eligible pods", async () => {
  const deleteUids: string[] = [];
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0,
    deleteUids
  };
  const old = new Date(Date.now() - createConfig().SANDBOX_EXEC_SESSION_IDLE_TTL_MS - 60_000);
  for (const [name, assistantId, leaseToken] of [
    ["ses-active-job", "assistant-active", "lease-old"],
    ["ses-active-lease", "assistant-lease", "lease-live"],
    ["ses-eligible", "assistant-eligible", "lease-expired"]
  ] as const) {
    seedPod(ctx, name, {
      assistantId,
      workspaceId: `workspace-${assistantId}`,
      modeLabel: "restricted",
      modeAnnotation: "restricted",
      jobId: `job-${assistantId}`,
      leaseToken,
      uid: `uid-${name}`
    });
    ctx.pods.get(name)!.body.metadata = {
      ...ctx.pods.get(name)!.body.metadata,
      creationTimestamp: old
    };
  }
  const bridge = buildBridge(ctx, {
    "assistant-active": "restricted",
    "assistant-lease": "restricted",
    "assistant-eligible": "restricted"
  });
  const prisma = (
    bridge as unknown as {
      prisma: {
        sandboxJob: {
          findFirst(input: { where: Record<string, unknown> }): Promise<unknown>;
          updateMany(): Promise<{ count: number }>;
        };
        assistantWorkspaceLease: {
          findFirst(input: { where: Record<string, unknown> }): Promise<unknown>;
        };
      };
    }
  ).prisma;
  let staleJobUpdates = 0;
  prisma.sandboxJob.findFirst = async ({ where }) => {
    if (where.status !== undefined) {
      return where.assistantId === "assistant-active" ||
        where.assistantId === "assistant-lease" ||
        where.assistantId === "assistant-eligible"
        ? { id: "active-job" }
        : null;
    }
    return { createdAt: old, completedAt: old };
  };
  prisma.assistantWorkspaceLease.findFirst = async ({ where }) =>
    where.assistantId === "assistant-active" || where.assistantId === "assistant-lease"
      ? { id: "active-lease" }
      : null;
  prisma.sandboxJob.updateMany = async () => {
    staleJobUpdates += 1;
    return { count: 1 };
  };

  await bridge.runReaperTick();

  assert.deepEqual(ctx.deletedPods, ["ses-eligible"]);
  assert.deepEqual(deleteUids, ["uid-ses-eligible"]);
  assert.equal(ctx.pods.has("ses-active-job"), true);
  assert.equal(ctx.pods.has("ses-active-lease"), true);
  assert.equal(staleJobUpdates, 1);
});

test("ExecPodBridge S3: lease-free warm path leaves contaminated UID untouched", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const bridge = buildBridge(ctx, { "assistant-1": "restricted" });
  const podName = bridge.buildSessionPodName("assistant-1", "ws-1");
  seedPod(ctx, podName, {
    assistantId: "assistant-1",
    workspaceId: "ws-1",
    modeLabel: "restricted",
    modeAnnotation: "restricted",
    jobId: "job-crashed",
    leaseToken: "lease-expired"
  });

  await bridge.warmSessionPod({
    assistantId: "assistant-1",
    assistantHandle: "handle-1",
    workspaceId: "ws-1",
    policy: DEFAULT_RUNTIME_SANDBOX_POLICY
  });
  assert.deepEqual(ctx.deletedPods, []);
  assert.deepEqual(ctx.execCommands, []);
  assert.equal(ctx.pods.has(podName), true);
});

test("ExecPodBridge S3: lease loss at final gate opens no exec websocket", async () => {
  const ctx: MockCtx = {
    pods: new Map(),
    createdPods: [],
    deletedPods: [],
    execCommands: [],
    conflictOnCreateNames: new Set(),
    createCalls: 0
  };
  const bridge = buildBridge(ctx, { "assistant-lease-race": "restricted" });
  const podName = bridge.buildSessionPodName("assistant-lease-race", "workspace-lease-race");
  seedPod(ctx, podName, {
    assistantId: "assistant-lease-race",
    workspaceId: "workspace-lease-race",
    modeLabel: "restricted",
    modeAnnotation: "restricted",
    jobId: "job-lease-race",
    leaseToken: "token-lease-race",
    uid: "uid-lease-race"
  });
  const access = bridge as unknown as {
    prisma: {
      assistantWorkspaceLease: { findFirst(): Promise<unknown> };
    };
    jobBindingContext: {
      run<T>(binding: Record<string, unknown>, callback: () => Promise<T>): Promise<T>;
    };
    execCommand(
      podName: string,
      namespace: string,
      input: Record<string, unknown>
    ): Promise<unknown>;
  };
  let leaseReads = 0;
  access.prisma.assistantWorkspaceLease.findFirst = async () =>
    ++leaseReads === 1 ? { id: "active-lease" } : null;

  await assert.rejects(
    access.jobBindingContext.run(
      {
        namespace: "persai-dev",
        podName,
        podUid: "uid-lease-race",
        podResourceVersion: "1",
        leaseToken: "token-lease-race",
        leaseHolderId: "holder-lease-race",
        jobId: "job-lease-race",
        assistantId: "assistant-lease-race",
        workspaceId: "workspace-lease-race",
        assistantHandle: "handle-1",
        mode: "restricted"
      },
      async () =>
        access.execCommand(podName, "persai-dev", {
          command: "/bin/bash",
          args: ["-lc", "echo must-not-run"],
          podCwd: "/workspace",
          policy: DEFAULT_RUNTIME_SANDBOX_POLICY,
          stdin: null
        })
    ),
    /lease is missing, expired, or no longer owned/
  );
  assert.equal(leaseReads, 2);
  assert.deepEqual(ctx.execCommands, []);
});
