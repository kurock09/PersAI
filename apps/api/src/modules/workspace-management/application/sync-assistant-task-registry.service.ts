import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AssistantTaskRegistryControlStatus } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type InternalTaskRegistrySyncControlStatus = "active" | "disabled" | "cancelled";

export interface InternalTaskRegistrySyncUpsertRequest {
  operation: "upsert";
  assistantId: string;
  externalRef: string;
  title: string;
  sourceSurface: "web";
  sourceLabel?: string | null;
  controlStatus: InternalTaskRegistrySyncControlStatus;
  nextRunAt?: string | null;
}

export interface InternalTaskRegistrySyncDeleteRequest {
  operation: "delete";
  assistantId: string;
  externalRef: string;
}

export type InternalTaskRegistrySyncRequest =
  | InternalTaskRegistrySyncUpsertRequest
  | InternalTaskRegistrySyncDeleteRequest;

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new BadRequestException("sourceLabel must be a string, null, or omitted.");
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeControlStatus(value: unknown): InternalTaskRegistrySyncControlStatus {
  if (value === "active" || value === "disabled" || value === "cancelled") {
    return value;
  }
  throw new BadRequestException("controlStatus must be active, disabled, or cancelled.");
}

function normalizeNextRunAt(value: unknown): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException("nextRunAt must be an ISO datetime string, null, or omitted.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("nextRunAt must be a valid ISO datetime string.");
  }
  return parsed;
}

@Injectable()
export class SyncAssistantTaskRegistryService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  parseInput(payload: unknown): InternalTaskRegistrySyncRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Task registry sync payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const operation = body.operation;
    if (operation === "delete") {
      return {
        operation,
        assistantId: normalizeRequiredString(body.assistantId, "assistantId"),
        externalRef: normalizeRequiredString(body.externalRef, "externalRef")
      };
    }

    if (operation === "upsert") {
      const sourceLabel = normalizeOptionalString(body.sourceLabel);
      return {
        operation,
        assistantId: normalizeRequiredString(body.assistantId, "assistantId"),
        externalRef: normalizeRequiredString(body.externalRef, "externalRef"),
        title: normalizeRequiredString(body.title, "title"),
        sourceSurface: "web",
        ...(sourceLabel !== undefined ? { sourceLabel } : {}),
        controlStatus: normalizeControlStatus(body.controlStatus),
        ...(body.nextRunAt !== undefined ? { nextRunAt: body.nextRunAt as string | null } : {})
      };
    }

    throw new BadRequestException("operation must be either upsert or delete.");
  }

  async execute(input: InternalTaskRegistrySyncRequest): Promise<{ ok: true }> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: input.assistantId },
      select: { id: true, userId: true, workspaceId: true }
    });
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }

    if (input.operation === "delete") {
      await this.prisma.assistantTaskRegistryItem.deleteMany({
        where: {
          assistantId: input.assistantId,
          externalRef: input.externalRef
        }
      });
      return { ok: true };
    }

    const nextRunAt = normalizeNextRunAt(input.nextRunAt);
    const controlStatus = input.controlStatus as AssistantTaskRegistryControlStatus;
    await this.prisma.assistantTaskRegistryItem.upsert({
      where: {
        assistantId_externalRef: {
          assistantId: input.assistantId,
          externalRef: input.externalRef
        }
      },
      create: {
        assistantId: input.assistantId,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        title: input.title,
        sourceSurface: "web",
        sourceLabel: input.sourceLabel ?? null,
        controlStatus,
        nextRunAt: nextRunAt ?? null,
        disabledAt: controlStatus === "disabled" ? new Date() : null,
        cancelledAt: controlStatus === "cancelled" ? new Date() : null,
        externalRef: input.externalRef
      },
      update: {
        title: input.title,
        sourceLabel: input.sourceLabel ?? null,
        controlStatus,
        ...(nextRunAt !== undefined ? { nextRunAt } : {}),
        disabledAt: controlStatus === "disabled" ? new Date() : null,
        cancelledAt: controlStatus === "cancelled" ? new Date() : null
      }
    });

    return { ok: true };
  }
}
