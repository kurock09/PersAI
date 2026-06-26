import assert from "node:assert/strict";
import { test } from "node:test";
import type { SandboxConfig } from "@persai/config";
import { WorkspaceGcService } from "../src/workspace-gc.service";

// ─── Config ───────────────────────────────────────────────────────────────────

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

// ─── UUIDs used in test fixtures ──────────────────────────────────────────────

const WS_ID = "11111111-0000-4000-8000-000000000001";
const ASST_ID = "22222222-0000-4000-8000-000000000002";
const CHAT_ID = "33333333-0000-4000-8000-000000000003";
const HANDLE = "my-bot";
const POD_NAME = "ses-abc123";

// ─── GcLease factory ──────────────────────────────────────────────────────────

type GcLeaseKind = "chat_scratch" | "assistant_outbound" | "workspace_shared";

type GcLease = {
  id: string;
  kind: GcLeaseKind;
  targetId: string;
  metadata: Record<string, unknown>;
  scheduledAt: Date;
  purgedAt: Date | null;
};

function pastDate(offsetMs = 1_000): Date {
  return new Date(Date.now() - offsetMs);
}

function futureDate(offsetMs = 60_000): Date {
  return new Date(Date.now() + offsetMs);
}

// ─── Fake factories ───────────────────────────────────────────────────────────

function makePrisma(leases: GcLease[]) {
  const updatedLeases: string[] = [];
  const service = {
    sandboxWorkspaceGcLease: {
      async findMany(): Promise<GcLease[]> {
        // Mimic DB: return only due, un-purged leases.
        return leases.filter((l) => l.purgedAt === null && l.scheduledAt <= new Date());
      },
      async update(input: { where: { id: string }; data: { purgedAt: Date } }): Promise<void> {
        updatedLeases.push(input.where.id);
      }
    },
    async $executeRaw(): Promise<number> {
      return 0;
    }
  } as never;
  return { updatedLeases, service };
}

type WarmPod = { podName: string; assistantId: string; handle: string };
type ExecShellCall = { shellCommand: string };

function makeExec(warmPods: WarmPod[] = []) {
  const shellCalls: ExecShellCall[] = [];
  const service = {
    async listWarmSessionPodsForWorkspace(): Promise<WarmPod[]> {
      return warmPods;
    },
    async execShellInSessionPod(input: { shellCommand: string; [k: string]: unknown }): Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      execPodName: string;
    }> {
      shellCalls.push({ shellCommand: input.shellCommand });
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, execPodName: "ses-test" };
    }
  } as never;
  return { shellCalls, service };
}

function makeStorage() {
  const deletedPrefixes: string[] = [];
  const service = {
    async deletePrefix(prefix: string): Promise<number> {
      deletedPrefixes.push(prefix);
      return 0;
    },
    buildWorkspacePrefix(input: { workspaceId: string; subPath?: string }): string {
      const tail = input.subPath !== undefined ? `${input.subPath}/` : "";
      return `assistant-media/workspaces/${input.workspaceId}/workspace/${tail}`;
    }
  } as never;
  return { deletedPrefixes, service };
}

type GcAuditEvent = { kind: string; leaseId: string };

function makeAudit() {
  const purgedEvents: GcAuditEvent[] = [];
  const failedEvents: GcAuditEvent[] = [];
  const service = {
    recordGcPurged(event: { leaseId: string; kind: string }): void {
      purgedEvents.push({ leaseId: event.leaseId, kind: event.kind });
    },
    recordGcPurgeFailed(event: { leaseId: string; kind: string }): void {
      failedEvents.push({ leaseId: event.leaseId, kind: event.kind });
    }
  } as never;
  return { purgedEvents, failedEvents, service };
}

function makeGcService(
  leases: GcLease[],
  warmPods: WarmPod[] = []
): {
  gc: WorkspaceGcService;
  prisma: ReturnType<typeof makePrisma>;
  exec: ReturnType<typeof makeExec>;
  storage: ReturnType<typeof makeStorage>;
  audit: ReturnType<typeof makeAudit>;
} {
  const prisma = makePrisma(leases);
  const exec = makeExec(warmPods);
  const storage = makeStorage();
  const audit = makeAudit();
  // onModuleInit is NOT called — avoids starting the cron; tests call runDuePurgesNow directly.
  const gc = new WorkspaceGcService(
    createConfig(),
    prisma.service,
    exec.service,
    storage.service,
    audit.service
  );
  return { gc, prisma, exec, storage, audit };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("WorkspaceGcService: chat_scratch lease past-due → rm -rf in pod, GCS prefix deleted, purgedAt set, audit ok", async () => {
  const lease: GcLease = {
    id: "lease-cs-1",
    kind: "chat_scratch",
    targetId: CHAT_ID,
    metadata: { workspaceId: WS_ID, assistantId: ASST_ID },
    scheduledAt: pastDate(),
    purgedAt: null
  };
  const pods: WarmPod[] = [{ podName: POD_NAME, assistantId: ASST_ID, handle: HANDLE }];
  const { gc, prisma, exec, storage, audit } = makeGcService([lease], pods);

  await gc.runDuePurgesNow();

  // Pod exec: rm -rf /workspace/chats/<chatId>
  assert.equal(exec.shellCalls.length, 1);
  assert.ok(exec.shellCalls[0]?.shellCommand.includes(`/workspace/chats/${CHAT_ID}`));
  assert.ok(exec.shellCalls[0]?.shellCommand.startsWith("rm -rf"));
  // GCS snapshot subtree deleted
  assert.equal(storage.deletedPrefixes.length, 1);
  assert.ok(storage.deletedPrefixes[0]?.includes(ASST_ID));
  // Lease marked purged
  assert.deepEqual(prisma.updatedLeases, ["lease-cs-1"]);
  // Audit event emitted
  assert.equal(audit.purgedEvents.length, 1);
  assert.equal(audit.purgedEvents[0]?.kind, "chat_scratch");
  assert.equal(audit.failedEvents.length, 0);
});

test("WorkspaceGcService: chat_scratch lease filters only matching-assistant pods", async () => {
  const lease: GcLease = {
    id: "lease-cs-filter",
    kind: "chat_scratch",
    targetId: CHAT_ID,
    metadata: { workspaceId: WS_ID, assistantId: ASST_ID },
    scheduledAt: pastDate(),
    purgedAt: null
  };
  // Two pods: one for our assistant, one for a different one
  const diffAsst = "44444444-0000-4000-8000-000000000004";
  const pods: WarmPod[] = [
    { podName: POD_NAME, assistantId: ASST_ID, handle: HANDLE },
    { podName: "ses-other", assistantId: diffAsst, handle: "other-bot" }
  ];
  const { gc, exec } = makeGcService([lease], pods);

  await gc.runDuePurgesNow();

  // Only one exec call for the matching assistant pod
  assert.equal(exec.shellCalls.length, 1);
});

test("WorkspaceGcService: assistant_outbound lease future-dated → no purge on this tick", async () => {
  const lease: GcLease = {
    id: "lease-ao-future",
    kind: "assistant_outbound",
    targetId: "ao-target",
    metadata: { workspaceId: WS_ID, handle: HANDLE },
    scheduledAt: futureDate(), // NOT due yet
    purgedAt: null
  };
  const { gc, prisma, exec, storage, audit } = makeGcService([lease]);

  await gc.runDuePurgesNow();

  assert.equal(exec.shellCalls.length, 0);
  assert.equal(storage.deletedPrefixes.length, 0);
  assert.deepEqual(prisma.updatedLeases, []);
  assert.equal(audit.purgedEvents.length, 0);
});

test("WorkspaceGcService: assistant_outbound lease past-due → purgedAt set (flat workspace has no per-assistant subtree to rm)", async () => {
  const lease: GcLease = {
    id: "lease-ao-1",
    kind: "assistant_outbound",
    targetId: "ao-target",
    metadata: { workspaceId: WS_ID, handle: HANDLE },
    scheduledAt: pastDate(),
    purgedAt: null
  };
  const pods: WarmPod[] = [{ podName: POD_NAME, assistantId: ASST_ID, handle: HANDLE }];
  const { gc, prisma, exec, storage, audit } = makeGcService([lease], pods);

  await gc.runDuePurgesNow();

  // ADR-128 Slice 4 — flat workspace, no /workspace/outbound/<handle> subtree
  // to remove. Lease is marked purged so producers do not stall.
  assert.equal(exec.shellCalls.length, 0);
  assert.equal(storage.deletedPrefixes.length, 0);
  assert.deepEqual(prisma.updatedLeases, ["lease-ao-1"]);
  assert.equal(audit.purgedEvents[0]?.kind, "assistant_outbound");
});

test("WorkspaceGcService: workspace_shared lease past-due → rm persisted workspace dirs, GCS prefix deleted, purgedAt set", async () => {
  const lease: GcLease = {
    id: "lease-ws-1",
    kind: "workspace_shared",
    targetId: WS_ID,
    metadata: {},
    scheduledAt: pastDate(),
    purgedAt: null
  };
  const pods: WarmPod[] = [{ podName: POD_NAME, assistantId: ASST_ID, handle: HANDLE }];
  const { gc, prisma, exec, storage, audit } = makeGcService([lease], pods);

  await gc.runDuePurgesNow();

  // ADR-128 Slice 4 — flat workspace: wipe every entry under /workspace/ in one shell.
  assert.equal(exec.shellCalls.length, 1);
  assert.ok(exec.shellCalls[0]?.shellCommand.includes("/workspace"));
  assert.ok(exec.shellCalls[0]?.shellCommand.includes("rm -rf"));
  assert.ok(!exec.shellCalls[0]?.shellCommand.includes("/workspace/input"));
  assert.ok(!exec.shellCalls[0]?.shellCommand.includes("/workspace/outbound"));
  // GCS workspace prefix
  assert.equal(storage.deletedPrefixes.length, 1);
  assert.ok(storage.deletedPrefixes[0]?.includes(WS_ID));
  assert.deepEqual(prisma.updatedLeases, ["lease-ws-1"]);
  assert.equal(audit.purgedEvents[0]?.kind, "workspace_shared");
});

test("WorkspaceGcService: malformed metadata → purgedAt NOT set, workspace_gc_purge_failed emitted", async () => {
  const lease: GcLease = {
    id: "lease-bad",
    kind: "chat_scratch",
    targetId: CHAT_ID,
    // Missing required fields → Zod parse will throw
    metadata: { invalid: true },
    scheduledAt: pastDate(),
    purgedAt: null
  };
  const { gc, prisma, exec, storage, audit } = makeGcService([lease]);

  await gc.runDuePurgesNow();

  // No exec, no GCS, no purgedAt update
  assert.equal(exec.shellCalls.length, 0);
  assert.equal(storage.deletedPrefixes.length, 0);
  assert.deepEqual(prisma.updatedLeases, []);
  // Failure audit event
  assert.equal(audit.failedEvents.length, 1);
  assert.equal(audit.failedEvents[0]?.leaseId, "lease-bad");
  assert.equal(audit.purgedEvents.length, 0);
});

test("WorkspaceGcService: exception on first lease does not prevent processing second lease", async () => {
  const badLease: GcLease = {
    id: "lease-fail",
    kind: "chat_scratch",
    targetId: "x",
    metadata: { bad: true }, // malformed → throws
    scheduledAt: pastDate(),
    purgedAt: null
  };
  const goodLease: GcLease = {
    id: "lease-ok",
    kind: "workspace_shared",
    targetId: WS_ID,
    metadata: {},
    scheduledAt: pastDate(),
    purgedAt: null
  };
  const { gc, prisma, audit } = makeGcService([badLease, goodLease]);

  await gc.runDuePurgesNow();

  // First lease failed → failure event, no update
  assert.ok(audit.failedEvents.some((e) => e.leaseId === "lease-fail"));
  // Second lease succeeded → purged
  assert.ok(prisma.updatedLeases.includes("lease-ok"));
  assert.ok(audit.purgedEvents.some((e) => e.leaseId === "lease-ok"));
});

test("WorkspaceGcService: lease with purgedAt set is ignored (filtered by DB layer)", async () => {
  // Simulate the DB correctly filtering out already-purged leases: findMany returns [].
  const alreadyPurgedLease: GcLease = {
    id: "lease-done",
    kind: "workspace_shared",
    targetId: WS_ID,
    metadata: {},
    scheduledAt: pastDate(),
    purgedAt: new Date() // already purged
  };
  const { gc, prisma, exec, storage, audit } = makeGcService([alreadyPurgedLease]);

  await gc.runDuePurgesNow();

  // The fake findMany filters purgedAt !== null → no leases returned → no side effects
  assert.equal(exec.shellCalls.length, 0);
  assert.equal(storage.deletedPrefixes.length, 0);
  assert.deepEqual(prisma.updatedLeases, []);
  assert.equal(audit.purgedEvents.length, 0);
  assert.equal(audit.failedEvents.length, 0);
});
