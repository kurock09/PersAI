import { HttpStatus, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApiErrorHttpException } from "../../platform-core/interface/http/api-error";
import type { AssistantRole } from "../domain/assistant-role.entity";
import {
  ASSISTANT_ROLE_REPOSITORY,
  type AssistantRoleRepository
} from "../domain/assistant-role.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { createAssistantInboundValidationError } from "./assistant-inbound-error";
import { lockAssistantChatRows, lockAssistantRoleRows } from "./assistant-skill-mutation-locks";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROLE_ASSIGNMENT_ATTEMPTS = 3;

export type AssistantRoleState = {
  id: string;
  key: string;
  name: Record<string, string>;
  description: Record<string, string>;
  mission: Record<string, string>;
  category: string;
  iconEmoji: string | null;
  color: string | null;
  displayOrder: number;
};

export type AssistantRoleSelectionState = {
  assistantId: string;
  role: AssistantRoleState;
};

export type UpdateAssistantRoleRequest = {
  roleKey: string;
};

type LockedOwnedAssistantRow = {
  id: string;
  userId: string;
  workspaceId: string;
  roleId: string;
};

type DatabaseClockRow = {
  configDirtyAt: Date;
};

export type AssistantRoleAssignmentOutcome =
  | {
      kind: "retry";
      currentRoleId: string;
    }
  | {
      kind: "updated";
      value: {
        assistantId: string;
        roleId: string;
      };
    };

@Injectable()
export class ManageAssistantRolesService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_ROLE_REPOSITORY)
    private readonly assistantRoleRepository: AssistantRoleRepository
  ) {}

  parseUpdateInput(payload: unknown): UpdateAssistantRoleRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw createAssistantInboundValidationError(
        "assistant_role_invalid_body",
        'Assistant role payload must be exactly { "roleKey": "<immutable key>" }.'
      );
    }

    const body = payload as Record<string, unknown>;
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== "roleKey") {
      throw createAssistantInboundValidationError(
        "assistant_role_invalid_body",
        'Assistant role payload must be exactly { "roleKey": "<immutable key>" }.'
      );
    }

    const roleKey = typeof body.roleKey === "string" ? body.roleKey.trim() : "";
    if (roleKey.length === 0) {
      throw createAssistantInboundValidationError(
        "assistant_role_invalid_key",
        "roleKey is required."
      );
    }

    return { roleKey };
  }

  parseAssistantId(value: unknown): string {
    const assistantId = typeof value === "string" ? value.trim() : "";
    if (!UUID_PATTERN.test(assistantId)) {
      throw createAssistantInboundValidationError(
        "assistant_role_invalid_assistant_id",
        "assistantId must be a valid UUID."
      );
    }
    return assistantId;
  }

  async listCatalog(userId: string): Promise<AssistantRoleState[]> {
    this.assertAuthenticatedUserId(userId);
    await this.resolveActiveAssistantService.resolveMembership(userId);
    const roles = await this.assistantRoleRepository.findActiveCatalog();
    return roles.map((role) => this.toState(role));
  }

  async getCurrentRole(userId: string, assistantId: string): Promise<AssistantRoleSelectionState> {
    const assistant = await this.resolveOwnedAssistant(userId, assistantId);
    const role = await this.assistantRoleRepository.findById(assistant.roleId);
    if (role === null) {
      throw new NotFoundException("Assistant role not found.");
    }
    return {
      assistantId: assistant.id,
      role: this.toState(role)
    };
  }

  async putCurrentRole(
    userId: string,
    assistantId: string,
    request: UpdateAssistantRoleRequest
  ): Promise<AssistantRoleSelectionState> {
    this.assertAuthenticatedUserId(userId);
    const resolved = await this.resolveActiveAssistantService.execute({ userId, assistantId });
    if (resolved.assistant.userId !== userId) {
      throw this.createOwnerForbiddenError();
    }
    const targetRoleSnapshot = await this.assistantRoleRepository.findByKey(request.roleKey);
    if (targetRoleSnapshot === null || targetRoleSnapshot.status !== "active") {
      throw createAssistantInboundValidationError(
        "assistant_role_invalid_key",
        "roleKey must reference an active Assistant Role."
      );
    }

    let expectedCurrentRoleId = resolved.assistant.roleId;
    const initialRole = await this.assistantRoleRepository.findById(expectedCurrentRoleId);
    if (initialRole === null) {
      throw new NotFoundException("Current Assistant role not found.");
    }
    let expectedRoleKey = initialRole.key;
    let updated: { assistantId: string; roleId: string } | null = null;
    for (let attempt = 1; attempt <= MAX_ROLE_ASSIGNMENT_ATTEMPTS; attempt += 1) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        return this.applyRoleSelectionInTransaction(tx, {
          assistantId: resolved.assistantId,
          workspaceId: resolved.workspaceId,
          ownerUserId: userId,
          actorUserId: userId,
          expectedCurrentRoleId,
          expectedRoleKey,
          roleKey: request.roleKey
        });
      });
      if (outcome.kind === "updated") {
        updated = outcome.value;
        break;
      }
      expectedCurrentRoleId = outcome.currentRoleId;
      const currentRole = await this.assistantRoleRepository.findById(expectedCurrentRoleId);
      if (currentRole === null) {
        throw new NotFoundException("Current Assistant role not found.");
      }
      expectedRoleKey = currentRole.key;
    }
    if (updated === null) {
      throw new ApiErrorHttpException(HttpStatus.CONFLICT, {
        code: "assistant_role_assignment_retry_exhausted",
        category: "conflict",
        message: "Assistant role changed concurrently. Retry the request."
      });
    }

    const role = await this.assistantRoleRepository.findById(updated.roleId);
    if (role === null) {
      throw new NotFoundException("Assistant role not found.");
    }
    return {
      assistantId: updated.assistantId,
      role: this.toState(role)
    };
  }

  async applyRoleSelectionInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      assistantId: string;
      workspaceId: string;
      ownerUserId: string;
      actorUserId: string;
      expectedCurrentRoleId: string;
      expectedRoleKey: string;
      roleKey: string;
    }
  ): Promise<AssistantRoleAssignmentOutcome> {
    const expectedRoleSnapshot = await tx.assistantRole.findUnique({
      where: { key: input.expectedRoleKey },
      select: { id: true }
    });
    if (expectedRoleSnapshot === null || expectedRoleSnapshot.id !== input.expectedCurrentRoleId) {
      return { kind: "retry", currentRoleId: input.expectedCurrentRoleId };
    }
    const targetRoleSnapshot = await tx.assistantRole.findFirst({
      where: {
        key: input.roleKey,
        status: "active"
      },
      select: { id: true }
    });
    if (targetRoleSnapshot === null) {
      throw createAssistantInboundValidationError(
        "assistant_role_invalid_key",
        "roleKey must reference an active Assistant Role."
      );
    }

    const lockedRoles = await lockAssistantRoleRows(tx, [
      input.expectedCurrentRoleId,
      targetRoleSnapshot.id
    ]);
    const targetRole = lockedRoles.find((role) => role.id === targetRoleSnapshot.id);
    if (targetRole === undefined || targetRole.status !== "active") {
      throw createAssistantInboundValidationError(
        "assistant_role_invalid_key",
        "roleKey must reference an active Assistant Role."
      );
    }

    const assistantRows = await tx.$queryRaw<LockedOwnedAssistantRow[]>(Prisma.sql`
      SELECT
        "id",
        "user_id" AS "userId",
        "workspace_id" AS "workspaceId",
        "role_id" AS "roleId"
      FROM "assistants"
      WHERE "id" = ${input.assistantId}::uuid
        AND "user_id" = ${input.ownerUserId}::uuid
        AND "workspace_id" = ${input.workspaceId}::uuid
      FOR UPDATE
    `);
    const assistant = assistantRows[0];
    if (assistant === undefined) {
      throw this.createOwnerForbiddenError();
    }
    if (assistant.roleId !== input.expectedCurrentRoleId) {
      return { kind: "retry", currentRoleId: assistant.roleId };
    }

    const previousRole = lockedRoles.find((role) => role.id === assistant.roleId);
    if (previousRole === undefined) {
      throw new NotFoundException("Current Assistant role not found.");
    }
    if (assistant.roleId === targetRole.id) {
      return {
        kind: "updated",
        value: { assistantId: assistant.id, roleId: targetRole.id }
      };
    }

    await lockAssistantChatRows(tx, [assistant.id]);
    const clockRows = await tx.$queryRaw<DatabaseClockRow[]>(Prisma.sql`
      SELECT clock_timestamp() AS "configDirtyAt"
    `);
    const configDirtyAt = clockRows[0]?.configDirtyAt;
    if (configDirtyAt === undefined) {
      throw new Error("Database clock did not return an Assistant Role dirty timestamp.");
    }

    await tx.assistant.update({
      where: { id: assistant.id },
      data: {
        roleId: targetRole.id,
        configDirtyAt
      }
    });
    await tx.assistantChat.updateMany({
      where: { assistantId: assistant.id },
      data: {
        skillDecisionState: Prisma.DbNull,
        skillRetrievalState: Prisma.DbNull
      }
    });
    await tx.assistantAuditEvent.create({
      data: {
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        actorUserId: input.actorUserId,
        eventCategory: "assistant_configuration",
        eventCode: "assistant.role_updated",
        summary: "Assistant role updated.",
        outcome: "succeeded",
        details: {
          previousRoleId: previousRole.id,
          previousRoleKey: previousRole.key,
          selectedRoleId: targetRole.id,
          selectedRoleKey: targetRole.key,
          actorUserId: input.actorUserId
        }
      }
    });

    return {
      kind: "updated",
      value: { assistantId: assistant.id, roleId: targetRole.id }
    };
  }

  private async resolveOwnedAssistant(
    userId: string,
    assistantId: string
  ): Promise<{
    id: string;
    userId: string;
    workspaceId: string;
    roleId: string;
  }> {
    this.assertAuthenticatedUserId(userId);
    const resolved = await this.resolveActiveAssistantService.execute({ userId, assistantId });
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
        roleId: true
      }
    });
    if (row === null) {
      throw this.createOwnerForbiddenError();
    }
    return row;
  }

  private toState(role: AssistantRole): AssistantRoleState {
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      mission: role.mission,
      category: role.category,
      iconEmoji: role.iconEmoji,
      color: role.color,
      displayOrder: role.displayOrder
    };
  }

  private assertAuthenticatedUserId(userId: string): void {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
  }

  private createOwnerForbiddenError(): ApiErrorHttpException {
    return new ApiErrorHttpException(HttpStatus.FORBIDDEN, {
      code: "assistant_role_forbidden",
      category: "forbidden",
      message: "Only the assistant owner may read or change the assistant role."
    });
  }
}
