import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  AssistantLiveVoiceSessionStatus,
  AssistantLiveVoiceTransportProtocol,
  AssistantLiveVoiceTransportRoute
} from "@prisma/client";
import type { SupportedLocale } from "@persai/types";
import { normalizeAssistantVoiceProfile } from "./assistant-voice-profile";
import { AssistantLiveVoiceRelayTicketService } from "./assistant-live-voice-relay-ticket.service";
import { type PlatformLiveVoiceReadinessSettings } from "./platform-runtime-provider-settings";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { ResolveUserLocaleService } from "./resolve-user-locale.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ElevenlabsLiveVoiceClient } from "./elevenlabs/elevenlabs-live-voice.client";

export type AssistantLiveVoiceSessionState = {
  id: string;
  chatId: string;
  status: AssistantLiveVoiceSessionStatus;
  selectedVoiceId: string;
  transportProtocol: AssistantLiveVoiceTransportProtocol;
  transportRoute: AssistantLiveVoiceTransportRoute;
  localDurationMs: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string;
  stoppedAt: string | null;
};

export type AssistantLiveVoiceSessionStartState = {
  session: AssistantLiveVoiceSessionState;
  transport: {
    protocol: AssistantLiveVoiceTransportProtocol;
    route: AssistantLiveVoiceTransportRoute;
    credential: {
      conversationToken?: string;
      signedUrl?: string;
    };
  };
  clientConfig: {
    agentId: string;
    connectionType: "webrtc" | "websocket";
    overrides: {
      voiceId: string;
      language: SupportedLocale;
    };
    customLlmExtraBody: {
      persaiLiveVoiceSessionId: string;
    };
    preferRelay: boolean;
    relay?: {
      path: string;
      ticket: string;
      expiresAt: string;
    };
  };
};

@Injectable()
export class AssistantLiveVoiceSessionService {
  private readonly logger = new Logger(AssistantLiveVoiceSessionService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly elevenlabsLiveVoiceClient: ElevenlabsLiveVoiceClient,
    private readonly resolveUserLocaleService: ResolveUserLocaleService,
    private readonly assistantLiveVoiceRelayTicketService: AssistantLiveVoiceRelayTicketService
  ) {}

  async startSession(input: {
    userId: string;
    chatId: string;
  }): Promise<AssistantLiveVoiceSessionStartState> {
    const context = await this.resolveActiveAssistantService.execute({ userId: input.userId });
    const chat = await this.assertOwnedChat({
      assistantId: context.assistantId,
      workspaceId: context.workspaceId,
      userId: input.userId,
      chatId: input.chatId
    });
    const liveVoice = await this.getRequiredLiveVoiceReadiness();
    const language = await this.resolveUserLocaleService.forUserInWorkspace(
      input.userId,
      context.workspaceId
    );

    const selectedVoiceId =
      normalizeAssistantVoiceProfile(context.assistant.draftVoiceProfile).elevenlabs.voiceId ??
      null;
    if (selectedVoiceId === null) {
      throw new BadRequestException({
        message: "This assistant does not have an ElevenLabs voice configured.",
        code: "live_voice_voice_unavailable"
      });
    }
    const preferRelay = liveVoice.transportRoute === "relay";

    // Starting a fresh live session supersedes any session still marked active
    // for this chat. A previous attempt that failed during transport setup can
    // leave a stale `active` row (the client stop is best-effort); blocking the
    // next start on it would strand the user. Superseding is idempotent and the
    // only owner here is the same assistant+chat.
    const stoppedAt = new Date();
    const superseded = await this.prisma.assistantLiveVoiceSession.updateMany({
      where: {
        assistantId: context.assistantId,
        chatId: chat.id,
        status: "active"
      },
      data: {
        status: "stopped",
        failureCode: "live_voice_superseded",
        failureMessage: "Superseded by a new live voice session.",
        stoppedAt
      }
    });
    if (superseded.count > 0) {
      this.logger.warn(
        `Superseded ${String(superseded.count)} stale active live voice session(s) for chat ${chat.id}.`
      );
    }

    let credential:
      | {
          transportProtocol: "webrtc";
          conversationToken: string;
        }
      | {
          transportProtocol: "websocket";
          signedUrl: string;
        }
      | null = null;
    if (!preferRelay) {
      try {
        credential = await this.elevenlabsLiveVoiceClient.issueCredential({
          agentId: liveVoice.agentId,
          transportProtocol: liveVoice.transportProtocol
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to issue ElevenLabs live voice credential.";
        throw new ServiceUnavailableException({
          message,
          code: "live_voice_credential_unavailable"
        });
      }
    }

    const session = await this.prisma.assistantLiveVoiceSession.create({
      data: {
        assistantId: context.assistantId,
        workspaceId: context.workspaceId,
        userId: input.userId,
        chatId: chat.id,
        elevenlabsAgentId: liveVoice.agentId,
        elevenlabsVoiceId: selectedVoiceId,
        transportProtocol: liveVoice.transportProtocol,
        transportRoute: liveVoice.transportRoute,
        metadata: {}
      }
    });
    let relay:
      | {
          ticket: string;
          expiresAt: string;
        }
      | undefined;
    try {
      relay = await this.assistantLiveVoiceRelayTicketService.issue({
        sessionId: session.id,
        userId: input.userId
      });
    } catch (_error) {
      if (preferRelay) {
        throw new ServiceUnavailableException({
          message: "Live voice relay transport is configured but its signing secret is not set.",
          code: "live_voice_relay_secret_unavailable"
        });
      }
      this.logger.warn(
        `Live voice relay ticket unavailable for direct session ${session.id}; continuing without relay fallback.`
      );
    }

    return {
      session: this.toState(session),
      transport: {
        protocol: liveVoice.transportProtocol,
        route: liveVoice.transportRoute,
        credential:
          credential === null
            ? {}
            : credential.transportProtocol === "webrtc"
              ? { conversationToken: credential.conversationToken }
              : { signedUrl: credential.signedUrl }
      },
      clientConfig: {
        agentId: liveVoice.agentId,
        connectionType: preferRelay ? "websocket" : liveVoice.transportProtocol,
        overrides: {
          voiceId: selectedVoiceId,
          language
        },
        customLlmExtraBody: {
          persaiLiveVoiceSessionId: session.id
        },
        preferRelay,
        ...(relay === undefined
          ? {}
          : {
              relay: {
                path: "/api/v1/assistant/live-voice/relay",
                ticket: relay.ticket,
                expiresAt: relay.expiresAt
              }
            })
      }
    };
  }

  async getStatus(input: {
    userId: string;
    sessionId: string;
  }): Promise<AssistantLiveVoiceSessionState> {
    const context = await this.resolveActiveAssistantService.execute({ userId: input.userId });
    const session = await this.prisma.assistantLiveVoiceSession.findFirst({
      where: {
        id: input.sessionId,
        assistantId: context.assistantId,
        workspaceId: context.workspaceId,
        userId: input.userId
      }
    });
    if (session === null) {
      throw new NotFoundException({
        message: "Live voice session not found.",
        code: "live_voice_session_not_found"
      });
    }
    return this.toState(session);
  }

  async stopSession(input: {
    userId: string;
    sessionId: string;
    failureCode?: string | null;
    failureMessage?: string | null;
  }): Promise<AssistantLiveVoiceSessionState> {
    const context = await this.resolveActiveAssistantService.execute({ userId: input.userId });
    const session = await this.prisma.assistantLiveVoiceSession.findFirst({
      where: {
        id: input.sessionId,
        assistantId: context.assistantId,
        workspaceId: context.workspaceId,
        userId: input.userId
      }
    });
    if (session === null) {
      throw new NotFoundException({
        message: "Live voice session not found.",
        code: "live_voice_session_not_found"
      });
    }
    if (session.status !== "active") {
      return this.toState(session);
    }

    const stoppedAt = new Date();
    const localDurationMs = Math.max(0, stoppedAt.getTime() - session.startedAt.getTime());
    const hasFailure =
      (typeof input.failureCode === "string" && input.failureCode.trim().length > 0) ||
      (typeof input.failureMessage === "string" && input.failureMessage.trim().length > 0);
    const updated = await this.prisma.assistantLiveVoiceSession.update({
      where: { id: session.id },
      data: {
        status: hasFailure ? "failed" : "stopped",
        localDurationMs,
        failureCode:
          typeof input.failureCode === "string" && input.failureCode.trim().length > 0
            ? input.failureCode.trim()
            : null,
        failureMessage:
          typeof input.failureMessage === "string" && input.failureMessage.trim().length > 0
            ? input.failureMessage.trim()
            : null,
        stoppedAt
      }
    });
    return this.toState(updated);
  }

  private async getRequiredLiveVoiceReadiness(): Promise<
    PlatformLiveVoiceReadinessSettings & { agentId: string }
  > {
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    if (!settings.liveVoice.enabled || settings.liveVoice.agentId === null) {
      throw new ServiceUnavailableException({
        message: "Live voice is not configured by the operator.",
        code: "live_voice_unavailable"
      });
    }
    return {
      ...settings.liveVoice,
      agentId: settings.liveVoice.agentId
    };
  }

  private async assertOwnedChat(input: {
    assistantId: string;
    workspaceId: string;
    userId: string;
    chatId: string;
  }) {
    const chat = await this.prisma.assistantChat.findUnique({
      where: { id: input.chatId }
    });
    if (
      chat === null ||
      chat.assistantId !== input.assistantId ||
      chat.workspaceId !== input.workspaceId ||
      chat.userId !== input.userId
    ) {
      throw new NotFoundException({
        message: "Chat not found for this assistant workspace.",
        code: "chat_not_found"
      });
    }
    return chat;
  }

  private toState(session: {
    id: string;
    chatId: string;
    status: AssistantLiveVoiceSessionStatus;
    elevenlabsVoiceId: string;
    transportProtocol: AssistantLiveVoiceTransportProtocol;
    transportRoute: AssistantLiveVoiceTransportRoute;
    localDurationMs: number | null;
    failureCode: string | null;
    failureMessage: string | null;
    startedAt: Date;
    stoppedAt: Date | null;
  }): AssistantLiveVoiceSessionState {
    return {
      id: session.id,
      chatId: session.chatId,
      status: session.status,
      selectedVoiceId: session.elevenlabsVoiceId,
      transportProtocol: session.transportProtocol,
      transportRoute: session.transportRoute,
      localDurationMs: session.localDurationMs,
      failureCode: session.failureCode,
      failureMessage: session.failureMessage,
      startedAt: session.startedAt.toISOString(),
      stoppedAt: session.stoppedAt?.toISOString() ?? null
    };
  }
}
