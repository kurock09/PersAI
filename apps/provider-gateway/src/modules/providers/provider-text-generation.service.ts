import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  ProviderGatewayMessageContent,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import { AnthropicProviderClient } from "./anthropic/anthropic-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { ProviderWarmupService } from "./provider-warmup.service";

@Injectable()
export class ProviderTextGenerationService {
  constructor(
    private readonly providerWarmupService: ProviderWarmupService,
    private readonly openaiProviderClient: OpenAIProviderClient,
    private readonly anthropicProviderClient: AnthropicProviderClient
  ) {}

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    this.assertValidRequest(input);
    this.assertProviderReady(input);

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
    this.assertProviderReady(input);

    switch (input.provider) {
      case "openai":
        return this.openaiProviderClient.streamText(input, signal);
      case "anthropic":
        return this.anthropicProviderClient.streamText(input, signal);
    }
  }

  private assertValidRequest(input: ProviderGatewayTextGenerateRequest): void {
    if (input.model.trim().length === 0) {
      throw new BadRequestException("model must be a non-empty string");
    }
    if (input.messages.length === 0) {
      throw new BadRequestException("messages must include at least one item");
    }
    for (const [index, message] of input.messages.entries()) {
      this.assertValidMessageContent(message.content, index);
    }
    if (
      input.maxOutputTokens !== undefined &&
      (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0)
    ) {
      throw new BadRequestException("maxOutputTokens must be a positive integer when provided");
    }
    const declaredToolNames = this.assertValidTools(input);
    this.assertValidToolChoice(input, declaredToolNames);
    this.assertValidToolHistory(input, declaredToolNames);
  }

  private assertProviderReady(input: ProviderGatewayTextGenerateRequest): void {
    const providerState = this.providerWarmupService
      .getSnapshot()
      .providers.find((provider) => provider.provider === input.provider);
    if (!providerState || providerState.state !== "ready") {
      throw new ServiceUnavailableException(`Provider "${input.provider}" is not ready.`);
    }
    if (
      providerState.catalogModels.length > 0 &&
      !providerState.catalogModels.includes(input.model.trim())
    ) {
      throw new BadRequestException(
        `Model "${input.model}" is not present in the warmed provider catalog for "${input.provider}".`
      );
    }
  }

  private assertValidMessageContent(content: ProviderGatewayMessageContent, index: number): void {
    if (typeof content === "string") {
      if (content.trim().length === 0) {
        throw new BadRequestException(`messages[${index}].content must be non-empty`);
      }
      return;
    }

    if (content.length === 0) {
      throw new BadRequestException(`messages[${index}].content must include at least one block`);
    }

    for (const [blockIndex, block] of content.entries()) {
      if (block.type === "text") {
        if (block.text.trim().length === 0) {
          throw new BadRequestException(
            `messages[${index}].content[${blockIndex}].text must be non-empty`
          );
        }
        continue;
      }

      if (block.type === "image" && !block.mimeType.startsWith("image/")) {
        throw new BadRequestException(
          `messages[${index}].content[${blockIndex}].mimeType must be an image MIME`
        );
      }
      if (block.type === "pdf" && block.mimeType !== "application/pdf") {
        throw new BadRequestException(
          `messages[${index}].content[${blockIndex}].mimeType must be application/pdf`
        );
      }
      if (block.dataBase64.trim().length === 0) {
        throw new BadRequestException(
          `messages[${index}].content[${blockIndex}].dataBase64 must be non-empty`
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

  private assertValidToolHistory(
    input: ProviderGatewayTextGenerateRequest,
    declaredToolNames: Set<string>
  ): void {
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
      if (declaredToolNames.size > 0 && !declaredToolNames.has(exchange.toolCall.name)) {
        throw new BadRequestException(
          `toolHistory[${index}] references undeclared tool "${exchange.toolCall.name}"`
        );
      }
    }
  }
}
