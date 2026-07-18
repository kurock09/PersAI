import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExecPodJobBinding } from "../src/exec-pod-bridge.service";
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

function createSandboxService(
  jobs: Map<string, JobRow>,
  bridge?: {
    cleanupBoundSessionPod?: (input: { binding: ExecPodJobBinding }) => Promise<unknown>;
    retireModelJobPod?: (input: { binding: ExecPodJobBinding }) => Promise<unknown>;
  }
): SandboxService {
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
    (bridge ?? null) as never,
    null as never,
    {} as never
  );
}

const SAMPLE_BINDING: ExecPodJobBinding = {
  namespace: "sandbox",
  podName: "pod-1",
  podUid: "uid-1",
  podResourceVersion: "1",
  leaseToken: "lease",
  leaseHolderId: "holder",
  jobId: "job-3",
  assistantId: "assistant-1",
  workspaceId: "workspace-1",
  assistantHandle: "handle",
  mode: "restricted"
};

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

  test("cancelJob aborts the controller and TERM/KILL-cleans a bound session pod", async () => {
    const jobs = new Map<string, JobRow>([
      [
        "job-3",
        {
          id: "job-3",
          status: "running",
          toolCode: "shell",
          policySnapshot: null,
          createdAt: new Date(),
          startedAt: new Date(),
          completedAt: null,
          violationCode: null,
          violationMessage: null,
          resultPayload: null
        }
      ]
    ]);
    let cleanedBinding: ExecPodJobBinding | undefined;
    const service = createSandboxService(jobs, {
      cleanupBoundSessionPod: async ({ binding }) => {
        cleanedBinding = binding;
        return { podName: binding.podName, podUid: binding.podUid };
      },
      retireModelJobPod: async () => {
        throw new Error("ephemeral retirement must not run for session jobs");
      }
    });
    const controller = new AbortController();
    (
      service as unknown as {
        activeJobAbortControllers: Map<string, AbortController>;
        activeJobBindings: Map<
          string,
          {
            binding: ExecPodJobBinding;
            runtimeSessionId: string | null;
            processCleanupStarted: boolean;
          }
        >;
      }
    ).activeJobAbortControllers.set("job-3", controller);
    (
      service as unknown as {
        activeJobBindings: Map<
          string,
          {
            binding: ExecPodJobBinding;
            runtimeSessionId: string | null;
            processCleanupStarted: boolean;
          }
        >;
      }
    ).activeJobBindings.set("job-3", {
      binding: SAMPLE_BINDING,
      runtimeSessionId: "session-1",
      processCleanupStarted: false
    });

    const result = await service.cancelJob("job-3");
    assert.equal(result.status, "cancelled");
    assert.equal(controller.signal.aborted, true);
    assert.equal(cleanedBinding?.podName, "pod-1");
    assert.equal(jobs.get("job-3")?.violationCode, "user_stopped");
  });

  test("cancelJob retires ephemeral pods on cancel", async () => {
    const jobs = new Map<string, JobRow>([
      [
        "job-4",
        {
          id: "job-4",
          status: "running",
          toolCode: "exec",
          policySnapshot: null,
          createdAt: new Date(),
          startedAt: new Date(),
          completedAt: null,
          violationCode: null,
          violationMessage: null,
          resultPayload: null
        }
      ]
    ]);
    let retired = false;
    const service = createSandboxService(jobs, {
      cleanupBoundSessionPod: async () => {
        throw new Error("session cleanup must not run for ephemeral jobs");
      },
      retireModelJobPod: async () => {
        retired = true;
        return { podName: "pod-1", podUid: "uid-1", retired: true };
      }
    });
    (
      service as unknown as {
        activeJobBindings: Map<
          string,
          {
            binding: ExecPodJobBinding;
            runtimeSessionId: string | null;
            processCleanupStarted: boolean;
          }
        >;
      }
    ).activeJobBindings.set("job-4", {
      binding: { ...SAMPLE_BINDING, jobId: "job-4" },
      runtimeSessionId: null,
      processCleanupStarted: false
    });

    const result = await service.cancelJob("job-4");
    assert.equal(result.status, "cancelled");
    assert.equal(retired, true);
  });
});
