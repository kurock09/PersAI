import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  PERSAI_PROVIDER_PROMPT_CACHE_RETENTIONS,
  PERSAI_PROVIDER_REQUEST_CLASSIFICATIONS,
  PERSAI_RUNTIME_SHARED_COMPACTION_TOOL_CODES,
  type ProviderGatewayMessageContent,
  type ProviderGatewayTextGenerateRequest,
  type ProviderGatewayTextGenerateResult,
  type ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import { AnthropicProviderClient } from "./anthropic/anthropic-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { normalizeModelKey, toNormalizedNonEmptyModelKey } from "./model-key-normalization";
import { ProviderWarmupService } from "./provider-warmup.service";

@Injectable()
export class ProviderTextGenerationService {
  private readonly logger = new Logger(ProviderTextGenerationService.name);

  constructor(
    private readonly providerWarmupService: ProviderWarmupService,
    private readonly openaiProviderClient: OpenAIProviderClient,
    private readonly anthropicProviderClient: AnthropicProviderClient
  ) {}

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    this.assertValidRequest(input);
    await this.assertProviderReady(input);

    switch (input.provider) {
      case "openai":
        return this.openaiProviderClient.generateText(input);
      case "anthropic":
        return this.anthropicProviderClient.generateText(input);
    }
  }

  async streamText(
    input: ProviderGatewayTextGenerateRequest,
    signal?: AbortSignal
  ): Promise<AsyncGenerator<ProviderGatewayTextStreamEvent>> {
    this.assertValidRequest(input);
    await this.assertProviderReady(input);
    this.logger.log(
      `[stream-text-dispatch] requestId=${input.requestMetadata?.runtimeRequestId ?? "unknown"} classification=${input.requestMetadata?.classification ?? "unknown"} iteration=${
        input.requestMetadata?.toolLoopIteration === null ||
        input.requestMetadata?.toolLoopIteration === undefined
          ? "null"
          : String(input.requestMetadata.toolLoopIteration)
      } provider=${input.provider} model=${input.model}`
    );

    switch (input.provider) {
      case "openai":
        return this.openaiProviderClient.streamText(input, signal);
      case "anthropic":
        return this.anthropicProviderClient.streamText(input, signal);
    }
  }

  private assertValidRequest(input: ProviderGatewayTextGenerateRequest): void {
    if (toNormalizedNonEmptyModelKey(input.model) === null) {
      throw new BadRequestException("model must be a non-empty string");
    }
    if (input.messages.length === 0) {
      throw new BadRequestException("messages must include at least one item");
    }
    for (const [index, message] of input.messages.entries()) {
      this.assertValidMessageContent(message.content, index);
    }
    if (input.toolFollowUpUserContent !== undefined) {
      this.assertValidMessageContent(input.toolFollowUpUserContent, -1, "toolFollowUpUserContent");
    }
    if (
      input.maxOutputTokens !== undefined &&
      (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0)
    ) {
      throw new BadRequestException("maxOutputTokens must be a positive integer when provided");
    }
    const declaredToolNames = this.assertValidTools(input);
    this.assertValidToolChoice(input, declaredToolNames);
    this.assertValidToolHistory(input);
    this.assertValidOutputSchema(input);
    this.assertValidRequestMetadata(input);
    this.assertValidPromptCache(input);
    this.assertValidTimeoutMsHint(input);
    this.assertValidThinkingBudget(input);
  }

  private async assertProviderReady(input: ProviderGatewayTextGenerateRequest): Promise<void> {
    await this.providerWarmupService.ensureReadyForRequest({
      provider: input.provider,
      model: normalizeModelKey(input.model)
    });
  }

  private assertValidMessageContent(
    content: ProviderGatewayMessageContent,
    index: number,
    fieldName = `messages[${String(index)}].content`
  ): void {
    if (typeof content === "string") {
      if (content.trim().length === 0) {
        throw new BadRequestException(`${fieldName} must be non-empty`);
      }
      return;
    }

    if (content.length === 0) {
      throw new BadRequestException(`${fieldName} must include at least one block`);
    }

    for (const [blockIndex, block] of content.entries()) {
      if (block.type === "text") {
        if (block.text.trim().length === 0) {
          throw new BadRequestException(
            `${fieldName}[${String(blockIndex)}].text must be non-empty`
          );
        }
        continue;
      }

      if (block.type === "image" && !block.mimeType.startsWith("image/")) {
        throw new BadRequestException(
          `${fieldName}[${String(blockIndex)}].mimeType must be an image MIME`
        );
      }
      if (block.type === "pdf" && block.mimeType !== "application/pdf") {
        throw new BadRequestException(
          `${fieldName}[${String(blockIndex)}].mimeType must be application/pdf`
        );
      }
      if (block.dataBase64.trim().length === 0) {
        throw new BadRequestException(
          `${fieldName}[${String(blockIndex)}].dataBase64 must be non-empty`
        );
      }
    }
  }

  private assertValidTools(input: ProviderGatewayTextGenerateRequest): Set<string> {
    const declaredToolNames = new Set<string>();
    if (input.tools === undefined) {
      return declaredToolNames;
    }
    for (const [index, tool] of input.tools.entries()) {
      if (tool.name.trim().length === 0) {
        throw new BadRequestException(`tools[${index}].name must be a non-empty string`);
      }
      if (tool.description.trim().length === 0) {
        throw new BadRequestException(`tools[${index}].description must be a non-empty string`);
      }
      if (
        tool.inputSchema === null ||
        typeof tool.inputSchema !== "object" ||
        Array.isArray(tool.inputSchema)
      ) {
        throw new BadRequestException(`tools[${index}].inputSchema must be an object`);
      }
      if (declaredToolNames.has(tool.name)) {
        throw new BadRequestException(`tools has duplicate name "${tool.name}"`);
      }
      declaredToolNames.add(tool.name);
    }
    return declaredToolNames;
  }

  private assertValidToolChoice(
    input: ProviderGatewayTextGenerateRequest,
    declaredToolNames: Set<string>
  ): void {
    if (
      input.toolChoice === undefined ||
      input.toolChoice === "auto" ||
      input.toolChoice === "none"
    ) {
      return;
    }
    if (input.toolChoice.type !== "tool" || input.toolChoice.name.trim().length === 0) {
      throw new BadRequestException("toolChoice must be auto, none, or a named tool selection");
    }
    if (!declaredToolNames.has(input.toolChoice.name)) {
      throw new BadRequestException(
        `toolChoice references undeclared tool "${input.toolChoice.name}"`
      );
    }
  }

  private assertValidToolHistory(input: ProviderGatewayTextGenerateRequest): void {
    if (input.toolHistory === undefined) {
      return;
    }
    const seenCallIds = new Set<string>();
    for (const [index, exchange] of input.toolHistory.entries()) {
      if (exchange.toolCall.id.trim().length === 0) {
        throw new BadRequestException(`toolHistory[${index}].toolCall.id must be non-empty`);
      }
      if (seenCallIds.has(exchange.toolCall.id)) {
        throw new BadRequestException(
          `toolHistory has duplicate toolCall.id "${exchange.toolCall.id}"`
        );
      }
      seenCallIds.add(exchange.toolCall.id);
      if (exchange.toolCall.name.trim().length === 0) {
        throw new BadRequestException(`toolHistory[${index}].toolCall.name must be non-empty`);
      }
      if (
        exchange.toolCall.arguments === null ||
        typeof exchange.toolCall.arguments !== "object" ||
        Array.isArray(exchange.toolCall.arguments)
      ) {
        throw new BadRequestException(`toolHistory[${index}].toolCall.arguments must be an object`);
      }
      if (exchange.toolResult.toolCallId !== exchange.toolCall.id) {
        throw new BadRequestException(
          `toolHistory[${index}].toolResult.toolCallId must match toolCall.id`
        );
      }
      if (exchange.toolResult.name !== exchange.toolCall.name) {
        throw new BadRequestException(
          `toolHistory[${index}].toolResult.name must match toolCall.name`
        );
      }
      if (exchange.toolResult.content.trim().length === 0) {
        throw new BadRequestException(`toolHistory[${index}].toolResult.content must be non-empty`);
      }
    }
  }

  private assertValidOutputSchema(input: ProviderGatewayTextGenerateRequest): void {
    const outputSchema = input.outputSchema;
    if (outputSchema === undefined) {
      return;
    }
    if (outputSchema === null || typeof outputSchema !== "object" || Array.isArray(outputSchema)) {
      throw new BadRequestException("outputSchema must be an object when provided");
    }

    const name = typeof outputSchema.name === "string" ? outputSchema.name.trim() : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
      throw new BadRequestException(
        "outputSchema.name must be 1-64 chars of letters, numbers, underscores, or dashes"
      );
    }
    if (
      outputSchema.description !== undefined &&
      (typeof outputSchema.description !== "string" || outputSchema.description.trim().length === 0)
    ) {
      throw new BadRequestException(
        "outputSchema.description must be a non-empty string when provided"
      );
    }
    if (
      outputSchema.schema === null ||
      typeof outputSchema.schema !== "object" ||
      Array.isArray(outputSchema.schema)
    ) {
      throw new BadRequestException("outputSchema.schema must be an object");
    }
    if (outputSchema.strict !== undefined && typeof outputSchema.strict !== "boolean") {
      throw new BadRequestException("outputSchema.strict must be a boolean when provided");
    }
  }

  private assertValidRequestMetadata(input: ProviderGatewayTextGenerateRequest): void {
    const metadata = input.requestMetadata;
    if (metadata === undefined) {
      return;
    }
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new BadRequestException("requestMetadata must be an object when provided");
    }

    if (
      !PERSAI_PROVIDER_REQUEST_CLASSIFICATIONS.includes(
        metadata.classification as (typeof PERSAI_PROVIDER_REQUEST_CLASSIFICATIONS)[number]
      )
    ) {
      throw new BadRequestException(
        "requestMetadata.classification must be a supported provider request classification"
      );
    }

    this.assertNullableNonEmptyString(
      metadata.runtimeRequestId,
      "requestMetadata.runtimeRequestId"
    );
    const runtimeSessionId = this.assertNullableNonEmptyString(
      metadata.runtimeSessionId,
      "requestMetadata.runtimeSessionId"
    );
    if (
      metadata.toolLoopIteration !== null &&
      (!Number.isInteger(metadata.toolLoopIteration) || metadata.toolLoopIteration < 0)
    ) {
      throw new BadRequestException(
        "requestMetadata.toolLoopIteration must be a non-negative integer or null"
      );
    }
    if (
      metadata.compactionToolCode !== null &&
      !PERSAI_RUNTIME_SHARED_COMPACTION_TOOL_CODES.includes(metadata.compactionToolCode)
    ) {
      throw new BadRequestException(
        "requestMetadata.compactionToolCode must be a supported shared compaction tool code or null"
      );
    }

    switch (metadata.classification) {
      case "main_turn":
        if (metadata.toolLoopIteration !== 0) {
          throw new BadRequestException(
            "requestMetadata.toolLoopIteration must be 0 for main_turn requests"
          );
        }
        if (runtimeSessionId === null) {
          throw new BadRequestException(
            "requestMetadata.runtimeSessionId must be set for main_turn requests"
          );
        }
        break;
      case "tool_loop_followup":
        if (
          metadata.toolLoopIteration === null ||
          !Number.isInteger(metadata.toolLoopIteration) ||
          metadata.toolLoopIteration < 1
        ) {
          throw new BadRequestException(
            "requestMetadata.toolLoopIteration must be >= 1 for tool_loop_followup requests"
          );
        }
        if (runtimeSessionId === null) {
          throw new BadRequestException(
            "requestMetadata.runtimeSessionId must be set for tool_loop_followup requests"
          );
        }
        break;
      case "manual_compaction":
      case "auto_compaction":
        if (runtimeSessionId === null) {
          throw new BadRequestException(
            "requestMetadata.runtimeSessionId must be set for shared compaction requests"
          );
        }
        if (metadata.compactionToolCode === null) {
          throw new BadRequestException(
            "requestMetadata.compactionToolCode must be set for shared compaction requests"
          );
        }
        if (metadata.toolLoopIteration !== null) {
          throw new BadRequestException(
            "requestMetadata.toolLoopIteration must be null for shared compaction requests"
          );
        }
        break;
    }
  }

  private assertValidPromptCache(input: ProviderGatewayTextGenerateRequest): void {
    const promptCache = input.promptCache;
    if (promptCache === undefined) {
      return;
    }
    if (promptCache === null || typeof promptCache !== "object" || Array.isArray(promptCache)) {
      throw new BadRequestException("promptCache must be an object when provided");
    }
    if (
      promptCache.key !== undefined &&
      (typeof promptCache.key !== "string" || promptCache.key.trim().length === 0)
    ) {
      throw new BadRequestException("promptCache.key must be a non-empty string when provided");
    }
    if (typeof promptCache.key === "string" && promptCache.key.length > 64) {
      throw new BadRequestException("promptCache.key must be at most 64 characters when provided");
    }
    if (
      promptCache.retention !== undefined &&
      !PERSAI_PROVIDER_PROMPT_CACHE_RETENTIONS.includes(promptCache.retention)
    ) {
      throw new BadRequestException(
        "promptCache.retention must be one of the supported provider prompt cache retention values"
      );
    }
  }

  private assertValidTimeoutMsHint(input: ProviderGatewayTextGenerateRequest): void {
    if (input.timeoutMsHint === undefined) {
      return;
    }
    if (!Number.isInteger(input.timeoutMsHint) || Number(input.timeoutMsHint) <= 0) {
      throw new BadRequestException("timeoutMsHint must be a positive integer when provided");
    }
    if (Number(input.timeoutMsHint) > 600_000) {
      throw new BadRequestException("timeoutMsHint must not exceed 600000ms (10 minutes)");
    }
  }

  private assertValidThinkingBudget(input: ProviderGatewayTextGenerateRequest): void {
    if (input.thinkingBudget === undefined) {
      return;
    }
    if (!Number.isInteger(input.thinkingBudget) || input.thinkingBudget < 0) {
      throw new BadRequestException("thinkingBudget must be a non-negative integer when provided");
    }
  }

  private assertNullableNonEmptyString(value: unknown, field: string): string | null {
    if (value === null) {
      return null;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    throw new BadRequestException(`${field} must be a non-empty string or null`);
  }
}
