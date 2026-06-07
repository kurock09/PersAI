import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  PersaiRuntimeMemoryWriteDurability,
  PersaiRuntimeMemoryWriteKind,
  PersaiRuntimeMemoryWriteStability,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextMessage,
  RuntimeCompactionAutoExtractResult,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import type { InternalMemoryWriteOutcome } from "./persai-internal-api.client.service";

const AUTO_EXTRACT_SOFT_CAP = 8;
const AUTO_EXTRACT_MAX_OUTPUT_TOKENS = 700;
const AUTO_EXTRACT_SUMMARY_MAX_CHARS = 220;

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
  durability: PersaiRuntimeMemoryWriteDurability;
  stability: PersaiRuntimeMemoryWriteStability;
  confidence: number | null;
}

const AUTO_EXTRACT_OUTPUT_SCHEMA = {
  name: "auto_extract_to_memory_v1",
  description:
    "ADR-074 M2 — durable memory items extracted by the assistant after an auto-compaction round.",
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
            durability: { type: "string", enum: ["identity", "episodic"] },
            stability: { type: "string", enum: ["stable", "time_bound"] },
            confidence: { type: ["number", "null"], minimum: 0, maximum: 1 }
          },
          required: ["kind", "summary", "durability", "stability", "confidence"]
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
      durability: PersaiRuntimeMemoryWriteDurability;
      stability: PersaiRuntimeMemoryWriteStability;
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
          durability: candidate.durability,
          stability: candidate.stability,
          confidence: candidate.confidence,
          transportSurface,
          sourceTrust,
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
          durability: candidate.durability,
          stability: candidate.stability,
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
      `You are ${personaName}, a warm, attentive friend. You are reviewing the most recent conversation slice with ${userName} and writing brief notes to remember durably.`,
      "Your job is to extract ONLY genuinely durable, useful items: stable facts, lasting preferences, and unresolved open loops the user clearly cares about.",
      "Voice rules:",
      '- Write each note in a warm, human first-person friend voice as if you (the assistant) were saying it about the user. Example: "She prefers Saturday mornings for our planning calls."',
      "- Never write in the user's voice. Never quote the user verbatim.",
      "- Each note must be a single short sentence, no markdown, no greetings, no follow-up questions.",
      "Content rules:",
      "- Skip small talk, transient context, anything the user clearly retracted, anything you only inferred weakly, and anything already covered by the prior synopsis.",
      "- Prefer fewer high-quality items over many marginal ones. It is fine to return zero items.",
      `- Hard cap: at most ${String(AUTO_EXTRACT_SOFT_CAP)} items total across all kinds.`,
      "Kind taxonomy:",
      '- "fact": stable factual statements about the user or their world that are unlikely to change soon.',
      '- "preference": durable likes/dislikes/operating preferences for how you should help.',
      '- "open_loop": something the user explicitly wants to come back to later that is not yet resolved.',
      'Durability: use "identity" for who the user is or a lasting preference about how to help; use "episodic" for a one-off task, wish, or event.',
      'Stability: use "stable" for timeless or unlikely-to-change memories; use "time_bound" for memories tied to a moment or likely to expire.',
      synopsisHint,
      'Return STRICT JSON of shape: {"items":[{"kind":"fact|preference|open_loop","summary":"...","durability":"identity|episodic","stability":"stable|time_bound","confidence":0.0}]}.',
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
      const durability = this.asDurability(row.durability);
      const stability = this.asStability(row.stability);
      const confidence = this.asOptionalConfidence(row.confidence);
      if (
        kind === null ||
        summary === null ||
        durability === null ||
        stability === null ||
        confidence === undefined
      ) {
        continue;
      }
      const dedupeKey = `${kind}:${summary.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ kind, summary, durability, stability, confidence });
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

  private asDurability(value: unknown): PersaiRuntimeMemoryWriteDurability | null {
    return value === "identity" || value === "episodic"
      ? (value as PersaiRuntimeMemoryWriteDurability)
      : null;
  }

  private asStability(value: unknown): PersaiRuntimeMemoryWriteStability | null {
    return value === "stable" || value === "time_bound"
      ? (value as PersaiRuntimeMemoryWriteStability)
      : null;
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
