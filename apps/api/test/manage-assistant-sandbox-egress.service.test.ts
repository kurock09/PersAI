import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NotFoundException } from "@nestjs/common";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { ManageAssistantSandboxEgressService } from "../src/modules/workspace-management/application/manage-assistant-sandbox-egress.service";
import { parsePlanSandboxPolicy } from "../src/modules/workspace-management/application/sandbox-policy";

type AssistantRow = {
  id: string;
  userId: string;
  workspaceId: string;
  sandboxEgressMode: "restricted" | "full_public";
};

type SandboxJobRow = {
  id: string;
  assistantId: string;
  workspaceId: string;
  status: "queued" | "running" | "completed" | "failed" | "blocked" | "cancelled";
};

type AuditRow = {
  workspaceId: string;
  assistantId: string;
  actorUserId: string;
  eventCategory: string;
  eventCode: string;
  summary: string;
  outcome: string;
  details: Record<string, unknown>;
};

type RawQuery = {
  values?: unknown[];
};

class FakePrismaService {
  assistants = new Map<string, AssistantRow>();
  jobs: SandboxJobRow[] = [];
  auditRows: AuditRow[] = [];
  operations: string[] = [];
  busyWheres: Array<Record<string, unknown>> = [];
  failAuditCreate = false;
  private transactionTail: Promise<void> = Promise.resolve();

  assistant = {
    findFirst: async ({
      where
    }: {
      where: { id: string; userId: string; workspaceId: string };
    }): Promise<AssistantRow | null> => {
      const row = this.assistants.get(where.id);
      return row?.userId === where.userId && row.workspaceId === where.workspaceId ? row : null;
    }
  };

  async $transaction<T>(callback: (tx: FakePrismaTransaction) => Promise<T>): Promise<T> {
    const prior = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;

    const assistantSnapshot = new Map(
      Array.from(this.assistants, ([id, row]) => [id, { ...row }] as const)
    );
    const auditLength = this.auditRows.length;
    try {
      this.operations.push("transaction:begin");
      const result = await callback(new FakePrismaTransaction(this));
      this.operations.push("transaction:commit");
      return result;
    } catch (error) {
      this.assistants = assistantSnapshot;
      this.auditRows.length = auditLength;
      this.operations.push("transaction:rollback");
      throw error;
    } finally {
      release();
    }
  }
}

class FakePrismaTransaction {
  constructor(private readonly prisma: FakePrismaService) {}

  async $queryRaw<T>(query: RawQuery): Promise<T> {
    this.prisma.operations.push("assistant:lock-for-update");
    const [assistantId, userId, workspaceId] = query.values ?? [];
    const row =
      typeof assistantId === "string" ? this.prisma.assistants.get(assistantId) : undefined;
    const matches =
      row !== undefined && row.userId === userId && row.workspaceId === workspaceId ? [row] : [];
    return matches.map((item) => ({ ...item })) as T;
  }

  sandboxJob = {
    findFirst: async ({
      where
    }: {
      where: {
        assistantId: string;
        status: { in: string[] };
      };
    }): Promise<SandboxJobRow | null> => {
      this.prisma.operations.push("sandbox-job:busy-check");
      this.prisma.busyWheres.push(where);
      return (
        this.prisma.jobs.find(
          (job) => job.assistantId === where.assistantId && where.status.in.includes(job.status)
        ) ?? null
      );
    }
  };

  assistant = {
    update: async ({
      where,
      data
    }: {
      where: { id: string };
      data: { sandboxEgressMode: "restricted" | "full_public" };
    }): Promise<AssistantRow> => {
      this.prisma.operations.push("assistant:update");
      const row = this.prisma.assistants.get(where.id);
      if (row === undefined) {
        throw new Error("missing assistant");
      }
      row.sandboxEgressMode = data.sandboxEgressMode;
      return row;
    }
  };

  assistantAuditEvent = {
    create: async ({ data }: { data: AuditRow }): Promise<{ id: string }> => {
      this.prisma.operations.push("audit:create");
      if (this.prisma.failAuditCreate) {
        throw new Error("audit insert failed");
      }
      this.prisma.auditRows.push(data);
      return { id: `audit-${this.prisma.auditRows.length}` };
    }
  };
}

class FakeResolveActiveAssistantService {
  constructor(private readonly assistants: Map<string, AssistantRow>) {}

  async execute(input: { userId: string; assistantId?: string | null }): Promise<{
    assistantId: string;
    assistant: AssistantRow;
    workspaceId: string;
  }> {
    const assistantId = input.assistantId ?? null;
    const assistant = assistantId === null ? undefined : this.assistants.get(assistantId);
    if (assistant === undefined) {
      throw new NotFoundException("Assistant does not exist for this workspace.");
    }
    // Mirrors ResolveActiveAssistantService: membership resolution may return
    // a same-workspace assistant owned by somebody else. The locked SQL query
    // is the authoritative owner check.
    return {
      assistantId: assistant.id,
      assistant,
      workspaceId: assistant.workspaceId
    };
  }
}

function makeService(prisma: FakePrismaService): ManageAssistantSandboxEgressService {
  return new ManageAssistantSandboxEgressService(
    prisma as unknown as ConstructorParameters<typeof ManageAssistantSandboxEgressService>[0],
    new FakeResolveActiveAssistantService(prisma.assistants) as unknown as ConstructorParameters<
      typeof ManageAssistantSandboxEgressService
    >[1]
  );
}

function seedOwnedAssistant(prisma: FakePrismaService): AssistantRow {
  const row: AssistantRow = {
    id: "assistant-1",
    userId: "owner-1",
    workspaceId: "workspace-1",
    sandboxEgressMode: "restricted"
  };
  prisma.assistants.set(row.id, row);
  return row;
}

async function runExistingDefaultRestricted(): Promise<void> {
  const prisma = new FakePrismaService();
  seedOwnedAssistant(prisma);

  const state = await makeService(prisma).get("owner-1", "assistant-1");
  assert.deepEqual(state, {
    assistantId: "assistant-1",
    mode: "restricted",
    recycled: false
  });
}

async function runChangedModeAtomicAudit(): Promise<void> {
  const prisma = new FakePrismaService();
  seedOwnedAssistant(prisma);

  const result = await makeService(prisma).put("owner-1", "assistant-1", {
    mode: "full_public"
  });

  assert.equal(result.mode, "full_public");
  assert.equal(result.recycled, false);
  assert.equal(prisma.assistants.get("assistant-1")?.sandboxEgressMode, "full_public");
  assert.equal(prisma.auditRows.length, 1);
  assert.deepEqual(prisma.auditRows[0]?.details, {
    previousMode: "restricted",
    selectedMode: "full_public",
    actorUserId: "owner-1"
  });
  assert.deepEqual(prisma.operations, [
    "transaction:begin",
    "assistant:lock-for-update",
    "sandbox-job:busy-check",
    "assistant:update",
    "audit:create",
    "transaction:commit"
  ]);
}

async function runNonOwnerDeniedByLockedRow(): Promise<void> {
  const prisma = new FakePrismaService();
  seedOwnedAssistant(prisma);

  await assert.rejects(
    () => makeService(prisma).put("member-2", "assistant-1", { mode: "full_public" }),
    (error: unknown) => {
      assert.ok(error instanceof ApiErrorHttpException);
      assert.equal(error.getStatus(), 403);
      assert.equal(error.errorObject.code, "sandbox_egress_forbidden");
      return true;
    }
  );
  assert.deepEqual(prisma.operations, [
    "transaction:begin",
    "assistant:lock-for-update",
    "transaction:rollback"
  ]);
  assert.equal(prisma.auditRows.length, 0);
}

async function runUnknownMode400(): Promise<void> {
  const prisma = new FakePrismaService();
  const service = makeService(prisma);

  assert.throws(
    () => service.parseUpdateInput({ mode: "open" }),
    (error: unknown) => {
      assert.ok(error instanceof ApiErrorHttpException);
      assert.equal(error.getStatus(), 400);
      assert.equal(error.errorObject.code, "sandbox_egress_invalid_mode");
      return true;
    }
  );
  assert.throws(
    () => service.parseUpdateInput({ mode: "restricted", extra: true }),
    (error: unknown) => {
      assert.ok(error instanceof ApiErrorHttpException);
      assert.equal(error.errorObject.code, "sandbox_egress_invalid_body");
      return true;
    }
  );
}

async function runBusyAssistantWideDespiteWorkspaceMismatch(): Promise<void> {
  const prisma = new FakePrismaService();
  seedOwnedAssistant(prisma);
  prisma.jobs.push({
    id: "job-1",
    assistantId: "assistant-1",
    workspaceId: "corrupt-mismatched-workspace",
    status: "running"
  });

  await assert.rejects(
    () => makeService(prisma).put("owner-1", "assistant-1", { mode: "full_public" }),
    (error: unknown) => {
      assert.ok(error instanceof ApiErrorHttpException);
      assert.equal(error.getStatus(), 409);
      assert.equal(error.errorObject.code, "sandbox_egress_change_busy");
      return true;
    }
  );
  assert.equal("workspaceId" in (prisma.busyWheres[0] ?? {}), false);
  assert.equal(prisma.assistants.get("assistant-1")?.sandboxEgressMode, "restricted");
  assert.equal(prisma.auditRows.length, 0);
}

async function runSameModeNoAuditInsideTransaction(): Promise<void> {
  const prisma = new FakePrismaService();
  const assistant = seedOwnedAssistant(prisma);
  assistant.sandboxEgressMode = "full_public";

  const result = await makeService(prisma).put("owner-1", "assistant-1", {
    mode: "full_public"
  });

  assert.equal(result.mode, "full_public");
  assert.equal(prisma.auditRows.length, 0);
  assert.deepEqual(prisma.operations, [
    "transaction:begin",
    "assistant:lock-for-update",
    "transaction:commit"
  ]);
}

async function runConcurrentPutsSerializeAndDeduplicateAudit(): Promise<void> {
  const prisma = new FakePrismaService();
  seedOwnedAssistant(prisma);
  const service = makeService(prisma);

  const [first, second] = await Promise.all([
    service.put("owner-1", "assistant-1", { mode: "full_public" }),
    service.put("owner-1", "assistant-1", { mode: "full_public" })
  ]);

  assert.equal(first.mode, "full_public");
  assert.equal(second.mode, "full_public");
  assert.equal(prisma.auditRows.length, 1);
  assert.equal(prisma.operations.filter((operation) => operation === "assistant:update").length, 1);
  assert.equal(
    prisma.operations.filter((operation) => operation === "assistant:lock-for-update").length,
    2
  );
}

async function runAuditFailureRollsBackMode(): Promise<void> {
  const prisma = new FakePrismaService();
  seedOwnedAssistant(prisma);
  prisma.failAuditCreate = true;

  await assert.rejects(
    () => makeService(prisma).put("owner-1", "assistant-1", { mode: "full_public" }),
    /audit insert failed/
  );

  assert.equal(prisma.assistants.get("assistant-1")?.sandboxEgressMode, "restricted");
  assert.equal(prisma.auditRows.length, 0);
  assert.deepEqual(prisma.operations, [
    "transaction:begin",
    "assistant:lock-for-update",
    "sandbox-job:busy-check",
    "assistant:update",
    "audit:create",
    "transaction:rollback"
  ]);
}

async function runSandboxEnqueueSharesAssistantLockContract(): Promise<void> {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "prisma/migrations/20260419010000_step20_sandbox_persistence_foundation/migration.sql"
    ),
    "utf8"
  );
  const sandboxService = readFileSync(
    resolve(process.cwd(), "../sandbox/src/sandbox.service.ts"),
    "utf8"
  );

  assert.match(
    migration,
    /"sandbox_jobs_assistant_id_fkey"\s+FOREIGN KEY\s+\("assistant_id"\)\s+REFERENCES\s+"assistants"\("id"\)/
  );
  assert.match(sandboxService, /this\.prisma\.sandboxJob\.create\(\{\s*data:\s*\{/);
  assert.match(sandboxService, /assistantId:\s*request\.assistantId/);
}

async function runPlanParserRejectsNetworkAccessEnabled(): Promise<void> {
  const base = { ...DEFAULT_RUNTIME_SANDBOX_POLICY };
  assert.throws(
    () => parsePlanSandboxPolicy({ ...base, networkAccessEnabled: false }),
    /networkAccessEnabled is not supported/
  );
  assert.equal("networkAccessEnabled" in parsePlanSandboxPolicy(base), false);
}

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["existing assistant reads restricted by default", runExistingDefaultRestricted],
    ["changed mode locks, checks busy, updates, and audits atomically", runChangedModeAtomicAudit],
    ["non-owner is denied by authoritative locked row", runNonOwnerDeniedByLockedRow],
    ["unknown/extra mode body is stable 400", runUnknownMode400],
    [
      "busy check is assistant-wide despite workspace mismatch",
      runBusyAssistantWideDespiteWorkspaceMismatch
    ],
    ["same-mode PUT exits after lock without audit", runSameModeNoAuditInsideTransaction],
    ["concurrent PUTs serialize and emit one audit", runConcurrentPutsSerializeAndDeduplicateAudit],
    ["audit failure rolls back mode update", runAuditFailureRollsBackMode],
    ["sandbox enqueue shares the Assistant FK lock", runSandboxEnqueueSharesAssistantLockContract],
    ["plan parser never accepts networkAccessEnabled", runPlanParserRejectsNetworkAccessEnabled]
  ];

  let failures = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`fail - ${name}`);
      console.error(error);
    }
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
}

void main();
