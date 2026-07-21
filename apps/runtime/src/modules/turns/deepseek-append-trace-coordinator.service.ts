import { createHash } from "node:crypto";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  ProviderGatewayDeepSeekAppendTraceEvent,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextMessage,
  ProviderGatewayToolExchange
} from "@persai/runtime-contract";
import {
  PersaiInternalApiClientService,
  type InternalDeepSeekAppendTrace,
  type InternalDeepSeekAppendTraceEvent
} from "./persai-internal-api.client.service";

type PersistedEvent = Omit<InternalDeepSeekAppendTraceEvent, "ordinal">;

/**
 * The only D2a mutable-state append owner. Callers give it the already
 * assembled request immediately before dispatch; individual context producers
 * never write trace rows themselves.
 */
@Injectable()
export class DeepSeekAppendTraceCoordinatorService {
  constructor(private readonly internalApi: PersaiInternalApiClientService) {}

  async resolve(input: {
    assistantChatId: string;
    request: ProviderGatewayTextGenerateRequest;
    rawToolHistory: readonly ProviderGatewayToolExchange[];
  }): Promise<ProviderGatewayTextGenerateRequest> {
    if (input.request.provider !== "deepseek" || !this.isChatRequest(input.request)) {
      return input.request;
    }

    let trace = await this.internalApi.readDeepSeekAppendTrace(input.assistantChatId);
    const configHash = this.configHash(input.request);
    if (trace === null || trace.events.length === 0 || trace.configHash !== configHash) {
      trace = await this.internalApi.resetDeepSeekAppendTrace({
        assistantChatId: input.assistantChatId,
        expectedEpoch: trace?.activeEpoch ?? 0,
        configHash,
        seedEvents: this.seedEvents(input.request, input.rawToolHistory)
      });
    } else {
      const additions = this.appendableEvents(trace, input.request, input.rawToolHistory);
      if (additions.length > 0) {
        trace = await this.internalApi.appendDeepSeekAppendTrace({
          assistantChatId: input.assistantChatId,
          epoch: trace.activeEpoch,
          expectedOrdinal: trace.nextOrdinal,
          events: additions
        });
      }
    }

    const {
      developerInstructions: _developerInstructions,
      toolHistory: _toolHistory,
      toolObservationOverlays: _toolObservationOverlays,
      sealedToolExchangeBoundary: _sealedToolExchangeBoundary,
      toolFollowUpUserContent: _toolFollowUpUserContent,
      ...requestWithoutGenericTraceSources
    } = input.request;
    void _developerInstructions;
    void _toolHistory;
    void _toolObservationOverlays;
    void _sealedToolExchangeBoundary;
    void _toolFollowUpUserContent;
    return {
      ...requestWithoutGenericTraceSources,
      systemPrompt: null,
      messages: [],
      deepSeekAppendTrace: {
        epoch: trace.activeEpoch,
        events: trace.events.map((event) => this.toResolvedEvent(event))
      }
    };
  }

  async clear(assistantChatId: string): Promise<void> {
    const trace = await this.internalApi.readDeepSeekAppendTrace(assistantChatId);
    if (trace === null) return;
    await this.internalApi.clearDeepSeekAppendTrace({
      assistantChatId,
      expectedEpoch: trace.activeEpoch
    });
  }

  async appendFinalAssistant(input: {
    assistantChatId: string;
    requestId: string;
    text: string | null;
  }): Promise<void> {
    if (input.text === null || input.text.trim().length === 0) return;
    const trace = await this.internalApi.readDeepSeekAppendTrace(input.assistantChatId);
    if (trace === null) {
      throw new ServiceUnavailableException(
        "DeepSeek append trace disappeared before final assistant persistence."
      );
    }
    await this.internalApi.appendDeepSeekAppendTrace({
      assistantChatId: input.assistantChatId,
      epoch: trace.activeEpoch,
      expectedOrdinal: trace.nextOrdinal,
      events: [
        {
          // A final reply can pass through self-check and completion paths. Its
          // runtime request id is the one durable identity, so retries/replays
          // cannot append the same assistant message twice.
          sourceKey: `final-assistant:${input.requestId}`,
          kind: "conversation",
          role: "assistant",
          contentText: input.text,
          contentJson: null,
          stateKey: null,
          revision: null,
          supersedes: null
        }
      ]
    });
  }

  private isChatRequest(request: ProviderGatewayTextGenerateRequest): boolean {
    return (
      request.requestMetadata?.classification === "main_turn" ||
      request.requestMetadata?.classification === "tool_loop_followup"
    );
  }

  private seedEvents(
    request: ProviderGatewayTextGenerateRequest,
    rawToolHistory: readonly ProviderGatewayToolExchange[]
  ): PersistedEvent[] {
    const baseEvents = this.baseMessageEvents(request);
    const firstConversationIndex = baseEvents.findIndex((event) => event.kind === "conversation");
    const stablePrefix =
      firstConversationIndex === -1 ? baseEvents : baseEvents.slice(0, firstConversationIndex);
    const initialConversation =
      firstConversationIndex === -1 ? [] : baseEvents.slice(firstConversationIndex);
    return [
      ...stablePrefix,
      // The first runtime context is a system instruction and must remain before
      // the initial user message. Later revisions deliberately append at the tail.
      this.contextEvent(request, 1, null),
      ...initialConversation,
      ...this.exchangeEvents(rawToolHistory),
      ...this.toolFollowUpUserEvents(request)
    ];
  }

  private appendableEvents(
    trace: InternalDeepSeekAppendTrace,
    request: ProviderGatewayTextGenerateRequest,
    rawToolHistory: readonly ProviderGatewayToolExchange[]
  ): PersistedEvent[] {
    const existing = new Set(trace.events.map((event) => event.sourceKey));
    // D2a order for later appends: sealed tool pairs first, then any context
    // revision, then the active user/follow-up input. Context must never land
    // after the turn's active input, and never between a tool_call/result pair.
    const exchangeCandidates = this.exchangeEvents(rawToolHistory);
    const inputCandidates = [
      ...this.currentTurnUserEvents(request),
      ...this.toolFollowUpUserEvents(request)
    ];
    const candidates = [...exchangeCandidates, ...inputCandidates];
    const existingBySourceKey = new Map(trace.events.map((event) => [event.sourceKey, event]));
    for (const candidate of candidates) {
      const persisted = existingBySourceKey.get(candidate.sourceKey);
      if (persisted !== undefined && !this.matchesPersistedEvent(persisted, candidate)) {
        throw new ServiceUnavailableException(
          "DeepSeek append trace conflicts with the assembled request; lifecycle reset is required."
        );
      }
    }
    const previousContext = [...trace.events]
      .reverse()
      .find((event) => event.stateKey === "runtime_context");
    const nextContext = this.contextMessage(request);
    const nextContextHash = this.hash(JSON.stringify(nextContext));
    const previousContextHash =
      previousContext?.sourceKey.split(":")[1] === undefined
        ? null
        : previousContext.sourceKey.split(":")[1];
    const contextAddition =
      previousContextHash === nextContextHash
        ? null
        : this.contextEvent(
            request,
            (previousContext?.revision ?? 0) + 1,
            previousContext?.sourceKey ?? null
          );
    return [
      ...exchangeCandidates.filter((event) => !existing.has(event.sourceKey)),
      ...(contextAddition === null ? [] : [contextAddition]),
      ...inputCandidates.filter((event) => !existing.has(event.sourceKey))
    ];
  }

  private currentTurnUserEvents(request: ProviderGatewayTextGenerateRequest): PersistedEvent[] {
    if (request.requestMetadata?.classification !== "main_turn") return [];
    const currentMessage = [...request.messages]
      .reverse()
      .find((message) => message.cacheRole !== "volatile_context");
    if (currentMessage === undefined) {
      throw new ServiceUnavailableException(
        "DeepSeek append trace main turn is missing its current user message."
      );
    }
    if (currentMessage.role !== "user") {
      throw new ServiceUnavailableException(
        "DeepSeek append trace main turn must end with a model-sanitized user message."
      );
    }
    const wire = this.messageToWire(currentMessage);
    const requestId = request.requestMetadata.runtimeRequestId;
    return [
      {
        sourceKey: `user-turn:${requestId}`,
        kind: "conversation",
        role: "user",
        contentText: wire.content,
        contentJson: null,
        stateKey: null,
        revision: null,
        supersedes: null
      }
    ];
  }

  private baseMessageEvents(request: ProviderGatewayTextGenerateRequest): PersistedEvent[] {
    const events: PersistedEvent[] = [];
    if (typeof request.systemPrompt === "string" && request.systemPrompt.trim().length > 0) {
      events.push(
        this.textEvent("stable_snapshot", "system", request.systemPrompt, "stable:system")
      );
    }
    const occurrences = new Map<string, number>();
    for (const message of request.messages) {
      if (message.cacheRole === "volatile_context") continue;
      for (const exchange of message.priorToolExchanges ?? []) {
        events.push(...this.exchangeEvents([exchange]));
      }
      const wire = this.messageToWire(message);
      const fingerprint = this.hash(JSON.stringify(wire));
      const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
      occurrences.set(fingerprint, occurrence);
      events.push({
        sourceKey: `conversation:${fingerprint}:${String(occurrence)}`,
        kind: "conversation",
        role: message.role,
        contentText: wire.content as string,
        contentJson: null,
        stateKey: null,
        revision: null,
        supersedes: null
      });
    }
    return events;
  }

  private exchangeEvents(exchanges: readonly ProviderGatewayToolExchange[]): PersistedEvent[] {
    return exchanges.flatMap((exchange) => {
      const assistant = {
        role: "assistant",
        content:
          typeof exchange.assistantText === "string" && exchange.assistantText.trim().length > 0
            ? exchange.assistantText
            : null,
        ...(typeof exchange.reasoningContent === "string" &&
        exchange.reasoningContent.trim().length > 0
          ? { reasoning_content: exchange.reasoningContent }
          : {}),
        tool_calls: [
          {
            id: exchange.toolCall.id,
            type: "function",
            function: {
              name: exchange.toolCall.name,
              arguments: JSON.stringify(exchange.toolCall.arguments)
            }
          }
        ]
      };
      const isDescribe = this.isDescribeResult(exchange.toolResult.content);
      return [
        {
          sourceKey: `assistant-tool:${exchange.toolCall.id}`,
          kind: "assistant_tool_call" as const,
          role: "assistant" as const,
          contentText: null,
          contentJson: assistant,
          stateKey: null,
          revision: null,
          supersedes: null
        },
        {
          sourceKey: `tool-result:${exchange.toolResult.toolCallId}`,
          kind: isDescribe ? ("catalog_describe" as const) : ("tool_result" as const),
          role: "tool" as const,
          contentText: exchange.toolResult.content,
          contentJson: { tool_call_id: exchange.toolResult.toolCallId },
          stateKey: null,
          revision: null,
          supersedes: null
        }
      ];
    });
  }

  private toolFollowUpUserEvents(request: ProviderGatewayTextGenerateRequest): PersistedEvent[] {
    if (request.toolFollowUpUserContent === undefined) return [];
    const content = this.textOnlyFollowUpContent(request.toolFollowUpUserContent);
    const fingerprint = this.hash(content);
    const requestId = request.requestMetadata?.runtimeRequestId;
    const iteration = request.requestMetadata?.toolLoopIteration;
    if (requestId === undefined || iteration === undefined) {
      throw new ServiceUnavailableException(
        "DeepSeek append trace tool follow-up content requires turn request metadata."
      );
    }
    return [
      {
        sourceKey: `tool-follow-up-user:${requestId}:${String(iteration)}:${fingerprint}`,
        kind: "conversation",
        role: "user",
        contentText: content,
        contentJson: null,
        stateKey: null,
        revision: null,
        supersedes: null
      }
    ];
  }

  private contextEvent(
    request: ProviderGatewayTextGenerateRequest,
    revision: number,
    supersedes: string | null
  ): PersistedEvent {
    const message = this.contextMessage(request);
    const supersedesAttribute = supersedes === null ? "" : ` supersedes="${supersedes}"`;
    return {
      sourceKey: `runtime-context:${this.hash(JSON.stringify(message))}:${String(revision)}`,
      kind: "context_revision",
      role: "system",
      contentText: `<persai_runtime_context_revision state_key="runtime_context" revision="${String(revision)}"${supersedesAttribute}>\n${message.content}\n</persai_runtime_context_revision>`,
      contentJson: null,
      stateKey: "runtime_context",
      revision,
      supersedes
    };
  }

  private contextMessage(request: ProviderGatewayTextGenerateRequest): {
    role: "system";
    content: string;
  } {
    const volatile = request.messages
      .filter((message) => message.cacheRole === "volatile_context")
      .map((message) => this.messageToWire(message).content);
    const parts = [
      ...(typeof request.developerInstructions === "string" &&
      request.developerInstructions.length > 0
        ? [request.developerInstructions]
        : []),
      ...volatile
    ];
    return {
      role: "system",
      content: parts.length === 0 ? "<persai_runtime_context/>" : parts.join("\n\n")
    };
  }

  private toResolvedEvent(
    event: InternalDeepSeekAppendTraceEvent
  ): ProviderGatewayDeepSeekAppendTraceEvent {
    return {
      ordinal: event.ordinal,
      sourceKey: event.sourceKey,
      kind: event.kind,
      message: this.eventMessage(event)
    };
  }

  private eventMessage(event: InternalDeepSeekAppendTraceEvent): Record<string, unknown> {
    if (
      event.contentJson !== null &&
      typeof event.contentJson === "object" &&
      !Array.isArray(event.contentJson)
    ) {
      return {
        role: event.role,
        ...(event.contentText === null ? {} : { content: event.contentText }),
        ...(event.contentJson as Record<string, unknown>)
      };
    }
    return { role: event.role, content: event.contentText };
  }

  private textEvent(
    kind: "stable_snapshot",
    role: "system",
    content: string,
    sourceKey: string
  ): PersistedEvent {
    return {
      sourceKey,
      kind,
      role,
      contentText: content,
      contentJson: null,
      stateKey: null,
      revision: null,
      supersedes: null
    };
  }

  private messageToWire(message: ProviderGatewayTextMessage): {
    role: "user" | "assistant";
    content: string;
  } {
    if (typeof message.content !== "string") {
      throw new ServiceUnavailableException(
        "DeepSeek append trace requires text-only model-sanitized chat content."
      );
    }
    return { role: message.role, content: message.content };
  }

  private textOnlyFollowUpContent(
    content: NonNullable<ProviderGatewayTextGenerateRequest["toolFollowUpUserContent"]>
  ): string {
    if (typeof content === "string") return content;
    const parts: string[] = [];
    for (const block of content) {
      if (block.type !== "text") {
        throw new ServiceUnavailableException(
          "DeepSeek append trace cannot safely persist non-text tool follow-up content."
        );
      }
      parts.push(block.text);
    }
    return parts.join("");
  }

  private isDescribeResult(content: string): boolean {
    try {
      return (JSON.parse(content) as { action?: unknown }).action === "described_contract";
    } catch {
      return false;
    }
  }

  private matchesPersistedEvent(
    persisted: InternalDeepSeekAppendTraceEvent,
    candidate: PersistedEvent
  ): boolean {
    return (
      persisted.kind === candidate.kind &&
      persisted.role === candidate.role &&
      persisted.contentText === candidate.contentText &&
      JSON.stringify(persisted.contentJson) === JSON.stringify(candidate.contentJson)
    );
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private configHash(request: ProviderGatewayTextGenerateRequest): string {
    return this.hash(
      JSON.stringify({
        provider: request.provider,
        model: request.model,
        systemPrompt: request.systemPrompt,
        tools: request.tools ?? []
      })
    );
  }
}
