import { HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma, type AssistantSandboxEgressMode as PrismaSandboxEgressMode } from "@prisma/client";
import { ApiErrorHttpException } from "../../platform-core/interface/http/api-error";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  createAssistantInboundConflict,
  createAssistantInboundInfraError,
  createAssistantInboundValidationError
} from "./assistant-inbound-error";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";
import { SandboxControlPlaneClientService } from "./sandbox-control-plane.client.service";

export type AssistantSandboxEgressMode = "restricted" | "full_public";

export type AssistantSandboxEgressState = {
  assistantId: string;
  mode: AssistantSandboxEgressMode;
  /**
   * ADR-146 D6 — true only when this PUT actually deleted at least one warm
   * execution pod and waited until it was absent. GET always reports false.
   */
  recycled: boolean;
};

export type UpdateAssistantSandboxEgressRequest = {
  mode: AssistantSandboxEgressMode;
};

const ALLOWED_MODES: readonly AssistantSandboxEgressMode[] = ["restricted", "full_public"];
const BUSY_SANDBOX_JOB_STATUSES = ["queued", "running"] as const;

type LockedAssistantSandboxEgressRow = {
  id: string;
  userId: string;
  workspaceId: string;
  sandboxEgressMode: AssistantSandboxEgressMode;
};

function isSandboxEgressMode(value: unknown): value is AssistantSandboxEgressMode {
  return typeof value === "string" && ALLOWED_MODES.includes(value as AssistantSandboxEgressMode);
}

@Injectable()
export class ManageAssistantSandboxEgressService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    private readonly sandboxControlPlaneClient: SandboxControlPlaneClientService
  ) {}

  parseUpdateInput(payload: unknown): UpdateAssistantSandboxEgressRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw createAssistantInboundValidationError(
        "sandbox_egress_invalid_body",
        "Sandbox egress payload must be an object."
      );
    }

    const body = payload as Record<string, unknown>;
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== "mode") {
      throw createAssistantInboundValidationError(
        "sandbox_egress_invalid_body",
        'Sandbox egress payload must be exactly { "mode": "restricted" | "full_public" }.'
      );
    }

    if (!isSandboxEgressMode(body.mode)) {
      throw createAssistantInboundValidationError(
        "sandbox_egress_invalid_mode",
        'mode must be one of: "restricted", "full_public".'
      );
    }

    return { mode: body.mode };
  }

  async get(userId: string, assistantId: string): Promise<AssistantSandboxEgressState> {
    const assistant = await this.resolveOwnedAssistant(userId, assistantId);
    return {
      assistantId: assistant.id,
      mode: assistant.sandboxEgressMode,
      recycled: false
    };
  }

  async put(
    userId: string,
    assistantId: string,
    request: UpdateAssistantSandboxEgressRequest
  ): Promise<AssistantSandboxEgressState> {
    this.assertAuthenticatedUserId(userId);
    const resolved = await this.resolveActiveAssistantService.execute({ userId, assistantId });

    // DB + audit commit first. Eviction is intentionally outside the transaction:
    // Kubernetes is not transactional with Postgres, and we never claim a fake rollback.
    const committed = await this.prisma.$transaction(async (tx) => {
      // This parent-row lock is shared with SandboxJob admission through the
      // real `sandbox_jobs.assistant_id -> assistants.id` FK. PostgreSQL checks
      // that FK with a KEY SHARE row lock, which conflicts with FOR UPDATE and
      // is retained until the inserting transaction ends. Therefore:
      // - an already-admitting job commits before this lock, then is visible to
      //   the busy query below; or
      // - this transaction locks first, and the job insert waits until the
      //   mode update/audit commits, admitting strictly after this mutation.
      const rows = await tx.$queryRaw<LockedAssistantSandboxEgressRow[]>(Prisma.sql`
        SELECT
          "id",
          "user_id" AS "userId",
          "workspace_id" AS "workspaceId",
          "sandbox_egress_mode" AS "sandboxEgressMode"
        FROM "assistants"
        WHERE "id" = ${resolved.assistantId}::uuid
          AND "user_id" = ${userId}::uuid
          AND "workspace_id" = ${resolved.workspaceId}::uuid
        FOR UPDATE
      `);
      const assistant = rows[0];
      if (assistant === undefined) {
        throw this.createOwnerForbiddenError();
      }

      // Busy check always runs before mutation or eviction — never silently kill
      // a live queued/running operation, including same-mode reconcile.
      const busyJob = await tx.sandboxJob.findFirst({
        where: {
          assistantId: assistant.id,
          status: { in: [...BUSY_SANDBOX_JOB_STATUSES] }
        },
        select: { id: true, status: true }
      });
      if (busyJob !== null) {
        throw createAssistantInboundConflict(
          "sandbox_egress_change_busy",
          "Sandbox egress mode cannot change while a sandbox job is queued or running for this assistant.",
          {
            assistantId: assistant.id,
            sandboxJobId: busyJob.id,
            sandboxJobStatus: busyJob.status
          }
        );
      }

      const modeChanged = assistant.sandboxEgressMode !== request.mode;
      if (modeChanged) {
        const previousMode = assistant.sandboxEgressMode;
        await tx.assistant.update({
          where: { id: assistant.id },
          data: {
            sandboxEgressMode: request.mode as PrismaSandboxEgressMode
          }
        });

        await tx.assistantAuditEvent.create({
          data: {
            workspaceId: assistant.workspaceId,
            assistantId: assistant.id,
            actorUserId: userId,
            eventCategory: "assistant_sandbox",
            eventCode: "assistant.sandbox_egress_mode_updated",
            summary: "Assistant sandbox egress mode updated.",
            outcome: "succeeded",
            details: {
              previousMode,
              selectedMode: request.mode,
              actorUserId: userId
            }
          }
        });
      }

      return {
        assistantId: assistant.id,
        mode: request.mode,
        modeChanged
      };
    });

    try {
      const reconcile = await this.sandboxControlPlaneClient.reconcileAssistantSandboxEgress({
        assistantId: committed.assistantId,
        mode: committed.mode,
        scope: committed.modeChanged ? "all" : "stale_only"
      });
      return {
        assistantId: committed.assistantId,
        mode: committed.mode,
        recycled: reconcile.recycled
      };
    } catch {
      // Mode (and audit, when changed) already committed. Future execution stays
      // fail-closed against DB/pod mismatch; caller must retry reconcile.
      throw createAssistantInboundInfraError(
        "sandbox_egress_recycle_failed",
        "Sandbox egress mode was saved but warm execution pods could not be reconciled. Retry the request.",
        HttpStatus.SERVICE_UNAVAILABLE,
        {
          assistantId: committed.assistantId,
          mode: committed.mode,
          modeChanged: committed.modeChanged
        }
      );
    }
  }

  private async resolveOwnedAssistant(
    userId: string,
    assistantId: string
  ): Promise<{
    id: string;
    userId: string;
    workspaceId: string;
    sandboxEgressMode: AssistantSandboxEgressMode;
  }> {
    this.assertAuthenticatedUserId(userId);

    const resolved = await this.resolveActiveAssistantService.execute({
      userId,
      assistantId
    });

    // ResolveActiveAssistantService proves workspace membership. ADR-146 D1
    // requires the Assistant owner (`Assistant.userId`) specifically.
    if (resolved.assistant.userId !== userId) {
      throw this.createOwnerForbiddenError();
    }

    const row = await this.prisma.assistant.findFirst({
      where: {
        id: resolved.assistantId,
        userId,
        workspaceId: resolved.workspaceId
      },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        sandboxEgressMode: true
      }
    });
    if (row === null) {
      throw this.createOwnerForbiddenError();
    }

    return {
      id: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      sandboxEgressMode: row.sandboxEgressMode as AssistantSandboxEgressMode
    };
  }

  private assertAuthenticatedUserId(userId: string): void {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
  }

  private createOwnerForbiddenError(): ApiErrorHttpException {
    return new ApiErrorHttpException(HttpStatus.FORBIDDEN, {
      code: "sandbox_egress_forbidden",
      category: "forbidden",
      message: "Only the assistant owner may read or change sandbox egress mode."
    });
  }
}
