import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  PersaiRuntimeSharedCompactionToolCode,
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
import { TurnContextHydrationService } from "./turn-context-hydration.service";

type NativeManagedProvider = "openai" | "anthropic";

type ProviderSelection = {
  provider: NativeManagedProvider;
  model: string;
};

type SharedCompactionRequest = RuntimeCompactionRequest & {
  heldLease?: RuntimeSessionLease;
};

const MIN_SUMMARIZED_MESSAGE_COUNT = 2;

@Injectable()
export class SessionCompactionService {
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
      manualTrigger: this.isManualCompactionRequest(input)
    });
  }

  async summarizeContext(input: SharedCompactionRequest): Promise<RuntimeCompactionResult> {
    return this.executeSharedCompaction({
      input,
      toolCode: "summarize_context",
      persistSummary: false,
      manualTrigger: true
    });
  }

  private async executeSharedCompaction(input: {
    input: SharedCompactionRequest;
    toolCode: PersaiRuntimeSharedCompactionToolCode;
    persistSummary: boolean;
    manualTrigger: boolean;
  }): Promise<RuntimeCompactionResult> {
    const instructions = this.normalizeOptionalText(input.input.instructions);
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

      const sharedCompaction = bundleEntry.parsedBundle.runtime.sharedCompaction;
      const tokenThreshold = Math.max(
        1,
        sharedCompaction.reserveTokens - sharedCompaction.keepRecentTokens
      );
      if (
        !input.manualTrigger &&
        resolvedSession.session.currentTokens !== null &&
        resolvedSession.session.currentTokens < tokenThreshold
      ) {
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
          preservedRecentTurns: sharedCompaction.recentTurnsPreserve,
          reusableInLaterTurns: false
        });
      }

      const compactionSource = await this.turnContextHydrationService.buildCompactionMessages({
        conversation: input.input.conversation,
        keepRecentMessageCount: Math.max(1, sharedCompaction.recentTurnsPreserve * 2)
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
          preservedRecentTurns: sharedCompaction.recentTurnsPreserve,
          reusableInLaterTurns: false
        });
      }

      const providerSelection = this.resolveProviderSelection(bundleEntry.parsedBundle);
      const providerResult = await this.providerGatewayClientService.generateText(
        this.buildProviderRequest({
          bundle: bundleEntry.parsedBundle,
          providerSelection,
          toolCode: input.toolCode,
          persistSummary: input.persistSummary,
          instructions,
          summarizedMessageCount: compactionSource.summarizedMessageCount,
          preservedRecentMessageCount: compactionSource.preservedRecentMessageCount,
          messages: compactionSource.messages
        })
      );
      if (providerResult.stopReason !== "completed" || providerResult.text === null) {
        throw new ServiceUnavailableException(
          "Shared compaction provider call did not return a completed summary."
        );
      }

      const summaryPayload = {
        schema: "persai.runtimeSessionCompaction.v1",
        summarizeToolCode: sharedCompaction.summarizeToolCode,
        toolCode: input.toolCode,
        summaryText: providerResult.text,
        summarizedMessageCount: compactionSource.summarizedMessageCount,
        preservedRecentMessageCount: compactionSource.preservedRecentMessageCount
      } satisfies Record<string, unknown>;

      let compactionRecordId: string | null = null;
      let updatedSession = resolvedSession.session;
      if (input.persistSummary) {
        const persistedCompaction = await this.runtimeStatePostgresService.appendSessionCompaction({
          runtimeSessionId: persistedSession.id,
          assistantId: persistedSession.assistantId,
          workspaceId: persistedSession.workspaceId,
          reason: input.manualTrigger ? "manual_request" : "shared_compaction",
          instructions,
          summaryPayload,
          tokensBefore: resolvedSession.session.currentTokens,
          tokensAfter: null
        });
        compactionRecordId =
          typeof persistedCompaction.id === "string" ? persistedCompaction.id : null;
        updatedSession = await this.sessionStoreService.updateSessionSummary({
          sessionId: persistedSession.id,
          compactionCount: persistedSession.compactionCount + 1,
          compactionHintTokens: resolvedSession.session.currentTokens
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
          session: input.persistSummary
            ? {
                ...updatedSession,
                currentTokens: null
              }
            : updatedSession,
          summarizedMessageCount: compactionSource.summarizedMessageCount,
          preservedRecentMessageCount: compactionSource.preservedRecentMessageCount
        }),
        compactionRecordId,
        summaryText: providerResult.text,
        summaryPayload,
        preservedRecentTurns: sharedCompaction.recentTurnsPreserve,
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
    persistSummary: boolean;
    instructions: string | null;
    summarizedMessageCount: number;
    preservedRecentMessageCount: number;
    messages: ProviderGatewayTextGenerateRequest["messages"];
  }): ProviderGatewayTextGenerateRequest {
    const sections = [
      "You are the PersAI native shared compaction tool.",
      "Summarize earlier conversation context so later runtime turns can preserve durable facts and open threads without replaying all old messages.",
      "Return plain text only.",
      "Preserve stable user facts, assistant commitments, active reminders/tasks, unresolved questions, preferences, important external references, and any constraints that still matter.",
      "Avoid pleasantries, duplicated wording, and transient chatter that does not change future behavior.",
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
      messages: input.messages
    };
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

  private isManualCompactionRequest(input: RuntimeCompactionRequest): boolean {
    // Public web compaction is an explicit user action, so only auto/system triggers remain
    // token-threshold gated.
    return (
      input.conversation.channel === "web" ||
      this.normalizeOptionalText(input.instructions) !== null
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
