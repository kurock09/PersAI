import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeCompactionRequest,
  RuntimeCompactionResult
} from "@persai/runtime-contract";
import { RuntimeBundleRegistryService } from "../bundles/runtime-bundle-registry.service";
import { SessionLeaseService } from "../sessions/session-lease.service";
import { SessionStoreService } from "../sessions/session-store.service";
import { RuntimeStatePostgresService } from "../runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { TurnContextHydrationService } from "./turn-context-hydration.service";

type NativeManagedProvider = "openai" | "anthropic";

type ProviderSelection = {
  provider: NativeManagedProvider;
  model: string;
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

  async compactSession(input: RuntimeCompactionRequest): Promise<RuntimeCompactionResult> {
    const instructions = this.normalizeOptionalText(input.instructions);
    const resolvedSession = await this.sessionStoreService.resolveSession({
      runtimeTier: input.runtimeTier,
      conversation: input.conversation
    });
    if (resolvedSession.session === null) {
      return {
        compacted: false,
        reason: "session_not_found",
        tokensBefore: null,
        tokensAfter: null,
        session: null
      };
    }

    const persistedSession = await this.runtimeStatePostgresService.findSessionById(
      resolvedSession.session.sessionId
    );
    if (persistedSession === null) {
      return {
        compacted: false,
        reason: "session_not_found",
        tokensBefore: resolvedSession.session.currentTokens,
        tokensAfter: null,
        session: resolvedSession.session
      };
    }

    const lease = await this.sessionLeaseService.acquireLease(persistedSession.id);
    if (lease === null) {
      return {
        compacted: false,
        reason: "session_busy",
        tokensBefore: resolvedSession.session.currentTokens,
        tokensAfter: null,
        session: resolvedSession.session
      };
    }

    try {
      const bundleEntry = this.runtimeBundleRegistryService.findBundleByAssistantVersion({
        assistantId: persistedSession.assistantId,
        publishedVersionId: persistedSession.currentPublishedVersionId,
        bundleHash: persistedSession.currentBundleHash
      });
      if (bundleEntry === null) {
        return {
          compacted: false,
          reason: "runtime_bundle_missing",
          tokensBefore: resolvedSession.session.currentTokens,
          tokensAfter: null,
          session: resolvedSession.session
        };
      }

      const sharedCompaction = bundleEntry.parsedBundle.runtime.sharedCompaction;
      const tokenThreshold = Math.max(
        1,
        sharedCompaction.reserveTokens - sharedCompaction.keepRecentTokens
      );
      // Public web compaction is an explicit user action, so only auto/system triggers remain
      // token-threshold gated.
      const isManualRequest = input.conversation.channel === "web" || instructions !== null;
      if (
        !isManualRequest &&
        resolvedSession.session.currentTokens !== null &&
        resolvedSession.session.currentTokens < tokenThreshold
      ) {
        return {
          compacted: false,
          reason: "threshold_not_reached",
          tokensBefore: resolvedSession.session.currentTokens,
          tokensAfter: null,
          session: resolvedSession.session
        };
      }

      const compactionSource = await this.turnContextHydrationService.buildCompactionMessages({
        conversation: input.conversation,
        keepRecentMessageCount: Math.max(1, sharedCompaction.recentTurnsPreserve * 2)
      });
      if (compactionSource.summarizedMessageCount < MIN_SUMMARIZED_MESSAGE_COUNT) {
        return {
          compacted: false,
          reason: "nothing_to_compact",
          tokensBefore: resolvedSession.session.currentTokens,
          tokensAfter: null,
          session: resolvedSession.session
        };
      }

      const providerSelection = this.resolveProviderSelection(bundleEntry.parsedBundle);
      const providerResult = await this.providerGatewayClientService.generateText(
        this.buildProviderRequest({
          bundle: bundleEntry.parsedBundle,
          providerSelection,
          instructions,
          summarizedMessageCount: compactionSource.summarizedMessageCount,
          preservedRecentMessageCount: compactionSource.preservedRecentMessageCount,
          messages: compactionSource.messages
        })
      );

      await this.runtimeStatePostgresService.appendSessionCompaction({
        runtimeSessionId: persistedSession.id,
        assistantId: persistedSession.assistantId,
        workspaceId: persistedSession.workspaceId,
        reason: isManualRequest ? "manual_request" : "shared_compaction",
        instructions,
        summaryPayload: {
          schema: "persai.runtimeSessionCompaction.v1",
          summarizeToolCode: sharedCompaction.summarizeToolCode,
          toolCode: sharedCompaction.compactToolCode,
          summaryText: providerResult.text,
          summarizedMessageCount: compactionSource.summarizedMessageCount,
          preservedRecentMessageCount: compactionSource.preservedRecentMessageCount
        },
        tokensBefore: resolvedSession.session.currentTokens,
        tokensAfter: null
      });

      const updatedSession = await this.sessionStoreService.updateSessionSummary({
        sessionId: persistedSession.id,
        compactionCount: persistedSession.compactionCount + 1,
        compactionHintTokens: resolvedSession.session.currentTokens
      });

      return {
        compacted: true,
        reason: "compacted",
        tokensBefore: resolvedSession.session.currentTokens,
        tokensAfter: null,
        session: updatedSession
      };
    } finally {
      await this.releaseLeaseQuietly(lease);
    }
  }

  private buildProviderRequest(input: {
    bundle: AssistantRuntimeBundle;
    providerSelection: ProviderSelection;
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
