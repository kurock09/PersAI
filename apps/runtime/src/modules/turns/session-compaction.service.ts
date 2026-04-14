import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  PersaiRuntimeSharedCompactionToolCode,
  ProviderGatewayRequestMetadata,
  ProviderGatewayTextGenerateRequest,
  RuntimeCompactionRequest,
  RuntimeCompactionResult,
  RuntimeSharedCompactionToolResult,
  RuntimeSessionSummary
} from "@persai/runtime-contract";
import { RuntimeBundleRegistryService } from "../bundles/runtime-bundle-registry.service";
import { type RuntimeSessionLease, SessionLeaseService } from "../sessions/session-lease.service";
import { SessionStoreService } from "../sessions/session-store.service";
import { RuntimeStatePostgresService } from "../runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import {
  MAX_REUSABLE_COMPACTION_SECTION_ITEMS,
  REUSABLE_SHARED_COMPACTION_OUTPUT_SCHEMA,
  type ReusableSharedCompactionOutputRejectionReason,
  normalizeReusableCompactionStateFromModelOutput
} from "./shared-compaction-state";
import { TurnContextHydrationService } from "./turn-context-hydration.service";
import { resolveRuntimeContextHydrationConfig } from "./runtime-context-hydration-policy";

type NativeManagedProvider = "openai" | "anthropic";

type ProviderSelection = {
  provider: NativeManagedProvider;
  model: string;
};

type SharedCompactionTrigger = "manual_compaction" | "auto_compaction";

type SharedCompactionRequest = RuntimeCompactionRequest & {
  heldLease?: RuntimeSessionLease;
  trigger?: SharedCompactionTrigger;
  runtimeRequestId?: string | null;
};

const MIN_SUMMARIZED_MESSAGE_COUNT = 2;
const SHARED_COMPACTION_MAX_ATTEMPTS = 2;
const SHARED_COMPACTION_MAX_OUTPUT_TOKENS = 1_200;

@Injectable()
export class SessionCompactionService {
  private readonly logger = new Logger(SessionCompactionService.name);

  constructor(
    private readonly runtimeBundleRegistryService: RuntimeBundleRegistryService,
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly turnContextHydrationService: TurnContextHydrationService,
    private readonly sessionStoreService: SessionStoreService,
    private readonly sessionLeaseService: SessionLeaseService,
    private readonly runtimeStatePostgresService: RuntimeStatePostgresService
  ) {}

  async compactSession(input: SharedCompactionRequest): Promise<RuntimeCompactionResult> {
    return this.executeSharedCompaction({
      input,
      toolCode: "compact_context",
      persistSummary: true,
      trigger: input.trigger ?? "manual_compaction"
    });
  }

  async summarizeContext(input: SharedCompactionRequest): Promise<RuntimeCompactionResult> {
    return this.executeSharedCompaction({
      input,
      toolCode: "summarize_context",
      persistSummary: false,
      trigger: "manual_compaction"
    });
  }

  private async executeSharedCompaction(input: {
    input: SharedCompactionRequest;
    toolCode: PersaiRuntimeSharedCompactionToolCode;
    persistSummary: boolean;
    trigger: SharedCompactionTrigger;
  }): Promise<RuntimeCompactionResult> {
    const instructions = this.normalizeOptionalText(input.input.instructions);
    const manualTrigger = input.trigger === "manual_compaction";
    const resolvedSession = await this.sessionStoreService.resolveSession({
      runtimeTier: input.input.runtimeTier,
      conversation: input.input.conversation
    });
    if (resolvedSession.session === null) {
      return this.buildCompactionResult({
        toolCode: input.toolCode,
        action: "skipped",
        reason: "session_not_found",
        compacted: false,
        session: null,
        sessionId: null,
        beforeState: null,
        afterState: null,
        compactionRecordId: null,
        summaryText: null,
        summaryPayload: null,
        preservedRecentTurns: null,
        reusableInLaterTurns: false
      });
    }

    const persistedSession = await this.runtimeStatePostgresService.findSessionById(
      resolvedSession.session.sessionId
    );
    if (persistedSession === null) {
      return this.buildCompactionResult({
        toolCode: input.toolCode,
        action: "skipped",
        reason: "session_not_found",
        compacted: false,
        session: resolvedSession.session,
        sessionId: resolvedSession.session.sessionId,
        beforeState: this.createToolResultState({
          session: resolvedSession.session,
          summarizedMessageCount: null,
          preservedRecentMessageCount: null
        }),
        afterState: this.createToolResultState({
          session: resolvedSession.session,
          summarizedMessageCount: null,
          preservedRecentMessageCount: null
        }),
        compactionRecordId: null,
        summaryText: null,
        summaryPayload: null,
        preservedRecentTurns: null,
        reusableInLaterTurns: false
      });
    }

    if (
      input.input.heldLease !== undefined &&
      input.input.heldLease.sessionId !== persistedSession.id
    ) {
      throw new ServiceUnavailableException(
        "Held session lease does not match the resolved shared compaction session."
      );
    }

    const lease =
      input.input.heldLease ?? (await this.sessionLeaseService.acquireLease(persistedSession.id));
    if (lease === null) {
      return this.buildCompactionResult({
        toolCode: input.toolCode,
        action: "skipped",
        reason: "session_busy",
        compacted: false,
        session: resolvedSession.session,
        sessionId: resolvedSession.session.sessionId,
        beforeState: this.createToolResultState({
          session: resolvedSession.session,
          summarizedMessageCount: null,
          preservedRecentMessageCount: null
        }),
        afterState: this.createToolResultState({
          session: resolvedSession.session,
          summarizedMessageCount: null,
          preservedRecentMessageCount: null
        }),
        compactionRecordId: null,
        summaryText: null,
        summaryPayload: null,
        preservedRecentTurns: null,
        reusableInLaterTurns: false
      });
    }

    try {
      const bundleEntry = this.runtimeBundleRegistryService.findBundleByAssistantVersion({
        assistantId: persistedSession.assistantId,
        publishedVersionId: persistedSession.currentPublishedVersionId,
        bundleHash: persistedSession.currentBundleHash
      });
      if (bundleEntry === null) {
        return this.buildCompactionResult({
          toolCode: input.toolCode,
          action: "skipped",
          reason: "runtime_bundle_missing",
          compacted: false,
          session: resolvedSession.session,
          sessionId: resolvedSession.session.sessionId,
          beforeState: this.createToolResultState({
            session: resolvedSession.session,
            summarizedMessageCount: null,
            preservedRecentMessageCount: null
          }),
          afterState: this.createToolResultState({
            session: resolvedSession.session,
            summarizedMessageCount: null,
            preservedRecentMessageCount: null
          }),
          compactionRecordId: null,
          summaryText: null,
          summaryPayload: null,
          preservedRecentTurns: null,
          reusableInLaterTurns: false
        });
      }

      const contextHydration = resolveRuntimeContextHydrationConfig(bundleEntry.parsedBundle);
      const tokenThreshold = Math.max(1, contextHydration.compactionTriggerThreshold);
      const freshCurrentTokens =
        resolvedSession.session.totalTokensFresh === true
          ? resolvedSession.session.currentTokens
          : null;
      if (!manualTrigger && (freshCurrentTokens === null || freshCurrentTokens < tokenThreshold)) {
        return this.buildCompactionResult({
          toolCode: input.toolCode,
          action: "skipped",
          reason: "threshold_not_reached",
          compacted: false,
          session: resolvedSession.session,
          sessionId: resolvedSession.session.sessionId,
          beforeState: this.createToolResultState({
            session: resolvedSession.session,
            summarizedMessageCount: null,
            preservedRecentMessageCount: null
          }),
          afterState: this.createToolResultState({
            session: resolvedSession.session,
            summarizedMessageCount: null,
            preservedRecentMessageCount: null
          }),
          compactionRecordId: null,
          summaryText: null,
          summaryPayload: null,
          preservedRecentTurns: contextHydration.keepRecentMinimum,
          reusableInLaterTurns: false
        });
      }

      const compactionSource = await this.turnContextHydrationService.buildCompactionMessages({
        conversation: input.input.conversation,
        keepRecentMessageCount: Math.max(1, contextHydration.keepRecentMinimum * 2)
      });
      if (compactionSource.summarizedMessageCount < MIN_SUMMARIZED_MESSAGE_COUNT) {
        return this.buildCompactionResult({
          toolCode: input.toolCode,
          action: "skipped",
          reason: "nothing_to_compact",
          compacted: false,
          session: resolvedSession.session,
          sessionId: resolvedSession.session.sessionId,
          beforeState: this.createToolResultState({
            session: resolvedSession.session,
            summarizedMessageCount: compactionSource.summarizedMessageCount,
            preservedRecentMessageCount: compactionSource.preservedRecentMessageCount
          }),
          afterState: this.createToolResultState({
            session: resolvedSession.session,
            summarizedMessageCount: compactionSource.summarizedMessageCount,
            preservedRecentMessageCount: compactionSource.preservedRecentMessageCount
          }),
          compactionRecordId: null,
          summaryText: null,
          summaryPayload: null,
          preservedRecentTurns: contextHydration.keepRecentMinimum,
          reusableInLaterTurns: false
        });
      }

      const providerSelection = this.resolveProviderSelection(bundleEntry.parsedBundle);
      const validatedOutput = await this.generateValidatedSharedCompactionOutput({
        bundle: bundleEntry.parsedBundle,
        providerSelection,
        toolCode: input.toolCode,
        trigger: input.trigger,
        runtimeRequestId: input.input.runtimeRequestId ?? null,
        runtimeSessionId: resolvedSession.session.sessionId,
        persistSummary: input.persistSummary,
        instructions,
        summarizedMessageCount: compactionSource.summarizedMessageCount,
        preservedRecentMessageCount: compactionSource.preservedRecentMessageCount,
        messages: compactionSource.messages
      });
      if (validatedOutput === null) {
        return this.buildCompactionResult({
          toolCode: input.toolCode,
          action: "skipped",
          reason: "invalid_summary_output",
          compacted: false,
          session: resolvedSession.session,
          sessionId: resolvedSession.session.sessionId,
          beforeState: this.createToolResultState({
            session: resolvedSession.session,
            summarizedMessageCount: compactionSource.summarizedMessageCount,
            preservedRecentMessageCount: compactionSource.preservedRecentMessageCount
          }),
          afterState: this.createToolResultState({
            session: resolvedSession.session,
            summarizedMessageCount: compactionSource.summarizedMessageCount,
            preservedRecentMessageCount: compactionSource.preservedRecentMessageCount
          }),
          compactionRecordId: null,
          summaryText: null,
          summaryPayload: null,
          preservedRecentTurns: contextHydration.keepRecentMinimum,
          reusableInLaterTurns: false
        });
      }
      const normalizedSummary = validatedOutput.normalizedSummary;

      let compactionRecordId: string | null = null;
      let updatedSession = resolvedSession.session;
      if (input.persistSummary) {
        const persistedCompaction = await this.runtimeStatePostgresService.appendSessionCompaction({
          runtimeSessionId: persistedSession.id,
          assistantId: persistedSession.assistantId,
          workspaceId: persistedSession.workspaceId,
          requestId: input.input.runtimeRequestId ?? null,
          reason: input.trigger,
          instructions,
          summaryPayload: normalizedSummary.payload,
          tokensBefore: resolvedSession.session.currentTokens,
          tokensAfter: null
        });
        compactionRecordId =
          typeof persistedCompaction.id === "string" ? persistedCompaction.id : null;
        updatedSession = await this.sessionStoreService.updateSessionSummary({
          sessionId: persistedSession.id,
          compactionCount: persistedSession.compactionCount + 1,
          compactionHintTokens: resolvedSession.session.currentTokens,
          currentTokens: null,
          totalTokensFresh: false
        });
      }

      return this.buildCompactionResult({
        toolCode: input.toolCode,
        action: input.persistSummary ? "compacted" : "summarized",
        reason: input.persistSummary ? "compacted" : "summarized",
        compacted: input.persistSummary,
        session: updatedSession,
        sessionId: resolvedSession.session.sessionId,
        beforeState: this.createToolResultState({
          session: resolvedSession.session,
          summarizedMessageCount: compactionSource.summarizedMessageCount,
          preservedRecentMessageCount: compactionSource.preservedRecentMessageCount
        }),
        afterState: this.createToolResultState({
          session: updatedSession,
          summarizedMessageCount: compactionSource.summarizedMessageCount,
          preservedRecentMessageCount: compactionSource.preservedRecentMessageCount
        }),
        compactionRecordId,
        summaryText: normalizedSummary.summaryText,
        summaryPayload: normalizedSummary.payload,
        preservedRecentTurns: contextHydration.keepRecentMinimum,
        reusableInLaterTurns: input.persistSummary
      });
    } finally {
      if (input.input.heldLease === undefined) {
        await this.releaseLeaseQuietly(lease);
      }
    }
  }

  private buildProviderRequest(input: {
    bundle: AssistantRuntimeBundle;
    providerSelection: ProviderSelection;
    toolCode: PersaiRuntimeSharedCompactionToolCode;
    trigger: SharedCompactionTrigger;
    runtimeRequestId: string | null;
    runtimeSessionId: string;
    persistSummary: boolean;
    instructions: string | null;
    summarizedMessageCount: number;
    preservedRecentMessageCount: number;
    messages: ProviderGatewayTextGenerateRequest["messages"];
    retryReason?: ReusableSharedCompactionOutputRejectionReason | null;
  }): ProviderGatewayTextGenerateRequest {
    const sections = [
      "You are the PersAI native shared compaction tool.",
      "Summarize earlier conversation context so later runtime turns can preserve durable facts and open threads without replaying all old messages.",
      "Return exactly one JSON object and nothing else. Do not use markdown or code fences.",
      'Required JSON shape: {"stableFacts":[],"userPreferences":[],"assistantCommitments":[],"openThreads":[],"importantReferences":[]}.',
      input.retryReason === undefined || input.retryReason === null
        ? null
        : `Previous attempt was rejected because the output was ${this.describeRejectionReason(input.retryReason)}. Return only the JSON object that matches the required shape, with no leading or trailing text.`,
      "Use empty arrays when a section has nothing durable to keep.",
      "Each array item must be a short neutral factual note, not a direct reply to the user.",
      "Do not include greetings, reassurance, sign-offs, first-person assistant language, or transient chatter.",
      `Limit each section to at most ${String(MAX_REUSABLE_COMPACTION_SECTION_ITEMS)} items and keep each item concise.`,
      input.persistSummary
        ? "This result will become the durable shared compaction state for later turns."
        : "This result is for the current tool call only and must not claim durable later-turn reuse.",
      `Invoked tool: ${input.toolCode}.`,
      `Messages being compacted: ${String(input.summarizedMessageCount)}.`,
      `Recent messages preserved outside the summary: ${String(input.preservedRecentMessageCount)}.`,
      input.bundle.persona.displayName === null
        ? null
        : `Assistant display name: ${input.bundle.persona.displayName}`,
      input.bundle.userContext.displayName === null
        ? null
        : `User display name: ${input.bundle.userContext.displayName}`,
      `User locale: ${input.bundle.userContext.locale}`,
      `User timezone: ${input.bundle.userContext.timezone}`,
      input.instructions === null ? null : `Additional operator instructions: ${input.instructions}`
    ].filter((section): section is string => section !== null);

    return {
      provider: input.providerSelection.provider,
      model: input.providerSelection.model,
      systemPrompt: sections.join("\n\n"),
      messages: input.messages,
      maxOutputTokens: SHARED_COMPACTION_MAX_OUTPUT_TOKENS,
      outputSchema: REUSABLE_SHARED_COMPACTION_OUTPUT_SCHEMA,
      requestMetadata: this.createRequestMetadata({
        classification: input.trigger,
        runtimeRequestId: input.runtimeRequestId,
        runtimeSessionId: input.runtimeSessionId,
        compactionToolCode: input.toolCode
      })
    };
  }

  private async generateValidatedSharedCompactionOutput(input: {
    bundle: AssistantRuntimeBundle;
    providerSelection: ProviderSelection;
    toolCode: PersaiRuntimeSharedCompactionToolCode;
    trigger: SharedCompactionTrigger;
    runtimeRequestId: string | null;
    runtimeSessionId: string;
    persistSummary: boolean;
    instructions: string | null;
    summarizedMessageCount: number;
    preservedRecentMessageCount: number;
    messages: ProviderGatewayTextGenerateRequest["messages"];
  }): Promise<{
    normalizedSummary: NonNullable<
      ReturnType<typeof normalizeReusableCompactionStateFromModelOutput>["parsed"]
    >;
  } | null> {
    let retryReason: ReusableSharedCompactionOutputRejectionReason | null = null;
    for (let attempt = 1; attempt <= SHARED_COMPACTION_MAX_ATTEMPTS; attempt += 1) {
      const providerResult = await this.providerGatewayClientService.generateText(
        this.buildProviderRequest({
          ...input,
          retryReason
        })
      );
      if (providerResult.stopReason !== "completed" || providerResult.text === null) {
        throw new ServiceUnavailableException(
          "Shared compaction provider call did not return a completed summary."
        );
      }

      const normalizedSummary = normalizeReusableCompactionStateFromModelOutput({
        rawOutputText: providerResult.text,
        toolCode: input.toolCode,
        summarizedMessageCount: input.summarizedMessageCount,
        preservedRecentMessageCount: input.preservedRecentMessageCount
      });
      if (normalizedSummary.parsed !== null) {
        if (attempt > 1) {
          this.logger.log(
            `[shared-compaction] Accepted ${input.toolCode} output for session ${input.runtimeSessionId} ` +
              `(trigger=${input.trigger}, provider=${input.providerSelection.provider}:${input.providerSelection.model}, ` +
              `attempt=${String(attempt)}/${String(SHARED_COMPACTION_MAX_ATTEMPTS)})`
          );
        }
        return {
          normalizedSummary: normalizedSummary.parsed
        };
      }

      retryReason = normalizedSummary.rejectionReason ?? "invalid_sections";
      this.logger.warn(
        `[shared-compaction] Rejected ${input.toolCode} output for session ${input.runtimeSessionId} ` +
          `(trigger=${input.trigger}, provider=${input.providerSelection.provider}:${input.providerSelection.model}, ` +
          `attempt=${String(attempt)}/${String(SHARED_COMPACTION_MAX_ATTEMPTS)}, ` +
          `reason=${retryReason}, chars=${String(providerResult.text.length)})`
      );
    }

    return null;
  }

  private resolveProviderSelection(bundle: AssistantRuntimeBundle): ProviderSelection {
    const routing = this.asObject(bundle.runtime.runtimeProviderRouting);
    const primaryPath = this.asObject(routing?.primaryPath);
    if (primaryPath !== null) {
      if (primaryPath.active === false) {
        throw new BadRequestException(
          "Runtime bundle primary provider path is inactive for native shared compaction."
        );
      }
      const providerFromRouting = this.asNativeManagedProvider(primaryPath.providerKey);
      const modelFromRouting = this.asNonEmptyString(primaryPath.modelKey);
      if (providerFromRouting !== null && modelFromRouting !== null) {
        return {
          provider: providerFromRouting,
          model: modelFromRouting
        };
      }
    }

    const profile = this.asObject(bundle.runtime.runtimeProviderProfile);
    const primary = this.asObject(profile?.primary);
    const providerFromProfile = this.asNativeManagedProvider(primary?.provider);
    const modelFromProfile = this.asNonEmptyString(primary?.model);
    if (providerFromProfile !== null && modelFromProfile !== null) {
      return {
        provider: providerFromProfile,
        model: modelFromProfile
      };
    }

    throw new ServiceUnavailableException(
      "Runtime bundle does not declare a native managed provider/model for shared compaction."
    );
  }

  private buildCompactionResult(input: {
    toolCode: PersaiRuntimeSharedCompactionToolCode;
    action: RuntimeSharedCompactionToolResult["action"];
    reason: string | null;
    compacted: boolean;
    session: RuntimeSessionSummary | null;
    sessionId: string | null;
    beforeState: RuntimeSharedCompactionToolResult["before"];
    afterState: RuntimeSharedCompactionToolResult["after"];
    compactionRecordId: string | null;
    summaryText: string | null;
    summaryPayload: Record<string, unknown> | null;
    preservedRecentTurns: number | null;
    reusableInLaterTurns: boolean;
  }): RuntimeCompactionResult {
    return {
      compacted: input.compacted,
      reason: input.reason,
      tokensBefore: input.beforeState?.currentTokens ?? null,
      tokensAfter: input.afterState?.currentTokens ?? null,
      session: input.session,
      toolResult: {
        toolCode: input.toolCode,
        action: input.action,
        reason: input.reason,
        sessionId: input.sessionId,
        compactionRecordId: input.compactionRecordId,
        before: input.beforeState,
        after: input.afterState,
        preservedRecentTurns: input.preservedRecentTurns,
        summaryText: input.summaryText,
        summaryPayload: input.summaryPayload,
        reusableInLaterTurns: input.reusableInLaterTurns
      }
    };
  }

  private describeRejectionReason(reason: ReusableSharedCompactionOutputRejectionReason): string {
    switch (reason) {
      case "empty_output":
        return "empty";
      case "output_too_long":
        return "too long";
      case "invalid_json":
        return "not valid JSON";
      case "invalid_sections":
        return "missing required sections";
    }
  }

  private createToolResultState(input: {
    session: RuntimeSessionSummary;
    summarizedMessageCount: number | null;
    preservedRecentMessageCount: number | null;
  }): RuntimeSharedCompactionToolResult["before"] {
    return {
      sessionId: input.session.sessionId,
      currentTokens: input.session.currentTokens,
      compactionCount: input.session.compactionCount,
      summarizedMessageCount: input.summarizedMessageCount,
      preservedRecentMessageCount: input.preservedRecentMessageCount
    };
  }

  private normalizeOptionalText(value: string | null): string | null {
    return value === null || value.trim().length === 0 ? null : value.trim();
  }

  private createRequestMetadata(input: {
    classification: SharedCompactionTrigger;
    runtimeRequestId: string | null;
    runtimeSessionId: string;
    compactionToolCode: PersaiRuntimeSharedCompactionToolCode;
  }): ProviderGatewayRequestMetadata {
    return {
      classification: input.classification,
      runtimeRequestId: input.runtimeRequestId,
      runtimeSessionId: input.runtimeSessionId,
      toolLoopIteration: null,
      compactionToolCode: input.compactionToolCode
    };
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asNativeManagedProvider(value: unknown): NativeManagedProvider | null {
    return value === "openai" || value === "anthropic" ? value : null;
  }

  private async releaseLeaseQuietly(lease: {
    sessionId: string;
    ownerToken: string;
  }): Promise<void> {
    try {
      await this.sessionLeaseService.releaseLease(lease);
    } catch {
      // Durable compaction state remains the source of truth if lease cleanup fails.
    }
  }
}
