import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { RuntimeTurnReceiptStatus } from "@prisma/client";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import { SendNativeWebChatTurnService } from "./send-native-web-chat-turn.service";

const SCHEDULED_ACTION_THREAD_PREFIX = "system:scheduled-action:";
const ACCEPTED_RECEIPT_STALE_MS = 2 * 60 * 1000;

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

// Scheduled assistant actions now have a strict contract: only
// `kind="assistant_check"` may reach this service, and it always carries a
// non-empty actionPayload describing what to evaluate. The prompt therefore no
// longer needs a "maybe this should really be a user reminder" fallback branch:
// it is the execution slot for an already-validated background check.
function buildScheduledActionPrompt(input: {
  title: string;
  actionType: string;
  actionPayload: Record<string, unknown> | null;
  payloadText: string;
}): string {
  const hasPayload = input.actionPayload !== null && Object.keys(input.actionPayload).length > 0;
  if (!hasPayload) {
    throw new ServiceUnavailableException(
      "Assistant scheduled actions require a non-empty actionPayload."
    );
  }
  return [
    "You are executing a hidden assistant-side scheduled action. Nothing in this turn is shown to the user directly.",
    "Your job in this turn is to PRODUCE exactly one observable side-effect (a single scheduled_action call). Silence is not a valid outcome.",
    'You MUST NOT use scheduled_action(action="list") in this turn — the actionPayload below already tells you everything you need to act.',
    'You MUST NOT create another kind="assistant_check" scheduled_action that simply mirrors this same task without changing runAt — that creates an infinite-recheck loop.',
    "",
    "This task has a structured actionPayload — treat it as the contract for what to evaluate.",
    "Step 1. Read actionPayload + the scheduled action context below. Use available tools (memory_search, knowledge_*, web_*) only if the payload explicitly requires fresh evidence.",
    "Step 2. Decide: did the payload's condition fire?",
    '  - YES → call scheduled_action(action="create", kind="user_reminder", delayMs=1, title=<short>, reminderText=<short message in the user\'s language explaining what changed>).',
    '  - NO  → call scheduled_action(action="create", kind="assistant_check", actionType=<same as this turn>, actionPayload=<same payload>, runAt=<ISO time of next check>, title=<same or slightly updated title>) to schedule the next check. Pick a delay that matches the payload (e.g. minutes for FX checks, hours for project follow-ups).',
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
      modelRoleOverride: "system_tool",
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
        status: true,
        createdAt: true
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
    if (
      latestReceipt.status === "accepted" &&
      Date.now() - latestReceipt.createdAt.getTime() > ACCEPTED_RECEIPT_STALE_MS
    ) {
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
