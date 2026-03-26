import { Inject, Injectable } from "@nestjs/common";
import type { EffectiveCapabilityState } from "./effective-capability.types";
import type {
  OpenClawBindingState,
  OpenClawChannelSurfaceBindingsState,
  OpenClawProviderKey,
  OpenClawSurfaceType
} from "./openclaw-channel-surface-bindings.types";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import { resolveTelegramSecretLifecycleState } from "./assistant-secret-refs-lifecycle";

type SurfaceSeed = {
  provider: OpenClawProviderKey;
  surfaceType: OpenClawSurfaceType;
  allowFromCapabilities: (caps: EffectiveCapabilityState) => boolean;
  interactionMode: "chat" | "notification";
  inboundUserMessages: boolean;
  outboundAssistantMessages: boolean;
  routingKey: string;
};

const SURFACE_SEEDS: SurfaceSeed[] = [
  {
    provider: "web_internal",
    surfaceType: "web_chat",
    allowFromCapabilities: (caps) => caps.channelsAndSurfaces.webChat,
    interactionMode: "chat",
    inboundUserMessages: true,
    outboundAssistantMessages: true,
    routingKey: "web.chat"
  },
  {
    provider: "telegram",
    surfaceType: "telegram_bot",
    allowFromCapabilities: (caps) => caps.channelsAndSurfaces.telegram,
    interactionMode: "chat",
    inboundUserMessages: true,
    outboundAssistantMessages: true,
    routingKey: "telegram.bot"
  },
  {
    provider: "whatsapp",
    surfaceType: "whatsapp_business",
    allowFromCapabilities: (caps) => caps.channelsAndSurfaces.whatsapp,
    interactionMode: "chat",
    inboundUserMessages: true,
    outboundAssistantMessages: true,
    routingKey: "whatsapp.business"
  },
  {
    provider: "max",
    surfaceType: "max_bot",
    allowFromCapabilities: (caps) => caps.channelsAndSurfaces.max,
    interactionMode: "chat",
    inboundUserMessages: true,
    outboundAssistantMessages: true,
    routingKey: "max.bot"
  },
  {
    provider: "max",
    surfaceType: "max_mini_app",
    allowFromCapabilities: (caps) => caps.channelsAndSurfaces.max,
    interactionMode: "chat",
    inboundUserMessages: true,
    outboundAssistantMessages: true,
    routingKey: "max.mini_app"
  },
  {
    provider: "system_notifications",
    surfaceType: "system_notification",
    allowFromCapabilities: () => true,
    interactionMode: "notification",
    inboundUserMessages: false,
    outboundAssistantMessages: true,
    routingKey: "system.notification"
  }
];

const PROVIDERS: OpenClawProviderKey[] = [
  "web_internal",
  "telegram",
  "whatsapp",
  "max",
  "system_notifications"
];

@Injectable()
export class ResolveOpenClawChannelSurfaceBindingsService {
  constructor(
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository
  ) {}

  async execute(params: {
    assistantId: string;
    effectiveCapabilities: EffectiveCapabilityState;
  }): Promise<OpenClawChannelSurfaceBindingsState> {
    const { assistantId, effectiveCapabilities } = params;

    const [telegramConfiguredRaw, whatsappConfigured, maxConfigured] = await Promise.all([
      this.assistantChannelSurfaceBindingRepository.hasActiveBindingForProvider(
        assistantId,
        "telegram"
      ),
      this.assistantChannelSurfaceBindingRepository.hasActiveBindingForProvider(
        assistantId,
        "whatsapp"
      ),
      this.assistantChannelSurfaceBindingRepository.hasActiveBindingForProvider(assistantId, "max")
    ]);
    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistantId);
    const telegramSecretLifecycle = resolveTelegramSecretLifecycleState(
      governance?.secretRefs ?? null,
      {
        legacyFallbackWhenMissing: telegramConfiguredRaw
      }
    );
    const telegramSecretUsable =
      telegramSecretLifecycle.status === "active" ||
      telegramSecretLifecycle.status === "legacy_unmanaged";
    const telegramConfigured = telegramConfiguredRaw && telegramSecretUsable;

    const providerConfigured: Record<OpenClawProviderKey, boolean> = {
      web_internal: true,
      telegram: telegramConfigured,
      whatsapp: whatsappConfigured,
      max: maxConfigured,
      system_notifications: true
    };

    const providers: OpenClawChannelSurfaceBindingsState["providers"] = PROVIDERS.map(
      (provider) => {
        const configured = providerConfigured[provider];
        const providerSurfaceSeeds = SURFACE_SEEDS.filter((seed) => seed.provider === provider);
        const surfaces = providerSurfaceSeeds.map((seed) => {
          const capabilityAllowed = seed.allowFromCapabilities(effectiveCapabilities);
          const allowed = capabilityAllowed && configured;
          const state: OpenClawBindingState = capabilityAllowed
            ? configured
              ? "active"
              : "unconfigured"
            : "inactive";
          const denyReason: "capability_denied" | "provider_unconfigured" | null = allowed
            ? null
            : capabilityAllowed
              ? "provider_unconfigured"
              : "capability_denied";
          return {
            surfaceType: seed.surfaceType,
            allowed,
            state,
            denyReason,
            policy: {
              interactionMode: seed.interactionMode,
              inboundUserMessages: seed.inboundUserMessages,
              outboundAssistantMessages: seed.outboundAssistantMessages
            },
            config: {
              routingKey: seed.routingKey
            }
          };
        });

        const providerCapabilityAllowed = providerSurfaceSeeds.some((seed) =>
          seed.allowFromCapabilities(effectiveCapabilities)
        );
        const providerAllowed = surfaces.some((surface) => surface.allowed);
        return {
          provider,
          assistantBinding: {
            assistantId,
            bound: providerAllowed,
            state: providerCapabilityAllowed ? (configured ? "active" : "unconfigured") : "inactive"
          },
          policy: {
            inboundUserMessages: surfaces.some((surface) => surface.policy.inboundUserMessages),
            outboundAssistantMessages: surfaces.some(
              (surface) => surface.policy.outboundAssistantMessages
            ),
            supportsInteractiveChat: surfaces.some(
              (surface) => surface.policy.interactionMode === "chat"
            )
          },
          config: {
            mode:
              provider === "web_internal"
                ? "native"
                : provider === "system_notifications"
                  ? "system"
                  : provider === "telegram"
                    ? "token_secret"
                    : "provider_api",
            configRef:
              provider === "telegram"
                ? "secret_refs.telegram_bot_token"
                : provider === "whatsapp"
                  ? "secret_refs.whatsapp_business"
                  : provider === "max"
                    ? "secret_refs.max_provider"
                    : null
          },
          surfaces
        };
      }
    );

    const deniedSurfaceTypes = providers
      .flatMap((provider) => provider.surfaces)
      .filter((surface) => !surface.allowed)
      .map((surface) => surface.surfaceType);
    const declaredSurfaceTypes = providers
      .flatMap((provider) => provider.surfaces)
      .map((surface) => surface.surfaceType);

    return {
      schema: "persai.openclawChannelSurfaceBindings.v1",
      derivedFrom: {
        effectiveCapabilitiesSchema: effectiveCapabilities.schema ?? null,
        planCode: effectiveCapabilities.derivedFrom.planCode
      },
      providers,
      suppression: {
        suppressUnavailableSurfaces: true,
        deniedSurfaceTypes,
        declaredSurfaceTypes
      }
    };
  }
}
