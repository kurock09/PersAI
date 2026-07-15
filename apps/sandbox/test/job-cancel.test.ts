import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SandboxService } from "../src/sandbox.service";

type JobRow = {
  id: string;
  status: "queued" | "running" | "completed" | "cancelled" | "failed" | "blocked";
  toolCode: string;
  policySnapshot: null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  violationCode: string | null;
  violationMessage: string | null;
  resultPayload: Record<string, unknown> | null;
};

function createSandboxService(jobs: Map<string, JobRow>): SandboxService {
  const prisma = {
    sandboxJob: {
      findUnique: async ({ where }: { where: { id: string } }) => jobs.get(where.id) ?? null,
      updateMany: async ({
        where,
        data
      }: {
        where: { id: string; status?: { in: string[] }; completedAt: null };
        data: Partial<JobRow>;
      }) => {
        const row = jobs.get(where.id);
        if (row === undefined) {
          return { count: 0 };
        }
        if (where.status?.in !== undefined && !where.status.in.includes(row.status)) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }
    }
  };
  return new SandboxService(
    prisma as never,
    null as never,
    {
      recordLongPoll: () => undefined
    } as never,
    {
      SANDBOX_MAX_POLL_WAIT_MS: 0,
      SANDBOX_QUEUED_JOB_STALE_AFTER_MS: 60_000,
      SANDBOX_EXEC_POD_PROVISION_BUDGET_MS: 1_000,
      SANDBOX_RUNNING_JOB_GRACE_MS: 1_000
    } as never,
    null as never,
    null as never
  );
}

describe("sandbox job cancel endpoint", () => {
  test("cancelJob is idempotent for terminal jobs", async () => {
    const jobs = new Map<string, JobRow>([
      [
        "job-1",
        {
          id: "job-1",
          status: "completed",
          toolCode: "shell",
          policySnapshot: null,
          createdAt: new Date(),
          startedAt: new Date(),
          completedAt: new Date(),
          violationCode: null,
          violationMessage: null,
          resultPayload: {
            reason: null,
            warning: null,
            exitCode: 0,
            stdout: "ok",
            stderr: null,
            content: null
          }
        }
      ]
    ]);
    const service = createSandboxService(jobs);
    const first = await service.cancelJob("job-1");
    const second = await service.cancelJob("job-1");
    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
  });

  test("cancelJob marks queued jobs cancelled", async () => {
    const jobs = new Map<string, JobRow>([
      [
        "job-2",
        {
          id: "job-2",
          status: "queued",
          toolCode: "shell",
          policySnapshot: null,
          createdAt: new Date(),
          startedAt: null,
          completedAt: null,
          violationCode: null,
          violationMessage: null,
          resultPayload: null
        }
      ]
    ]);
    const service = createSandboxService(jobs);
    const result = await service.cancelJob("job-2");
    assert.equal(result.status, "cancelled");
    assert.equal(jobs.get("job-2")?.status, "cancelled");
  });
});
