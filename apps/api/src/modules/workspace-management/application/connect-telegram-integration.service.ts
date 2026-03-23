import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { ResolveEffectiveCapabilityStateService } from "./resolve-effective-capability-state.service";
import { ResolveTelegramIntegrationStateService } from "./resolve-telegram-integration-state.service";
import type { TelegramConnectInput, TelegramIntegrationState } from "./telegram-integration.types";

type TelegramGetMeResult = {
  id: number;
  first_name?: string;
  username?: string;
};

function toAvatarUrl(username: string | undefined): string | null {
  if (typeof username !== "string" || username.trim().length === 0) {
    return null;
  }
  return `https://t.me/i/userpic/320/${username.trim()}.jpg`;
}

@Injectable()
export class ConnectTelegramIntegrationService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly resolveEffectiveCapabilityStateService: ResolveEffectiveCapabilityStateService,
    private readonly resolveTelegramIntegrationStateService: ResolveTelegramIntegrationStateService
  ) {}

  parseInput(body: unknown): TelegramConnectInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Telegram connect payload must be an object.");
    }
    const token = (body as { botToken?: unknown }).botToken;
    if (typeof token !== "string") {
      throw new BadRequestException("botToken must be a string.");
    }
    const trimmed = token.trim();
    if (trimmed.length < 20 || !trimmed.includes(":")) {
      throw new BadRequestException("botToken format is invalid.");
    }
    return { botToken: trimmed };
  }

  async execute(userId: string, input: TelegramConnectInput): Promise<TelegramIntegrationState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const governance =
      (await this.assistantGovernanceRepository.findByAssistantId(assistant.id)) ??
      (await this.assistantGovernanceRepository.createBaseline(assistant.id));
    const effectiveCapabilities = await this.resolveEffectiveCapabilityStateService.execute({
      assistant,
      governance
    });
    if (!effectiveCapabilities.channelsAndSurfaces.telegram) {
      throw new ConflictException("Telegram channel is not allowed for the current effective plan.");
    }

    const bot = await this.fetchBotProfile(input.botToken);
    const tokenFingerprint = createHash("sha256").update(input.botToken).digest("hex");
    const tokenLastFour = input.botToken.slice(-4);

    await this.assistantChannelSurfaceBindingRepository.upsert({
      assistantId: assistant.id,
      providerKey: "telegram",
      surfaceType: "telegram_bot",
      bindingState: "active",
      tokenFingerprint,
      tokenLastFour,
      policy: {
        inboundUserMessages: true,
        outboundAssistantMessages: true
      },
      config: {
        defaultParseMode: "plain_text",
        notes: null
      },
      metadata: {
        telegramUserId: bot.id,
        username: bot.username ?? null,
        displayName: bot.first_name ?? null,
        avatarUrl: toAvatarUrl(bot.username)
      },
      connectedAt: new Date(),
      disconnectedAt: null
    });

    return this.resolveTelegramIntegrationStateService.execute(userId);
  }

  private async fetchBotProfile(botToken: string): Promise<TelegramGetMeResult> {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    if (!response.ok) {
      throw new BadRequestException("Telegram token verification failed.");
    }
    const payload = (await response.json()) as {
      ok?: boolean;
      result?: TelegramGetMeResult;
    };
    if (payload.ok !== true || payload.result === undefined || typeof payload.result.id !== "number") {
      throw new BadRequestException("Telegram token is invalid or cannot be verified.");
    }
    return payload.result;
  }
}
