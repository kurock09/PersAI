import { Inject, Injectable } from "@nestjs/common";
import type { AssistantGovernance } from "../domain/assistant-governance.entity";
import type { Assistant } from "../domain/assistant.entity";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import type { EffectiveCapabilityState } from "./effective-capability.types";

type GovernanceCapabilityEnvelope = {
  schema?: string;
  toolClasses?: Record<string, unknown>;
  channelsAndSurfaces?: Record<string, unknown>;
  mediaClasses?: Record<string, unknown>;
  governedFeatures?: Record<string, unknown>;
  deny?: {
    toolClasses?: string[];
    channelsAndSurfaces?: string[];
    mediaClasses?: string[];
    governedFeatures?: string[];
  };
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asGovernanceEnvelope(value: unknown): GovernanceCapabilityEnvelope | null {
  const objectValue = asObject(value);
  if (objectValue === null) {
    return null;
  }
  return objectValue as GovernanceCapabilityEnvelope;
}

function hasAllowed(items: unknown[], key: string): boolean {
  return items.some((item) => {
    const row = asObject(item);
    return row?.key === key && row.allowed === true;
  });
}

function hasQuotaGoverned(items: unknown[], key: string): boolean {
  return items.some((item) => {
    const row = asObject(item);
    return row?.key === key && row.quotaGoverned === true;
  });
}

function hasValue(items: unknown[], key: string): boolean {
  return items.some((item) => {
    const row = asObject(item);
    return row?.key === key && row.value === true;
  });
}

function asDenyList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function toGovernanceFlag(
  envelope: GovernanceCapabilityEnvelope | null,
  section: keyof Pick<
    GovernanceCapabilityEnvelope,
    "toolClasses" | "channelsAndSurfaces" | "mediaClasses" | "governedFeatures"
  >,
  key: string
): boolean | null {
  const sectionObject = asObject(envelope?.[section] ?? null);
  if (sectionObject === null) {
    return null;
  }
  const value = sectionObject[key];
  return typeof value === "boolean" ? value : null;
}

function shouldDeny(
  envelope: GovernanceCapabilityEnvelope | null,
  section: keyof NonNullable<GovernanceCapabilityEnvelope["deny"]>,
  key: string
): boolean {
  const deny = asObject(envelope?.deny ?? null);
  return asDenyList(deny?.[section]).includes(key);
}

function applyGovernance(
  planAllowed: boolean,
  envelope: GovernanceCapabilityEnvelope | null,
  section:
    | "toolClasses"
    | "channelsAndSurfaces"
    | "mediaClasses"
    | "governedFeatures",
  key: string
): boolean {
  if (shouldDeny(envelope, section, key)) {
    return false;
  }
  const override = toGovernanceFlag(envelope, section, key);
  if (override === false) {
    return false;
  }
  if (override === true) {
    return planAllowed;
  }
  return planAllowed;
}

@Injectable()
export class ResolveEffectiveCapabilityStateService {
  constructor(
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly planCatalogRepository: AssistantPlanCatalogRepository
  ) {}

  async execute(params: {
    assistant: Assistant;
    governance: AssistantGovernance;
  }): Promise<EffectiveCapabilityState> {
    const subscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: params.assistant.userId,
      workspaceId: params.assistant.workspaceId,
      assistantId: params.assistant.id,
      assistantQuotaPlanCode: params.governance.quotaPlanCode
    });

    const plan =
      subscription.planCode === null
        ? null
        : await this.planCatalogRepository.findByCode(subscription.planCode);

    const entitlements = plan?.entitlementModel;
    const capabilities = entitlements?.capabilities ?? [];
    const toolClasses = entitlements?.toolClasses ?? [];
    const channels = entitlements?.channelsAndSurfaces ?? [];
    const limits = entitlements?.limitsPermissions ?? [];

    const governanceEnvelope = asGovernanceEnvelope(params.governance.capabilityEnvelope);

    const channelWebChat = applyGovernance(
      hasAllowed(channels, "web_chat"),
      governanceEnvelope,
      "channelsAndSurfaces",
      "web_chat"
    );
    const channelTelegram = applyGovernance(
      hasAllowed(channels, "telegram"),
      governanceEnvelope,
      "channelsAndSurfaces",
      "telegram"
    );
    const channelWhatsapp = applyGovernance(
      hasAllowed(channels, "whatsapp"),
      governanceEnvelope,
      "channelsAndSurfaces",
      "whatsapp"
    );
    const channelMax = applyGovernance(
      hasAllowed(channels, "max"),
      governanceEnvelope,
      "channelsAndSurfaces",
      "max"
    );

    const textMediaBaseline = channelWebChat || channelTelegram || channelWhatsapp || channelMax;

    return {
      schema: "persai.effectiveCapabilities.v1",
      derivedFrom: {
        planCode: plan?.code ?? subscription.planCode,
        planStatus: plan?.status ?? null,
        governanceSchema:
          typeof governanceEnvelope?.schema === "string" ? governanceEnvelope.schema : null
      },
      subscription,
      toolClasses: {
        costDriving: {
          allowed: applyGovernance(
            hasAllowed(toolClasses, "cost_driving"),
            governanceEnvelope,
            "toolClasses",
            "cost_driving"
          ),
          quotaGoverned: hasQuotaGoverned(toolClasses, "cost_driving")
        },
        utility: {
          allowed: applyGovernance(
            hasAllowed(toolClasses, "utility"),
            governanceEnvelope,
            "toolClasses",
            "utility"
          ),
          quotaGoverned: hasQuotaGoverned(toolClasses, "utility")
        }
      },
      channelsAndSurfaces: {
        webChat: channelWebChat,
        telegram: channelTelegram,
        whatsapp: channelWhatsapp,
        max: channelMax
      },
      mediaClasses: {
        text: applyGovernance(textMediaBaseline, governanceEnvelope, "mediaClasses", "text"),
        image: applyGovernance(false, governanceEnvelope, "mediaClasses", "image"),
        audio: applyGovernance(false, governanceEnvelope, "mediaClasses", "audio"),
        video: applyGovernance(false, governanceEnvelope, "mediaClasses", "video"),
        file: applyGovernance(false, governanceEnvelope, "mediaClasses", "file")
      },
      governedFeatures: {
        assistantLifecycle: applyGovernance(
          hasAllowed(capabilities, "assistant.lifecycle.publish_apply_rollback_reset"),
          governanceEnvelope,
          "governedFeatures",
          "assistant_lifecycle"
        ),
        memoryCenter: applyGovernance(
          hasAllowed(capabilities, "assistant.memory.center"),
          governanceEnvelope,
          "governedFeatures",
          "memory_center"
        ),
        tasksCenter: applyGovernance(
          hasAllowed(capabilities, "assistant.tasks.center"),
          governanceEnvelope,
          "governedFeatures",
          "tasks_center"
        ),
        viewLimitPercentages: applyGovernance(
          hasAllowed(limits, "view_limit_percentages"),
          governanceEnvelope,
          "governedFeatures",
          "view_limit_percentages"
        ),
        tasksExcludedFromCommercialQuotas: applyGovernance(
          hasValue(limits, "tasks_excluded_from_commercial_quotas"),
          governanceEnvelope,
          "governedFeatures",
          "tasks_excluded_from_commercial_quotas"
        )
      }
    };
  }
}
