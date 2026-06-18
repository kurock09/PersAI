import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  PersaiRuntimeMemoryWriteKind,
  PersaiRuntimeMemoryWriteLayer,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextMessage,
  RuntimeCompactionAutoExtractResult,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import type { InternalMemoryWriteOutcome } from "./persai-internal-api.client.service";

const AUTO_EXTRACT_SOFT_CAP = 3;
const AUTO_EXTRACT_MAX_OUTPUT_TOKENS = 700;
const AUTO_EXTRACT_SUMMARY_MAX_CHARS = 220;
const AUTO_EXTRACT_LONG_MEMORY_MIN_CONFIDENCE = 0.85;
const AUTO_EXTRACT_VAGUE_OPEN_LOOP_PATTERN =
  /\b(interested in|interest in|curious about|exploring|learning about|working on|focused on|product direction|roadmap|strategy|vision|ongoing interest)\b/i;
const AUTO_EXTRACT_DURABLE_OPEN_LOOP_PATTERN =
  /\b(long[- ]term|this year|this quarter|over the next|for the next|multi[- ]month|months\b|goal|commitment|committed to|deadline|target)\b/i;
const AUTO_EXTRACT_EPHEMERAL_SUMMARY_PATTERN =
  /\b(test voice|record(?:ing)? (?:a )?test voice|demo voice|placeholder|try(?:ing)? out|small talk|greeting|acknowledg(?:e)?ment)\b/i;

export interface AutoExtractToMemoryInput {
  bundle: AssistantRuntimeBundle;
  channel: "web" | "telegram" | "max_ru";
  conversationMode: "direct" | "group";
  // Recent verbatim turns being compacted (already filtered to text), in
  // chronological order. The model uses these as the source-of-truth for
  // extraction; we never let it invent facts from outside this slice.
  compactedMessages: ProviderGatewayTextMessage[];
  // Persistent rolling synopsis text, may be the just-generated one for this
  // round so the model can avoid restating already-known facts.
  rollingSynopsisText: string | null;
  runtimeRequestId: string | null;
  runtimeSessionId: string;
  providerSelection: { provider: "openai" | "anthropic"; model: string };
}

interface AutoExtractCandidate {
  kind: PersaiRuntimeMemoryWriteKind;
  summary: string;
  layer: PersaiRuntimeMemoryWriteLayer;
  confidence: number | null;
}

const AUTO_EXTRACT_OUTPUT_SCHEMA = {
  name: "auto_extract_to_memory_v1",
  description: "Durable memory candidates extracted from a compacted conversation slice.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        maxItems: AUTO_EXTRACT_SOFT_CAP,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["fact", "preference", "open_loop"] },
            summary: { type: "string", minLength: 1, maxLength: AUTO_EXTRACT_SUMMARY_MAX_CHARS },
            layer: { type: "string", enum: ["long", "short"] },
            confidence: { type: ["number", "null"], minimum: 0, maximum: 1 }
          },
          required: ["kind", "summary", "layer", "confidence"]
        }
      }
    },
    required: ["items"]
  }
} as const;

@Injectable()
export class AutoExtractToMemoryService {
  private readonly logger = new Logger(AutoExtractToMemoryService.name);

  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async execute(input: AutoExtractToMemoryInput): Promise<RuntimeCompactionAutoExtractResult> {
    const startedAtMs = Date.now();
    const transportSurface = this.resolveTransportSurface(input.channel);
    if (transportSurface === null) {
      return this.emptyResult({
        attempted: false,
        reason: "transport_surface_unavailable",
        usage: null,
        durationMs: 0
      });
    }
    if (input.compactedMessages.length === 0) {
      return this.emptyResult({
        attempted: false,
        reason: "no_messages_to_extract",
        usage: null,
        durationMs: 0
      });
    }

    const providerRequest = this.buildProviderRequest(input);
    let usage: RuntimeUsageSnapshot | null = null;
    let candidates: AutoExtractCandidate[] = [];

    try {
      const providerResult = await this.providerGatewayClientService.generateText(providerRequest);
      usage = providerResult.usage ?? null;
      if (providerResult.stopReason !== "completed" || providerResult.text === null) {
        return this.emptyResult({
          attempted: true,
          reason: "provider_incomplete",
          usage,
          durationMs: Date.now() - startedAtMs
        });
      }
      candidates = this.parseCandidates(providerResult.text);
    } catch (error) {
      this.logger.warn(
        `[auto-extract] Provider call failed for session ${input.runtimeSessionId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return this.emptyResult({
        attempted: true,
        reason: "provider_error",
        usage,
        durationMs: Date.now() - startedAtMs
      });
    }

    let written = 0;
    let dedupSkipped = 0;
    let policySkipped = 0;
    let invalidSkipped = 0;
    const kindCounts: Record<PersaiRuntimeMemoryWriteKind, number> = {
      fact: 0,
      preference: 0,
      open_loop: 0
    };
    const acceptedEntries: Array<{
      kind: PersaiRuntimeMemoryWriteKind;
      summary: string;
      layer: PersaiRuntimeMemoryWriteLayer;
      confidence: number | null;
    }> = [];

    const sourceTrust = input.conversationMode === "direct" ? "trusted_1to1" : "group";

    for (const candidate of candidates.slice(0, AUTO_EXTRACT_SOFT_CAP)) {
      let outcome: InternalMemoryWriteOutcome;
      try {
        outcome = await this.persaiInternalApiClientService.writeMemory({
          assistantId: input.bundle.metadata.assistantId,
          kind: candidate.kind,
          summary: candidate.summary,
          layer: candidate.layer,
          confidence: candidate.confidence,
          transportSurface,
          sourceTrust,
          provenance: "auto_extracted",
          relatedUserMessageId: null,
          requestId: input.runtimeRequestId
        });
      } catch (error) {
        invalidSkipped += 1;
        this.logger.warn(
          `[auto-extract] memory_write call failed for session ${input.runtimeSessionId}: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }

      if (outcome.written) {
        written += 1;
        kindCounts[candidate.kind] += 1;
        acceptedEntries.push({
          kind: candidate.kind,
          summary: candidate.summary,
          layer: candidate.layer,
          confidence: candidate.confidence
        });
        continue;
      }

      if (outcome.code === "duplicate") {
        dedupSkipped += 1;
        continue;
      }

      // Anything else (policy denial, invalid_arguments, etc.) is treated as
      // a soft skip: auto-extract must never raise into the scheduler retry
      // loop because of a single bad item.
      policySkipped += 1;
    }

    return {
      attempted: true,
      written,
      dedupSkipped,
      policySkipped,
      invalidSkipped,
      kindCounts,
      entries: acceptedEntries,
      durationMs: Date.now() - startedAtMs,
      reason: written > 0 ? "ok" : candidates.length === 0 ? "no_candidates" : "all_skipped",
      usage
    };
  }

  private buildProviderRequest(
    input: AutoExtractToMemoryInput
  ): ProviderGatewayTextGenerateRequest {
    const personaName = input.bundle.persona.displayName ?? "your assistant";
    const userName = input.bundle.userContext.displayName ?? "the user";
    const synopsisHint =
      input.rollingSynopsisText === null || input.rollingSynopsisText.length === 0
        ? "There is no prior synopsis yet for this conversation."
        : `Existing rolling synopsis (already known, do NOT restate verbatim):\n${input.rollingSynopsisText}`;

    const sections: Array<string | null> = [
      `You are ${personaName}. Review the most recent conversation slice with ${userName} and decide whether any memory items are worth writing.`,
      "Your job is to extract ONLY genuinely durable, useful items: stable facts, lasting preferences, and concrete unresolved open loops the user clearly cares about.",
      "Writing rules:",
      "- Write concise neutral memory notes, not warm friend-style narration.",
      "- Never write in the user's voice. Never quote the user verbatim.",
      "- Each note must be a single short sentence, no markdown, no greetings, no follow-up questions.",
      "Content rules:",
      "- Prefer zero items over weak items. Return at most 3 items total, and only when they are high-confidence and clearly supported by explicit evidence in this slice.",
      "- Skip small talk, acknowledgements, test/demo turns, ephemeral tasks like recording a test voice, anything the user clearly retracted, anything already covered by the prior synopsis, and anything you only inferred weakly.",
      "- Do not write broad portraits, personality takes, or generalized style preferences from one or two casual turns.",
      "- For long fact/preference items, only output them when confidence is at least 0.85. If confidence is lower, use short only for current working context or skip.",
      `- Hard cap: at most ${String(AUTO_EXTRACT_SOFT_CAP)} items total across all kinds.`,
      "Kind taxonomy:",
      '- "fact": a stable factual statement about the user or their world that is unlikely to change soon.',
      '- "preference": a durable like/dislike or decision-grade operating preference for how you should help.',
      '- "open_loop": a concrete unresolved action, follow-up, or decision to return to later. Not a vague ongoing interest or product direction.',
      'Layer choice: use "long" only for explicit, repeated, or clearly decision-grade long-term facts/preferences, and only for explicitly durable long-term commitments or goals. Use "short" for ordinary open loops and recent working context. If unsure, use "short" or skip.',
      synopsisHint,
      'Return STRICT JSON of shape: {"items":[{"kind":"fact|preference|open_loop","summary":"...","layer":"long|short","confidence":0.0}]}.',
      'If nothing durable belongs in memory, return {"items":[]}.',
      "Do not wrap the JSON in code fences. Do not include any other text."
    ];

    return {
      provider: input.providerSelection.provider,
      model: input.providerSelection.model,
      systemPrompt: sections.filter((section): section is string => section !== null).join("\n\n"),
      messages: input.compactedMessages,
      maxOutputTokens: AUTO_EXTRACT_MAX_OUTPUT_TOKENS,
      outputSchema: AUTO_EXTRACT_OUTPUT_SCHEMA,
      requestMetadata: {
        classification: "auto_extract_to_memory",
        runtimeRequestId: input.runtimeRequestId,
        runtimeSessionId: input.runtimeSessionId,
        toolLoopIteration: null,
        compactionToolCode: "compact_context"
      }
    };
  }

  private parseCandidates(rawText: string): AutoExtractCandidate[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return [];
    }
    const root = this.asObject(parsed);
    const items = root?.items;
    if (!Array.isArray(items)) {
      return [];
    }
    const seen = new Set<string>();
    const out: AutoExtractCandidate[] = [];
    for (const raw of items) {
      const row = this.asObject(raw);
      if (row === null) continue;
      const kind = this.asKind(row.kind);
      const summary = this.normalizeSummary(row.summary);
      const layer = this.normalizeLayerForCandidate(kind, summary, this.asLayer(row.layer));
      const confidence = this.asOptionalConfidence(row.confidence);
      if (kind === null || summary === null || layer === null || confidence === undefined) {
        continue;
      }
      if (this.shouldSkipCandidate(kind, summary, layer, confidence)) {
        continue;
      }
      const dedupeKey = `${kind}:${summary.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ kind, summary, layer, confidence });
    }
    return out;
  }

  private asKind(value: unknown): PersaiRuntimeMemoryWriteKind | null {
    return value === "fact" || value === "preference" || value === "open_loop"
      ? (value as PersaiRuntimeMemoryWriteKind)
      : null;
  }

  private normalizeSummary(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length > AUTO_EXTRACT_SUMMARY_MAX_CHARS) {
      return null;
    }
    return normalized;
  }

  private asLayer(value: unknown): PersaiRuntimeMemoryWriteLayer | null {
    return value === "long" || value === "short" ? (value as PersaiRuntimeMemoryWriteLayer) : null;
  }

  private normalizeLayerForCandidate(
    kind: PersaiRuntimeMemoryWriteKind | null,
    summary: string | null,
    layer: PersaiRuntimeMemoryWriteLayer | null
  ): PersaiRuntimeMemoryWriteLayer | null {
    if (kind !== "open_loop" || summary === null || layer === null) {
      return layer;
    }
    if (layer === "short") {
      return "short";
    }
    return AUTO_EXTRACT_DURABLE_OPEN_LOOP_PATTERN.test(summary) ? "long" : "short";
  }

  private shouldSkipCandidate(
    kind: PersaiRuntimeMemoryWriteKind,
    summary: string,
    layer: PersaiRuntimeMemoryWriteLayer,
    confidence: number | null
  ): boolean {
    if (AUTO_EXTRACT_EPHEMERAL_SUMMARY_PATTERN.test(summary)) {
      return true;
    }
    if (kind === "open_loop" && AUTO_EXTRACT_VAGUE_OPEN_LOOP_PATTERN.test(summary)) {
      return true;
    }
    if (
      layer === "long" &&
      (kind === "fact" || kind === "preference") &&
      confidence !== null &&
      confidence < AUTO_EXTRACT_LONG_MEMORY_MIN_CONFIDENCE
    ) {
      return true;
    }
    return false;
  }

  private asOptionalConfidence(value: unknown): number | null | undefined {
    if (value === undefined || value === null) {
      return null;
    }
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : undefined;
  }

  private resolveTransportSurface(channel: string): "web" | "telegram" | null {
    if (channel === "web") return "web";
    if (channel === "telegram") return "telegram";
    return null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private emptyResult(input: {
    attempted: boolean;
    reason: string;
    usage: RuntimeUsageSnapshot | null;
    durationMs: number;
  }): RuntimeCompactionAutoExtractResult {
    return {
      attempted: input.attempted,
      written: 0,
      dedupSkipped: 0,
      policySkipped: 0,
      invalidSkipped: 0,
      kindCounts: { fact: 0, preference: 0, open_loop: 0 },
      entries: [],
      durationMs: input.durationMs,
      reason: input.reason,
      usage: input.usage
    };
  }
}
