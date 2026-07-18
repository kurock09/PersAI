import { Injectable } from "@nestjs/common";
import type { AssistantChatSurface, AssistantMediaJobStatus } from "@prisma/client";
import type {
  RuntimeJobDeliveryUpdate,
  RuntimeOpenMediaJobContext,
  RuntimeAttachmentRef,
  RuntimeImageEditRequest,
  RuntimeImageGenerateRequest,
  RuntimeVideoGenerateRequest
} from "@persai/runtime-contract";
import {
  toWebNotifyState,
  type AssistantWebChatActiveMediaJobDisplayKind,
  type AssistantWebChatActiveMediaJobState
} from "./web-chat.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { assertActiveBackgroundJobCap } from "./assert-active-background-job-cap";

export type AssistantMediaJobRequestPayload = {
  attachments: RuntimeAttachmentRef[];
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  runtimeSessionId: string;
  directToolExecution:
    | {
        toolCode: "image_generate";
        request: RuntimeImageGenerateRequest;
      }
    | {
        toolCode: "image_edit";
        request: RuntimeImageEditRequest;
      }
    | {
        toolCode: "video_generate";
        request: RuntimeVideoGenerateRequest;
      };
};

const RECENT_RUNTIME_JOB_DELIVERY_WINDOW_MS = 10 * 60 * 1000;

function toRuntimeOpenMediaJobStatus(
  status: AssistantMediaJobStatus
): RuntimeOpenMediaJobContext["status"] {
  switch (status) {
    case "queued":
    case "running":
      return status;
    default:
      throw new Error(`Unexpected closed media job status in open-job query: ${status}`);
  }
}

function toRuntimeOpenMediaJobToolCode(input: {
  kind: RuntimeOpenMediaJobContext["kind"];
  requestJson: unknown;
}): RuntimeOpenMediaJobContext["toolCode"] {
  const request = input.requestJson as AssistantMediaJobRequestPayload | null;
  const toolCode = request?.directToolExecution?.toolCode;
  if (toolCode === "image_generate" || toolCode === "image_edit" || toolCode === "video_generate") {
    return toolCode;
  }
  switch (input.kind) {
    case "image":
      return "image_generate";
    case "video":
      return "video_generate";
    case "audio":
      return "audio_generate";
    default:
      throw new Error(`Unexpected media job kind in runtime open-job query: ${String(input.kind)}`);
  }
}

function extractRequestedCountFromRequestJson(requestJson: unknown): number | null {
  const payload = requestJson as AssistantMediaJobRequestPayload | null;
  const exec = payload?.directToolExecution;
  if (!exec) return null;
  if (exec.toolCode === "video_generate") return 1;
  if (exec.toolCode === "image_generate" || exec.toolCode === "image_edit") {
    const count = (exec.request as { count?: unknown; seriesItems?: unknown }).count;
    const seriesItems = (exec.request as { seriesItems?: unknown }).seriesItems;
    if (Array.isArray(seriesItems)) {
      const normalizedLength = seriesItems.filter(
        (item) => typeof item === "string" && item.trim().length > 0
      ).length;
      if (normalizedLength > 0) {
        return normalizedLength;
      }
    }
    return typeof count === "number" && Number.isInteger(count) && count > 0 ? count : null;
  }
  return null;
}

function extractSourceSummaryFromRequestJson(requestJson: unknown): string | null {
  const payload = requestJson as AssistantMediaJobRequestPayload | null;
  if (typeof payload?.sourceUserMessageText !== "string") {
    return null;
  }
  const normalized = payload.sourceUserMessageText.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function toWebOpenMediaJobStatus(
  status: AssistantMediaJobStatus
): AssistantWebChatActiveMediaJobState["status"] | null {
  switch (status) {
    case "queued":
    case "running":
    case "completion_pending":
      return status;
    default:
      // Continuation-held delivered/failed jobs stay in Working until the
      // handle settles; map closed statuses onto completion_pending for wire.
      return null;
  }
}

function toWebOpenMediaJobOperation(input: {
  kind: AssistantWebChatActiveMediaJobState["kind"];
  requestJson: unknown;
}): AssistantWebChatActiveMediaJobState["operation"] {
  const request = input.requestJson as AssistantMediaJobRequestPayload | null;
  const toolCode = request?.directToolExecution?.toolCode;
  if (toolCode === "image_generate" || toolCode === "image_edit" || toolCode === "video_generate") {
    return toolCode;
  }
  switch (input.kind) {
    case "image":
      return "image_generate";
    case "video":
      return "video_generate";
    case "audio":
      return "audio_generate";
    default:
      throw new Error(`Unexpected media job kind in web open-job query: ${String(input.kind)}`);
  }
}

/**
 * ADR-109 Slice 10b — projects the runtime-side `mode: "talking_avatar"`
 * field already present on `requestJson.directToolExecution.request` into a
 * web-chat-side display variant. The API never adds new contract fields to
 * `RuntimeVideoGenerateRequest` for this; we just project what the runtime
 * already accepted into the web view DTO. Returns `"cinematic"` defensively
 * for non-video jobs and for video jobs whose mode is missing or any value
 * other than `"talking_avatar"`, so the wire payload always carries an
 * explicit value (never undefined) once Slice 10b ships.
 */
function toWebOpenMediaJobDisplayKind(input: {
  requestJson: unknown;
}): AssistantWebChatActiveMediaJobDisplayKind {
  const request = input.requestJson as AssistantMediaJobRequestPayload | null;
  const exec = request?.directToolExecution;
  if (exec?.toolCode !== "video_generate") {
    return "cinematic";
  }
  return exec.request.mode === "talking_avatar" ? "talking_avatar" : "cinematic";
}

@Injectable()
export class AssistantMediaJobService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async countOpenJobsForChat(input: { assistantId: string; chatId: string }): Promise<number> {
    return this.prisma.assistantMediaJob.count({
      where: {
        assistantId: input.assistantId,
        chatId: input.chatId,
        status: {
          in: ["queued", "running", "completion_pending"]
        }
      }
    });
  }

  async listOpenJobsForChatContext(input: {
    assistantId: string;
    userId: string;
    chatId: string;
  }): Promise<RuntimeOpenMediaJobContext[]> {
    const rows = await this.prisma.assistantMediaJob.findMany({
      where: {
        assistantId: input.assistantId,
        userId: input.userId,
        chatId: input.chatId,
        status: {
          in: ["queued", "running"]
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        kind: true,
        requestJson: true,
        status: true,
        createdAt: true,
        startedAt: true,
        updatedAt: true
      }
    });
    return rows.map((row) => {
      const requestedCount = extractRequestedCountFromRequestJson(row.requestJson);
      return {
        jobId: row.id,
        kind: row.kind,
        toolCode: toRuntimeOpenMediaJobToolCode({
          kind: row.kind,
          requestJson: row.requestJson
        }),
        status: toRuntimeOpenMediaJobStatus(row.status),
        sourceSummary: extractSourceSummaryFromRequestJson(row.requestJson),
        requestedCount,
        expectedResultCount: requestedCount,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }

  async listJobDeliveryUpdatesForChatContext(input: {
    assistantId: string;
    userId: string;
    chatId: string;
  }): Promise<RuntimeJobDeliveryUpdate[]> {
    const recentDeliveredCutoff = new Date(Date.now() - RECENT_RUNTIME_JOB_DELIVERY_WINDOW_MS);
    const [finalizingRows, recentDeliveredRows] = await Promise.all([
      this.prisma.assistantMediaJob.findMany({
        where: {
          assistantId: input.assistantId,
          userId: input.userId,
          chatId: input.chatId,
          status: "completion_pending"
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          kind: true,
          requestJson: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
          deliveredAt: true
        }
      }),
      this.prisma.assistantMediaJob.findMany({
        where: {
          assistantId: input.assistantId,
          userId: input.userId,
          chatId: input.chatId,
          status: "delivered",
          deliveredAt: {
            gte: recentDeliveredCutoff
          }
        },
        orderBy: [{ deliveredAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          kind: true,
          requestJson: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
          deliveredAt: true
        }
      })
    ]);
    return [
      ...finalizingRows.map((row) => this.toRuntimeJobDeliveryUpdate(row, "finalizing_delivery")),
      ...recentDeliveredRows.map((row) =>
        this.toRuntimeJobDeliveryUpdate(row, "delivered_recently")
      )
    ];
  }

  async listOpenJobsForWebChat(input: {
    assistantId: string;
    userId: string;
    chatId: string;
  }): Promise<AssistantWebChatActiveMediaJobState[]> {
    const continuationCutoff = new Date(Date.now() - 5 * 60_000);
    const [openRows, continuationHandles] = await Promise.all([
      this.prisma.assistantMediaJob.findMany({
        where: {
          assistantId: input.assistantId,
          userId: input.userId,
          chatId: input.chatId,
          status: {
            in: ["queued", "running", "completion_pending"]
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          kind: true,
          requestJson: true,
          status: true,
          createdAt: true,
          startedAt: true,
          updatedAt: true
        }
      }),
      this.prisma.assistantAsyncJobHandle.findMany({
        where: {
          assistantId: input.assistantId,
          chatId: input.chatId,
          kind: "media",
          OR: [
            { state: { in: ["subscribed", "ready", "claimed", "dispatched"] } },
            {
              state: { in: ["failed", "cancelled"] },
              updatedAt: { gte: continuationCutoff }
            }
          ]
        },
        select: { canonicalJobId: true, state: true }
      })
    ]);
    const openIds = new Set(openRows.map((row) => row.id));
    const missingIds = continuationHandles
      .map((handle) => handle.canonicalJobId)
      .filter((id) => !openIds.has(id));
    const continuationRows =
      missingIds.length === 0
        ? []
        : await this.prisma.assistantMediaJob.findMany({
            where: {
              id: { in: missingIds },
              assistantId: input.assistantId,
              userId: input.userId,
              chatId: input.chatId
            },
            select: {
              id: true,
              kind: true,
              requestJson: true,
              status: true,
              createdAt: true,
              startedAt: true,
              updatedAt: true
            }
          });
    const rows = [...openRows, ...continuationRows].sort((a, b) => {
      const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
      return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
    });
    const handles = await this.prisma.assistantAsyncJobHandle.findMany({
      where: {
        kind: "media",
        canonicalJobId: { in: rows.map((row) => row.id) }
      },
      select: { canonicalJobId: true, state: true }
    });
    const notifyStateByJobId = new Map(
      handles.map((handle) => [handle.canonicalJobId, handle.state] as const)
    );
    return rows.map((row) => {
      const requestedCount = extractRequestedCountFromRequestJson(row.requestJson);
      const handleState = notifyStateByJobId.get(row.id);
      const openStatus = toWebOpenMediaJobStatus(row.status);
      return {
        id: row.id,
        kind: row.kind,
        operation: toWebOpenMediaJobOperation({
          kind: row.kind,
          requestJson: row.requestJson
        }),
        displayKind: toWebOpenMediaJobDisplayKind({ requestJson: row.requestJson }),
        ...(requestedCount === null ? {} : { requestedCount }),
        // Keep wire status in the open union so continuation-held delivered jobs
        // still drive Working + history poll until handle settles.
        status: openStatus ?? "completion_pending",
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
        notifyState: toWebNotifyState(handleState)
      };
    });
  }

  private toRuntimeJobDeliveryUpdate(
    row: {
      id: string;
      kind: RuntimeOpenMediaJobContext["kind"];
      requestJson: unknown;
      createdAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
      updatedAt: Date;
      deliveredAt: Date | null;
    },
    deliveryStatus: RuntimeJobDeliveryUpdate["deliveryStatus"]
  ): RuntimeJobDeliveryUpdate {
    const requestedCount = extractRequestedCountFromRequestJson(row.requestJson);
    return {
      kind: "media",
      jobId: row.id,
      mediaKind: row.kind,
      toolCode: toRuntimeOpenMediaJobToolCode({
        kind: row.kind,
        requestJson: row.requestJson
      }),
      deliveryStatus,
      sourceSummary: extractSourceSummaryFromRequestJson(row.requestJson),
      requestedCount,
      expectedResultCount: requestedCount,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null
    };
  }

  async enqueue(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    chatId: string;
    surface: AssistantChatSurface;
    kind: "image" | "audio" | "video";
    sourceUserMessageId: string;
    sourceClientTurnId?: string | null;
    assistantAcknowledgementMessageId?: string | null;
    request: AssistantMediaJobRequestPayload;
  }): Promise<{ id: string; status: "queued"; jobRef: string }> {
    return this.prisma.$transaction(async (tx) => {
      await assertActiveBackgroundJobCap(tx, input.chatId);
      const created = await tx.assistantMediaJob.create({
        data: {
          assistantId: input.assistantId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          chatId: input.chatId,
          surface: input.surface,
          kind: input.kind,
          status: "queued",
          sourceUserMessageId: input.sourceUserMessageId,
          sourceClientTurnId: input.sourceClientTurnId ?? input.sourceUserMessageId,
          ...(input.assistantAcknowledgementMessageId === undefined
            ? {}
            : { assistantAcknowledgementMessageId: input.assistantAcknowledgementMessageId }),
          requestJson: input.request as never
        },
        select: {
          id: true,
          status: true
        }
      });
      const handle = await tx.assistantAsyncJobHandle.findUniqueOrThrow({
        where: {
          kind_canonicalJobId: {
            kind: "media",
            canonicalJobId: created.id
          }
        },
        select: { jobRef: true }
      });
      return { id: created.id, status: "queued" as const, jobRef: handle.jobRef };
    });
  }

  async attachAcknowledgementMessageId(input: {
    assistantId: string;
    sourceUserMessageId: string;
    assistantAcknowledgementMessageId: string;
  }): Promise<number> {
    const updated = await this.prisma.assistantMediaJob.updateMany({
      where: {
        assistantId: input.assistantId,
        sourceUserMessageId: input.sourceUserMessageId,
        assistantAcknowledgementMessageId: null,
        status: {
          in: ["queued", "running", "completion_pending"]
        }
      },
      data: {
        assistantAcknowledgementMessageId: input.assistantAcknowledgementMessageId
      }
    });
    // Pin delivery target so mid-turn completion attaches into the same
    // assistant bubble that holds (or will hold) chat-model narration.
    await this.prisma.assistantMediaJob.updateMany({
      where: {
        assistantId: input.assistantId,
        sourceUserMessageId: input.sourceUserMessageId,
        completionAssistantMessageId: null,
        status: {
          in: ["queued", "running", "completion_pending", "delivered"]
        }
      },
      data: {
        completionAssistantMessageId: input.assistantAcknowledgementMessageId
      }
    });
    return updated.count;
  }

  /**
   * ADR-157: prefer an already-pinned delivery/acknowledgement message so
   * persist and completion delivery converge on one assistant bubble.
   */
  async findPinnedDeliveryMessageId(input: {
    assistantId: string;
    sourceUserMessageId: string;
  }): Promise<string | null> {
    const row = await this.prisma.assistantMediaJob.findFirst({
      where: {
        assistantId: input.assistantId,
        sourceUserMessageId: input.sourceUserMessageId,
        OR: [
          { completionAssistantMessageId: { not: null } },
          { assistantAcknowledgementMessageId: { not: null } }
        ]
      },
      orderBy: { updatedAt: "desc" },
      select: {
        completionAssistantMessageId: true,
        assistantAcknowledgementMessageId: true
      }
    });
    if (row === null) {
      return null;
    }
    return row.completionAssistantMessageId ?? row.assistantAcknowledgementMessageId ?? null;
  }
}
