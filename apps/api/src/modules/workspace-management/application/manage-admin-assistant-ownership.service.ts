import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type OwnershipFlowMode = "transfer" | "recovery";

export type AdminAssistantOwnershipTransferInput = {
  assistantId: string;
  currentOwnerUserId: string;
  targetOwnerUserId: string;
  reason: string | null;
};

export type AdminAssistantOwnershipRecoveryInput = {
  assistantId: string;
  recoveredOwnerUserId: string;
  supportTicketRef: string | null;
  reason: string | null;
};

export type AssistantOwnershipFlowResult = {
  mode: OwnershipFlowMode;
  assistantId: string;
  workspaceId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
  supportTicketRef: string | null;
  reason: string | null;
  consequences: {
    resetTriggered: false;
    deletionTriggered: false;
    lifecycleVersionsPreserved: true;
    memoryRegistryOwnershipRebound: true;
    chatOwnershipRebound: true;
    taskRegistryOwnershipRebound: true;
    bindingsPreserved: true;
    secretRefsPreserved: true;
    auditHistoryPreserved: true;
  };
};

function toTrimmedRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function toOptionalTrimmedString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${fieldName} must be a string or null.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > 255) {
    throw new BadRequestException(`${fieldName} must be at most 255 characters.`);
  }
  return trimmed;
}

@Injectable()
export class ManageAdminAssistantOwnershipService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  parseTransferInput(body: unknown): AdminAssistantOwnershipTransferInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    return {
      assistantId: toTrimmedRequiredString(row.assistantId, "assistantId"),
      currentOwnerUserId: toTrimmedRequiredString(row.currentOwnerUserId, "currentOwnerUserId"),
      targetOwnerUserId: toTrimmedRequiredString(row.targetOwnerUserId, "targetOwnerUserId"),
      reason: toOptionalTrimmedString(row.reason, "reason")
    };
  }

  parseRecoveryInput(body: unknown): AdminAssistantOwnershipRecoveryInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    return {
      assistantId: toTrimmedRequiredString(row.assistantId, "assistantId"),
      recoveredOwnerUserId: toTrimmedRequiredString(row.recoveredOwnerUserId, "recoveredOwnerUserId"),
      supportTicketRef: toOptionalTrimmedString(row.supportTicketRef, "supportTicketRef"),
      reason: toOptionalTrimmedString(row.reason, "reason")
    };
  }

  async transferOwnership(
    adminUserId: string,
    input: AdminAssistantOwnershipTransferInput,
    stepUpToken: string | null
  ): Promise<AssistantOwnershipFlowResult> {
    const context = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      adminUserId,
      "admin.assistant.transfer_ownership",
      stepUpToken
    );
    return this.reassignOwnership({
      mode: "transfer",
      adminUserId,
      adminWorkspaceId: context.workspaceId,
      assistantId: input.assistantId,
      targetOwnerUserId: input.targetOwnerUserId,
      expectedCurrentOwnerUserId: input.currentOwnerUserId,
      supportTicketRef: null,
      reason: input.reason
    });
  }

  async recoverOwnership(
    adminUserId: string,
    input: AdminAssistantOwnershipRecoveryInput,
    stepUpToken: string | null
  ): Promise<AssistantOwnershipFlowResult> {
    const context = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      adminUserId,
      "admin.assistant.recover_ownership",
      stepUpToken
    );
    return this.reassignOwnership({
      mode: "recovery",
      adminUserId,
      adminWorkspaceId: context.workspaceId,
      assistantId: input.assistantId,
      targetOwnerUserId: input.recoveredOwnerUserId,
      expectedCurrentOwnerUserId: null,
      supportTicketRef: input.supportTicketRef,
      reason: input.reason
    });
  }

  private async reassignOwnership(params: {
    mode: OwnershipFlowMode;
    adminUserId: string;
    adminWorkspaceId: string;
    assistantId: string;
    targetOwnerUserId: string;
    expectedCurrentOwnerUserId: string | null;
    supportTicketRef: string | null;
    reason: string | null;
  }): Promise<AssistantOwnershipFlowResult> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: params.assistantId }
    });
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist.");
    }
    if (assistant.workspaceId !== params.adminWorkspaceId) {
      throw new NotFoundException("Assistant not found in admin workspace.");
    }
    if (
      params.expectedCurrentOwnerUserId !== null &&
      assistant.userId !== params.expectedCurrentOwnerUserId
    ) {
      throw new ConflictException("currentOwnerUserId does not match current assistant owner.");
    }
    if (assistant.userId === params.targetOwnerUserId) {
      throw new ConflictException("Target owner is already the current assistant owner.");
    }
    const targetMembership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: assistant.workspaceId,
          userId: params.targetOwnerUserId
        }
      }
    });
    if (targetMembership === null) {
      throw new ConflictException("Target owner must be a member of assistant workspace.");
    }
    const targetExistingAssistant = await this.prisma.assistant.findUnique({
      where: { userId: params.targetOwnerUserId }
    });
    if (targetExistingAssistant !== null && targetExistingAssistant.id !== assistant.id) {
      throw new ConflictException("Target owner already has an assistant in MVP (1 user = 1 assistant).");
    }

    let updatedAssistantUserId = assistant.userId;
    try {
      const updatedAssistant = await this.prisma.assistant.update({
        where: { id: assistant.id },
        data: {
          userId: params.targetOwnerUserId
        }
      });
      updatedAssistantUserId = updatedAssistant.userId;
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Target owner already has an assistant in MVP (1 user = 1 assistant).");
      }
      throw error;
    }

    const eventCode =
      params.mode === "transfer"
        ? "assistant.ownership_transferred"
        : "assistant.ownership_recovered";
    const summary =
      params.mode === "transfer"
        ? "Assistant ownership transferred by admin flow."
        : "Assistant ownership recovered by admin flow.";
    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      actorUserId: params.adminUserId,
      eventCategory: "admin_action",
      eventCode,
      summary,
      details: {
        mode: params.mode,
        previousOwnerUserId: assistant.userId,
        newOwnerUserId: updatedAssistantUserId,
        supportTicketRef: params.supportTicketRef,
        reason: params.reason,
        consequences: {
          resetTriggered: false,
          deletionTriggered: false,
          lifecycleVersionsPreserved: true,
          memoryRegistryOwnershipRebound: true,
          chatOwnershipRebound: true,
          taskRegistryOwnershipRebound: true,
          bindingsPreserved: true,
          secretRefsPreserved: true,
          auditHistoryPreserved: true
        }
      }
    });

    return {
      mode: params.mode,
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      previousOwnerUserId: assistant.userId,
      newOwnerUserId: updatedAssistantUserId,
      supportTicketRef: params.supportTicketRef,
      reason: params.reason,
      consequences: {
        resetTriggered: false,
        deletionTriggered: false,
        lifecycleVersionsPreserved: true,
        memoryRegistryOwnershipRebound: true,
        chatOwnershipRebound: true,
        taskRegistryOwnershipRebound: true,
        bindingsPreserved: true,
        secretRefsPreserved: true,
        auditHistoryPreserved: true
      }
    };
  }
}
