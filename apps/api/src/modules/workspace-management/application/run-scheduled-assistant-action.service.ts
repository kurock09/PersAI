import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RuntimeTurnReceiptStatus } from "@prisma/client";
import type { RuntimeTurnToolInvocation } from "@persai/runtime-contract";
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

function hasExplicitNoOpAcknowledgement(message: string): boolean {
  return message.trim().length > 0;
}

function hasSuccessfulReminderCreation(
  toolInvocations: RuntimeTurnToolInvocation[] | undefined
): boolean {
  return (
    toolInvocations?.some(
      (invocation) => invocation.name === "scheduled_action" && invocation.ok === true
    ) ?? false
  );
}

function hasFailedReminderCreation(
  toolInvocations: RuntimeTurnToolInvocation[] | undefined
): boolean {
  return (
    toolInvocations?.some(
      (invocation) => invocation.name === "scheduled_action" && invocation.ok === false
    ) ?? false
  );
}

function summarizeToolInvocations(
  toolInvocations: RuntimeTurnToolInvocation[] | undefined
): string {
  if (toolInvocations === undefined || toolInvocations.length === 0) {
    return "none";
  }
  return toolInvocations
    .map((invocation) => `${invocation.name}:${invocation.ok ? "ok" : "error"}`)
    .join(", ");
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
    "Your job in this turn is to PRODUCE at most one observable side-effect.",
    'You MUST NOT use scheduled_action(action="list") in this turn — the actionPayload below already tells you everything you need to act.',
    'You MUST NOT create kind="assistant_check" during this hidden run. Nested assistant background tasks are forbidden by the scheduler contract.',
    "",
    "This task has a structured actionPayload — treat it as the contract for what to evaluate.",
    "Step 1. Read actionPayload + the scheduled action context below. Use available tools (memory_search, knowledge_*, web_*) only if the payload explicitly requires fresh evidence.",
    "Step 2. Decide: did the payload's condition fire?",
    '  - YES → call scheduled_action(action="create", kind="user_reminder", delayMs=1, title=<short>, reminderText=<short message in the user\'s language explaining what changed>).',
    "  - NO  → do NOT call scheduled_action. Finish the turn with a short internal acknowledgement that the condition did not fire and no user follow-up is needed right now.",
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
  private readonly logger = new Logger(RunScheduledAssistantActionService.name);

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
      // ADR-074 F4 (no-silent-hidden-run): even when we deduplicate via the
      // RuntimeTurnReceipt cache, we want a structured breadcrumb so the task
      // never "disappears" silently from the operator's POV. The earlier
      // completed receipt already proves the model produced (or chose not to
      // produce) an observable side-effect; we just record that fact.
      this.logger.log({
        event: "scheduled_assistant_action_skipped_already_completed",
        assistantId: assistant.id,
        externalRef: input.externalRef,
        actionType: input.actionType,
        runAtIso: new Date(input.runAtMs).toISOString()
      });
      return;
    }
    const startedAtMs = Date.now();
    let toolInvocationsSummary = "none";
    let terminalOutcome: "reminder_created" | "explicit_noop" | null = null;
    try {
      const runtimeResult = await this.sendNativeWebChatTurnService.execute({
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
      toolInvocationsSummary = summarizeToolInvocations(runtimeResult.toolInvocations);
      const reminderCreated = hasSuccessfulReminderCreation(runtimeResult.toolInvocations);
      const explicitNoOpAcknowledgement = hasExplicitNoOpAcknowledgement(
        runtimeResult.assistantMessage
      );
      if (hasFailedReminderCreation(runtimeResult.toolInvocations)) {
        throw new ServiceUnavailableException(
          "Scheduled assistant action reached a failed reminder creation attempt."
        );
      }
      if (!reminderCreated && !explicitNoOpAcknowledgement) {
        throw new ServiceUnavailableException(
          "Scheduled assistant action finished without creating a user reminder or returning an explicit internal acknowledgement."
        );
      }
      terminalOutcome = reminderCreated ? "reminder_created" : "explicit_noop";
    } catch (error) {
      // ADR-074 F4: failure is already retried/disabled by the scheduler's
      // exhaustion path, but we add a structured log here so the cause is
      // attributable to the hidden-run dispatch rather than the scheduler tick.
      this.logger.error({
        event: "scheduled_assistant_action_dispatch_failed",
        assistantId: assistant.id,
        externalRef: input.externalRef,
        actionType: input.actionType,
        durationMs: Date.now() - startedAtMs,
        toolInvocationsSummary,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    // ADR-074 F4 (no-silent-hidden-run): the runtime turn returned without
    // throwing, which means the model's hidden run completed. The actual
    // user-visible artifact (a `kind="user_reminder"` follow-up) only exists
    // if the model decided the condition fired. Either way, we leave a
    // structured breadcrumb so the operator can grep
    // `scheduled_assistant_action_completed` per externalRef and reconstruct
    // the timeline (paired with the registry-side "disabled" marker the
    // scheduler writes via completeAssistantActionRun).
    this.logger.log({
      event: "scheduled_assistant_action_completed",
      assistantId: assistant.id,
      externalRef: input.externalRef,
      actionType: input.actionType,
      durationMs: Date.now() - startedAtMs,
      toolInvocationsSummary,
      terminalOutcome,
      runAtIso: new Date(input.runAtMs).toISOString()
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
