import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { RuntimeTurnReceiptStatus } from "@prisma/client";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import { SendNativeWebChatTurnService } from "./send-native-web-chat-turn.service";

const SCHEDULED_ACTION_THREAD_PREFIX = "system:scheduled-action:";

type ScheduledActionDeliveryAttempt = { kind: "send"; userMessageId: string } | { kind: "skip" };

function isRetriableFailedReceipt(status: RuntimeTurnReceiptStatus): boolean {
  return status === "failed" || status === "interrupted";
}

function stringifyPayload(value: Record<string, unknown> | null): string {
  if (value === null) {
    return "{}";
  }
  return JSON.stringify(value, null, 2);
}

function buildScheduledActionPrompt(input: {
  title: string;
  actionType: string;
  actionPayload: Record<string, unknown> | null;
  payloadText: string;
}): string {
  return [
    "This is a hidden assistant-side scheduled action.",
    "Nothing from this turn is shown directly to the user.",
    "Background assistant actions MUST NOT directly message the user.",
    "Use this turn to perform checks, reasoning, or quiet internal updates first.",
    "Treat the scheduled action context below as the contract for what to verify and when a follow-up may help.",
    "If this hidden task is meant to verify a condition and notify the user when that condition is met, follow this policy:",
    "1. Perform the requested checks using the available tools and context.",
    '2. If the condition is met and a user-visible follow-up is warranted, you MUST create a separate scheduled_action with audience="user" and an immediate schedule such as delayMs=1 or a runAt timestamp around now.',
    "3. That user-visible scheduled_action should include a short reminderText in the user's language that explains what changed and why the follow-up may help.",
    "4. If the condition is not met, the user is already doing well, or the evidence is too weak, do not create a user-visible scheduled_action.",
    "5. Prefer silence over guessing, guilt-tripping, or low-confidence nudges.",
    "Examples:",
    " - USD/RUB check: fetch the rate; if it is above the requested threshold, create an immediate audience=user scheduled_action; otherwise create nothing for the user.",
    " - News digest: fetch the latest stories; if the task asks for a user-facing summary, create an immediate audience=user scheduled_action with a concise summary in the user's language.",
    " - Project follow-up: inspect memory or recent progress; if the user already made progress, do nothing; if a gentle check-in is warranted, create an immediate audience=user scheduled_action.",
    "",
    `Title: ${input.title}`,
    `Action type: ${input.actionType}`,
    `Action payload JSON: ${stringifyPayload(input.actionPayload)}`,
    "",
    "Scheduled action context:",
    input.payloadText
  ].join("\n");
}

@Injectable()
export class RunScheduledAssistantActionService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
    private readonly sendNativeWebChatTurnService: SendNativeWebChatTurnService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(input: {
    assistantId: string;
    externalRef: string;
    title: string;
    actionType: string;
    actionPayload: Record<string, unknown> | null;
    payloadText: string;
    runAtMs: number;
  }): Promise<void> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    const publishedVersionId = assistant.applyAppliedVersionId?.trim() ?? "";
    if (!publishedVersionId) {
      throw new ServiceUnavailableException(
        "Assistant has no applied published version for scheduled assistant actions."
      );
    }
    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      assistant.id
    );
    const surfaceThreadKey = `${SCHEDULED_ACTION_THREAD_PREFIX}${input.externalRef}`;
    const deliveryAttempt = await this.resolveDeliveryAttempt({
      externalThreadKey: surfaceThreadKey,
      externalRef: input.externalRef,
      runAtMs: input.runAtMs
    });
    if (deliveryAttempt.kind === "skip") {
      return;
    }
    await this.sendNativeWebChatTurnService.execute({
      assistantId: assistant.id,
      publishedVersionId,
      runtimeTier,
      surfaceThreadKey,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      userMessageId: deliveryAttempt.userMessageId,
      userMessage: buildScheduledActionPrompt({
        title: input.title,
        actionType: input.actionType,
        actionPayload: input.actionPayload,
        payloadText: input.payloadText
      }),
      attachments: [],
      currentTimeIso: new Date(input.runAtMs).toISOString()
    });
  }

  private async resolveDeliveryAttempt(input: {
    externalThreadKey: string;
    externalRef: string;
    runAtMs: number;
  }): Promise<ScheduledActionDeliveryAttempt> {
    const baseUserMessageId = `scheduled-action:${input.externalRef}:${String(input.runAtMs)}`;
    const receipts = await this.prisma.runtimeTurnReceipt.findMany({
      where: {
        externalThreadKey: input.externalThreadKey,
        idempotencyKey: {
          startsWith: baseUserMessageId
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      select: {
        idempotencyKey: true,
        status: true
      }
    });
    const latestReceipt = receipts.at(-1);
    if (latestReceipt === undefined) {
      return { kind: "send", userMessageId: baseUserMessageId };
    }
    if (latestReceipt.status === "completed") {
      return { kind: "skip" };
    }
    if (isRetriableFailedReceipt(latestReceipt.status)) {
      return {
        kind: "send",
        userMessageId: `${baseUserMessageId}:retry:${String(receipts.length + 1)}`
      };
    }
    throw new ServiceUnavailableException(
      `Scheduled assistant action turn "${latestReceipt.idempotencyKey}" is still processing.`
    );
  }
}
