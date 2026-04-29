import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import type {
  AssistantNotificationDeliveryStatus,
  AssistantNotificationSource
} from "./assistant-notification-delivery.service";

export type AssistantNotificationOutboxEnqueueInput = {
  assistantId: string;
  source: AssistantNotificationSource;
  sourceId: string;
  status: AssistantNotificationDeliveryStatus;
  text?: string;
  artifacts?: RuntimeOutputArtifact[];
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
};

export type AssistantNotificationOutboxEnqueueResult = {
  id: string;
  status: "pending" | "skipped" | "delivered" | "failed" | "in_progress" | "dead_letter";
  dedupeKey: string;
  created: boolean;
};

type NotificationAssistantRef = {
  id: string;
  userId: string;
  workspaceId: string;
};

@Injectable()
export class AssistantNotificationOutboxService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async enqueue(
    input: AssistantNotificationOutboxEnqueueInput
  ): Promise<AssistantNotificationOutboxEnqueueResult> {
    const assistant = await this.loadAssistant(input.assistantId);
    const dedupeKey = input.dedupeKey ?? this.buildDedupeKey(input);
    const text = input.text?.trim();
    const initialStatus = input.status === "ok" && text ? "pending" : "skipped";
    const existing = await this.prisma.assistantNotificationOutbox.findUnique({
      where: { dedupeKey },
      select: { id: true, status: true }
    });
    if (existing !== null) {
      return {
        id: existing.id,
        status: existing.status,
        dedupeKey,
        created: false
      };
    }

    const created = await this.prisma.assistantNotificationOutbox.create({
      data: {
        assistantId: assistant.id,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        source: input.source,
        sourceId: input.sourceId,
        dedupeKey,
        status: initialStatus,
        deliveryStatus: input.status,
        ...(text === undefined ? {} : { text }),
        ...(input.artifacts === undefined
          ? {}
          : { artifactsJson: this.toJsonValue(input.artifacts) }),
        ...(input.metadata === undefined ? {} : { metadataJson: this.toJsonValue(input.metadata) }),
        ...(initialStatus === "skipped" ? { skippedAt: new Date() } : {})
      },
      select: { id: true, status: true }
    });

    return {
      id: created.id,
      status: created.status,
      dedupeKey,
      created: true
    };
  }

  private async loadAssistant(assistantId: string): Promise<NotificationAssistantRef> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: assistantId },
      select: { id: true, userId: true, workspaceId: true }
    });
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    return assistant;
  }

  private buildDedupeKey(input: AssistantNotificationOutboxEnqueueInput): string {
    return `${input.source}:${input.assistantId}:${input.sourceId}`;
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
