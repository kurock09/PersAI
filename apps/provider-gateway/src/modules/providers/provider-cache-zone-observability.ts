import type { Logger } from "@nestjs/common";
import {
  hashProviderCacheSemanticPrefix,
  type ProviderGatewayTextGenerateRequest
} from "@persai/runtime-contract";

type ProviderCacheZoneRepresentation = {
  tools: unknown;
  prefix: unknown;
  stableSystem: unknown;
  hydratedHistory: unknown;
  volatileContext: unknown;
  developerTail: unknown;
  cacheBreakpointCount: number;
};

const MAX_HYDRATED_HISTORY_FRAME_HASHES = 128;

/**
 * The provider client supplies its already-serialized provider representation.
 * This intentionally hashes the wire-shaped semantic prefix, rather than the
 * runtime's zone estimates, so receipt/log evidence cannot claim a wire hash
 * for content the provider never received.
 */
export function logProviderCacheZoneTelemetry(params: {
  logger: Logger;
  input: ProviderGatewayTextGenerateRequest;
  representation: ProviderCacheZoneRepresentation;
}): void {
  const provider = params.input.provider;
  const prefix = hashProviderCacheSemanticPrefix({
    provider,
    serializedPrefix: {
      tools: params.representation.tools,
      prefix: params.representation.prefix
    }
  });
  const stableSystem = hashProviderCacheSemanticPrefix({
    provider,
    serializedPrefix: params.representation.stableSystem
  });
  const hydratedHistory = hashProviderCacheSemanticPrefix({
    provider,
    serializedPrefix: params.representation.hydratedHistory
  });
  const toolProjection = hashProviderCacheSemanticPrefix({
    provider,
    serializedPrefix: params.representation.tools
  });
  const volatileContext = hashProviderCacheSemanticPrefix({
    provider,
    serializedPrefix: params.representation.volatileContext
  });
  const developerTail = hashProviderCacheSemanticPrefix({
    provider,
    serializedPrefix: params.representation.developerTail
  });
  const requestFrame = hashProviderCacheSemanticPrefix({
    provider,
    serializedPrefix: {
      tools: params.representation.tools,
      prefix: params.representation.prefix,
      volatileContext: params.representation.volatileContext,
      developerTail: params.representation.developerTail
    }
  });
  const hydratedHistoryFrames = hashHydratedHistoryFrames(
    provider,
    params.representation.hydratedHistory
  );
  const sealedBoundary = params.input.sealedToolExchangeBoundary ?? null;
  const explicitPolicy = params.input.promptCache?.openaiPolicy?.mode === "explicit";
  const automaticPolicy = params.input.promptCache?.openaiPolicy?.mode === "automatic";
  const cacheWriteCandidateCount = !explicitPolicy
    ? params.representation.cacheBreakpointCount
    : (params.input.toolHistory?.length ?? 0) === 0
      ? 1
      : sealedBoundary?.priorSealedCacheContentHash === null
        ? 2
        : 1;

  params.logger.log({
    event: "provider_cache_zone",
    provider,
    requestClassification: params.input.requestMetadata?.classification ?? "unknown",
    toolLoopIteration: params.input.requestMetadata?.toolLoopIteration ?? null,
    model: params.input.model,
    cachePolicyMode: explicitPolicy ? "explicit" : automaticPolicy ? "automatic" : "none",
    stableSystemHash: stableSystem.hash,
    stableSystemChars: stableSystem.chars,
    hydratedHistoryHash: hydratedHistory.hash,
    hydratedHistoryChars: hydratedHistory.chars,
    hydratedHistoryFrameHashes: hydratedHistoryFrames.hashes,
    hydratedHistoryFrameChars: hydratedHistoryFrames.chars,
    hydratedHistoryFrameOmittedCount: hydratedHistoryFrames.omittedCount,
    cacheContentHash: prefix.hash,
    cacheContentChars: prefix.chars,
    requestFrameHash: requestFrame.hash,
    requestFrameChars: requestFrame.chars,
    sealedSpineHash: sealedBoundary?.cacheContentHash ?? null,
    sealedSpineChars: sealedBoundary?.cacheContentChars ?? 0,
    priorSealedBoundaryHash: sealedBoundary?.priorSealedCacheContentHash ?? null,
    sealedBoundaryKind: sealedBoundary === null ? "stable_history" : "sealed_spine",
    toolProjectionFamilyHash: toolProjection.hash,
    toolProjectionChars: toolProjection.chars,
    toolCount: params.input.tools?.length ?? 0,
    volatileContextHash: volatileContext.hash,
    volatileContextChars: volatileContext.chars,
    developerTailHash: developerTail.hash,
    developerTailChars: developerTail.chars,
    cacheBreakpointCount: params.representation.cacheBreakpointCount,
    // This is a bounded epoch identity, not a metric label. A changed exact
    // provider-visible tool family begins a new cache epoch.
    cacheEpochHash: toolProjection.hash,
    // Explicit OpenAI writes the stable anchor on a fresh epoch and the
    // latest sealed boundary once; warmed follow-ups write only that new
    // boundary. The epoch hash permits reset cohorts to be grouped safely.
    cacheWriteCandidateCount
  });
}

function hashHydratedHistoryFrames(
  provider: string,
  history: unknown
): {
  hashes: string[];
  chars: number[];
  omittedCount: number;
} {
  const frames = Array.isArray(history) ? history : [history];
  const visibleFrames = frames.slice(0, MAX_HYDRATED_HISTORY_FRAME_HASHES);
  return {
    hashes: visibleFrames.map(
      (frame) =>
        hashProviderCacheSemanticPrefix({
          provider,
          serializedPrefix: frame
        }).hash
    ),
    chars: visibleFrames.map(
      (frame) =>
        hashProviderCacheSemanticPrefix({
          provider,
          serializedPrefix: frame
        }).chars
    ),
    omittedCount: frames.length - visibleFrames.length
  };
}
