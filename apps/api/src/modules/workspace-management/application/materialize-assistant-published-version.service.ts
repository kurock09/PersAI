import { createHash, createHmac } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type { AssistantGovernance } from "../domain/assistant-governance.entity";
import { resolveEffectiveMemoryControlFromGovernance } from "../domain/memory-control-resolve";
import { resolveEffectiveTasksControlFromGovernance } from "../domain/tasks-control-resolve";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import type { AssistantMaterializationSourceAction } from "../domain/assistant-materialized-spec.entity";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import {
  BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY,
  type BootstrapDocumentPresetRepository
} from "../domain/bootstrap-document-preset.repository";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import type { Assistant } from "../domain/assistant.entity";
import { ResolveEffectiveCapabilityStateService } from "./resolve-effective-capability-state.service";
import { ResolveEffectiveToolAvailabilityService } from "./resolve-effective-tool-availability.service";
import { ResolveOpenClawChannelSurfaceBindingsService } from "./resolve-openclaw-channel-surface-bindings.service";
import { ResolveOpenClawCapabilityEnvelopeService } from "./resolve-openclaw-capability-envelope.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { ResolveRuntimeProviderRoutingService } from "./resolve-runtime-provider-routing.service";
import { buildPlatformRuntimeProviderProfileState } from "./platform-runtime-provider-settings";
import { resolveRuntimeProviderProfileState } from "./runtime-provider-profile";
import {
  ALL_TOOL_CREDENTIAL_KEYS,
  TOOL_CODE_BY_CREDENTIAL_KEY,
  buildToolCredentialSecretRef
} from "./tool-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const MATERIALIZATION_ALGORITHM_VERSION = 1;
const MATERIALIZATION_SCHEMA = "persai.materialization.v1";
const OPENCLAW_BOOTSTRAP_SCHEMA = "openclaw.bootstrap.v1";
const OPENCLAW_WORKSPACE_SCHEMA = "openclaw.workspace.v1";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, nestedValue] of entries) {
      sorted[key] = sortKeysDeep(nestedValue);
    }
    return sorted;
  }

  return value;
}

function toDeterministicDocument(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

@Injectable()
export class MaterializeAssistantPublishedVersionService {
  private readonly logger = new Logger(MaterializeAssistantPublishedVersionService.name);

  constructor(
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY)
    private readonly bootstrapPresetRepository: BootstrapDocumentPresetRepository,
    private readonly resolveEffectiveCapabilityStateService: ResolveEffectiveCapabilityStateService,
    private readonly resolveEffectiveToolAvailabilityService: ResolveEffectiveToolAvailabilityService,
    private readonly resolveOpenClawChannelSurfaceBindingsService: ResolveOpenClawChannelSurfaceBindingsService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly resolveRuntimeProviderRoutingService: ResolveRuntimeProviderRoutingService,
    private readonly resolveOpenClawCapabilityEnvelopeService: ResolveOpenClawCapabilityEnvelopeService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(
    assistant: Assistant,
    publishedVersion: AssistantPublishedVersion,
    sourceAction: AssistantMaterializationSourceAction
  ): Promise<void> {
    const currentConfigGeneration = await this.bumpConfigGenerationService.current();

    const existingSpec = await this.assistantMaterializedSpecRepository.findByPublishedVersionId(
      publishedVersion.id
    );

    const governance =
      (await this.assistantGovernanceRepository.findByAssistantId(assistant.id)) ??
      (await this.assistantGovernanceRepository.createBaseline(assistant.id));

    const memoryControl = resolveEffectiveMemoryControlFromGovernance(governance);
    const tasksControl = resolveEffectiveTasksControlFromGovernance(governance);
    const effectiveCapabilities = await this.resolveEffectiveCapabilityStateService.execute({
      assistant,
      governance
    });
    const toolAvailability = await this.resolveEffectiveToolAvailabilityService.execute({
      effectiveCapabilities
    });
    const channelSurfaceBindings = await this.resolveOpenClawChannelSurfaceBindingsService.execute({
      assistantId: assistant.id,
      effectiveCapabilities
    });
    const platformRuntimeProviderSettings =
      await this.resolvePlatformRuntimeProviderSettingsService.execute();
    let runtimeProviderProfile =
      platformRuntimeProviderSettings.mode === "global_settings"
        ? buildPlatformRuntimeProviderProfileState(platformRuntimeProviderSettings)
        : resolveRuntimeProviderProfileState({
            policyEnvelope: governance.policyEnvelope,
            secretRefs: governance.secretRefs
          });
    const planPrimaryModelKey = await this.resolvePlanPrimaryModelKey(
      effectiveCapabilities.derivedFrom.planCode
    );
    if (
      planPrimaryModelKey &&
      runtimeProviderProfile.mode === "admin_managed" &&
      runtimeProviderProfile.primary
    ) {
      runtimeProviderProfile = {
        ...runtimeProviderProfile,
        primary: {
          ...runtimeProviderProfile.primary,
          model: planPrimaryModelKey
        }
      };
    }
    const runtimeProviderRouting = this.resolveRuntimeProviderRoutingService.execute({
      effectiveCapabilities,
      policyEnvelope: governance.policyEnvelope,
      runtimeProviderProfile,
      planPrimaryModelKey
    });
    const openclawCapabilityEnvelope = this.resolveOpenClawCapabilityEnvelopeService.execute({
      effectiveCapabilities,
      effectiveToolAvailability: toolAvailability,
      channelSurfaceBindings,
      runtimeProviderRouting
    });

    const layers = {
      schema: MATERIALIZATION_SCHEMA,
      algorithmVersion: MATERIALIZATION_ALGORITHM_VERSION,
      layers: {
        ownership: {
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId
        },
        userOwnedVersion: {
          publishedVersionId: publishedVersion.id,
          publishedVersion: publishedVersion.version,
          snapshot: {
            displayName: publishedVersion.snapshotDisplayName,
            instructions: publishedVersion.snapshotInstructions
          }
        },
        governance: this.toGovernanceLayer(
          governance,
          effectiveCapabilities,
          toolAvailability,
          openclawCapabilityEnvelope,
          runtimeProviderProfile
        ),
        applyState: {
          status: assistant.applyStatus,
          targetPublishedVersionId: assistant.applyTargetVersionId,
          appliedPublishedVersionId: assistant.applyAppliedVersionId
        }
      }
    };

    const toolCredentialRefs = await this.resolveToolCredentialRefs();
    const toolQuotaPolicy = await this.resolveToolQuotaPolicy(governance.quotaPlanCode);
    const telegramChannel = await this.resolveTelegramChannelConfig(assistant.id);

    const openclawBootstrap = {
      schema: OPENCLAW_BOOTSTRAP_SCHEMA,
      assistant: {
        id: assistant.id,
        workspaceId: assistant.workspaceId
      },
      governance: {
        configGeneration: currentConfigGeneration,
        capabilityEnvelope: governance.capabilityEnvelope,
        policyEnvelope: governance.policyEnvelope,
        quota: {
          planCode: governance.quotaPlanCode,
          hook: governance.quotaHook
        },
        effectiveCapabilities,
        toolAvailability,
        openclawCapabilityEnvelope,
        runtimeProviderProfile,
        toolCredentialRefs,
        toolQuotaPolicy,
        secretRefs: governance.secretRefs,
        auditHook: governance.auditHook
      },
      channels: {
        telegram: telegramChannel
      }
    };

    const userContext = await this.resolveUserContext(assistant.userId, assistant.workspaceId);
    const bootstrapDocuments = await this.generateBootstrapDocuments({
      publishedVersion,
      governance,
      toolAvailability,
      toolQuotaPolicy,
      memoryControl,
      tasksControl,
      effectiveCapabilities,
      userContext
    });

    const openclawWorkspace = {
      schema: OPENCLAW_WORKSPACE_SCHEMA,
      workspace: {
        assistantId: assistant.id,
        publishedVersionId: publishedVersion.id,
        publishedVersion: publishedVersion.version
      },
      persona: {
        displayName: publishedVersion.snapshotDisplayName,
        instructions: publishedVersion.snapshotInstructions,
        traits: publishedVersion.snapshotTraits,
        avatarEmoji: publishedVersion.snapshotAvatarEmoji,
        avatarUrl: publishedVersion.snapshotAvatarUrl
      },
      effectiveCapabilities,
      toolAvailability,
      openclawCapabilityEnvelope,
      memoryControl,
      tasksControl,
      userContext,
      bootstrapDocuments
    };

    const layersDocument = toDeterministicDocument(layers);
    const openclawBootstrapDocument = toDeterministicDocument(openclawBootstrap);
    const openclawWorkspaceDocument = toDeterministicDocument(openclawWorkspace);
    const contentHash = createHash("sha256")
      .update(`${layersDocument}\n${openclawBootstrapDocument}\n${openclawWorkspaceDocument}`)
      .digest("hex");

    await this.assistantMaterializedSpecRepository.create({
      assistantId: assistant.id,
      publishedVersionId: publishedVersion.id,
      sourceAction: existingSpec?.sourceAction ?? sourceAction,
      algorithmVersion: MATERIALIZATION_ALGORITHM_VERSION,
      materializedAtConfigGeneration: currentConfigGeneration,
      layers,
      openclawBootstrap,
      openclawWorkspace,
      layersDocument,
      openclawBootstrapDocument,
      openclawWorkspaceDocument,
      contentHash
    });

    await this.prisma.assistant.update({
      where: { id: assistant.id },
      data: { configDirtyAt: null }
    });
  }

  private async resolveToolCredentialRefs(): Promise<
    Record<
      string,
      {
        refKey: string;
        secretRef: { source: string; provider: string; id: string };
        configured: boolean;
      }
    >
  > {
    const keyMetadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys(
      ALL_TOOL_CREDENTIAL_KEYS as unknown as string[]
    );
    const refs: Record<
      string,
      {
        refKey: string;
        secretRef: { source: string; provider: string; id: string };
        configured: boolean;
      }
    > = {};
    for (const credentialKey of ALL_TOOL_CREDENTIAL_KEYS) {
      const toolCode = TOOL_CODE_BY_CREDENTIAL_KEY[credentialKey];
      const secretRef = buildToolCredentialSecretRef(credentialKey);
      refs[toolCode] = {
        ...secretRef,
        configured: keyMetadata[credentialKey]?.configured ?? false
      };
    }
    return refs;
  }

  private async resolvePlanPrimaryModelKey(planCode: string | null): Promise<string | null> {
    if (planCode === null) {
      return null;
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    if (plan === null) {
      return null;
    }
    const hints = plan.billingProviderHints;
    if (hints === null || typeof hints !== "object" || Array.isArray(hints)) {
      return null;
    }
    const record = hints as Record<string, unknown>;
    return typeof record.primaryModelKey === "string" && record.primaryModelKey.trim().length > 0
      ? record.primaryModelKey.trim()
      : null;
  }

  private async resolveToolQuotaPolicy(
    planCode: string | null
  ): Promise<Array<{ toolCode: string; dailyCallLimit: number | null; activationStatus: string }>> {
    if (planCode === null) {
      return [];
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { id: true }
    });
    if (plan === null) {
      return [];
    }
    const activations = await this.prisma.planCatalogToolActivation.findMany({
      where: { planId: plan.id },
      select: {
        activationStatus: true,
        dailyCallLimit: true,
        tool: {
          select: { code: true }
        }
      }
    });
    return activations.map((activation) => ({
      toolCode: activation.tool.code,
      dailyCallLimit: activation.dailyCallLimit,
      activationStatus: activation.activationStatus
    }));
  }

  private async resolveUserContext(
    userId: string,
    workspaceId: string
  ): Promise<{
    displayName: string | null;
    birthday: string | null;
    gender: string | null;
    locale: string;
    timezone: string;
  }> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { displayName: true, birthday: true, gender: true }
    });
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { locale: true, timezone: true }
    });
    return {
      displayName: user?.displayName ?? null,
      birthday: user?.birthday ? user.birthday.toISOString().split("T")[0]! : null,
      gender: user?.gender ?? null,
      locale: workspace?.locale ?? "en",
      timezone: workspace?.timezone ?? "UTC"
    };
  }

  private async generateBootstrapDocuments(ctx: {
    publishedVersion: AssistantPublishedVersion;
    governance: AssistantGovernance;
    toolAvailability: Record<string, unknown>;
    toolQuotaPolicy: Array<{
      toolCode: string;
      dailyCallLimit: number | null;
      activationStatus: string;
    }>;
    memoryControl: unknown;
    tasksControl: unknown;
    effectiveCapabilities: Record<string, unknown>;
    userContext: {
      displayName: string | null;
      birthday: string | null;
      gender: string | null;
      locale: string;
      timezone: string;
    };
  }): Promise<Record<string, string>> {
    const templates = await this.loadPresetTemplates();

    return {
      soulDocument: this.generateSoulMd(ctx.publishedVersion, templates.soul ?? null),
      userDocument: this.generateUserMd(ctx.userContext, templates.user ?? null),
      identityDocument: this.generateIdentityMd(ctx.publishedVersion, templates.identity ?? null),
      toolsDocument: this.generateToolsMd(ctx.toolQuotaPolicy),
      agentsDocument: this.generateAgentsMd(ctx, templates.agents ?? null),
      heartbeatDocument: this.generateHeartbeatMd(ctx.tasksControl),
      bootstrapDocument: this.generateBootstrapMd(ctx.publishedVersion, ctx.userContext)
    };
  }

  private async loadPresetTemplates(): Promise<Record<string, string | null>> {
    try {
      const presets = await this.bootstrapPresetRepository.findAll();
      const map: Record<string, string | null> = {
        soul: null,
        user: null,
        identity: null,
        agents: null
      };
      for (const p of presets) {
        map[p.id] = p.template;
      }
      return map;
    } catch (err) {
      this.logger.warn("Failed to load bootstrap presets from DB, using hardcoded fallbacks", err);
      return { soul: null, user: null, identity: null, agents: null };
    }
  }

  private interpolateTemplate(
    template: string,
    variables: Record<string, string | null | undefined>
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      if (value === null || value === undefined || value.trim().length === 0) {
        result = result
          .split("\n")
          .filter((line) => !line.includes(placeholder))
          .join("\n");
      } else {
        result = result.replaceAll(placeholder, value);
      }
    }
    return result;
  }

  private generateSoulMd(pv: AssistantPublishedVersion, template: string | null): string {
    const traitsBlock = this.renderTraitsBlock(pv.snapshotTraits);
    const instructionsBlock = pv.snapshotInstructions
      ? `## Instructions\n\n${pv.snapshotInstructions}\n`
      : "";

    if (template) {
      return this.interpolateTemplate(template, {
        assistant_name: pv.snapshotDisplayName ?? "an assistant",
        traits_block: traitsBlock,
        instructions_block: instructionsBlock
      });
    }

    const lines: string[] = ["# SOUL.md", ""];
    lines.push(`You are **${pv.snapshotDisplayName ?? "an assistant"}**.`);
    lines.push("");
    if (traitsBlock) {
      lines.push(traitsBlock);
      lines.push("");
    }
    if (instructionsBlock) {
      lines.push(instructionsBlock);
      lines.push("");
    }
    return lines.join("\n");
  }

  private renderTraitsBlock(traits: Record<string, number> | null): string {
    if (!traits || Object.keys(traits).length === 0) return "";
    const lines = ["## Personality Traits", ""];
    for (const [trait, value] of Object.entries(traits)) {
      const label = this.traitLabel(trait, value);
      lines.push(`- **${trait}**: ${String(value)}/100 — ${label}`);
    }
    return lines.join("\n");
  }

  private traitLabel(trait: string, value: number): string {
    const low = value < 35;
    const high = value > 65;
    const labels: Record<string, [string, string, string]> = {
      formality: ["very casual", "balanced", "very formal"],
      verbosity: ["concise and brief", "balanced detail", "detailed and thorough"],
      playfulness: ["serious and focused", "balanced tone", "playful and fun"],
      initiative: ["waits for instructions", "balanced initiative", "highly proactive"],
      warmth: ["neutral and professional", "friendly", "warm and caring"]
    };
    const entry = labels[trait];
    if (!entry) return `${String(value)}/100`;
    return low ? entry[0] : high ? entry[2] : entry[1];
  }

  private generateUserMd(
    userCtx: {
      displayName: string | null;
      birthday: string | null;
      gender: string | null;
      locale: string;
      timezone: string;
    },
    template: string | null
  ): string {
    if (template) {
      return this.interpolateTemplate(template, {
        user_name_line: userCtx.displayName ? `- **Name**: ${userCtx.displayName}` : null,
        user_birthday_line: userCtx.birthday ? `- **Birthday**: ${userCtx.birthday}` : null,
        user_gender_line: userCtx.gender ? `- **Gender**: ${userCtx.gender}` : null,
        user_locale: userCtx.locale,
        user_timezone: userCtx.timezone
      });
    }

    const lines: string[] = ["# USER.md — About Your Human", ""];
    if (userCtx.displayName) lines.push(`- **Name**: ${userCtx.displayName}`);
    if (userCtx.birthday) lines.push(`- **Birthday**: ${userCtx.birthday}`);
    if (userCtx.gender) lines.push(`- **Gender**: ${userCtx.gender}`);
    lines.push(`- **Locale**: ${userCtx.locale}`);
    lines.push(`- **Timezone**: ${userCtx.timezone}`);
    lines.push("");
    lines.push("Use this information to personalize your communication.");
    lines.push("Greet on birthdays. Respect timezone for scheduling.");
    lines.push("");
    return lines.join("\n");
  }

  private generateIdentityMd(pv: AssistantPublishedVersion, template: string | null): string {
    if (template) {
      return this.interpolateTemplate(template, {
        assistant_name: pv.snapshotDisplayName ?? "Assistant",
        assistant_avatar_emoji_line: pv.snapshotAvatarEmoji
          ? `- **Avatar**: ${pv.snapshotAvatarEmoji}`
          : null,
        assistant_avatar_url_line: pv.snapshotAvatarUrl
          ? `- **Avatar URL**: ${pv.snapshotAvatarUrl}`
          : null
      });
    }

    const lines: string[] = ["# IDENTITY.md", ""];
    lines.push(`- **Name**: ${pv.snapshotDisplayName ?? "Assistant"}`);
    if (pv.snapshotAvatarEmoji) lines.push(`- **Avatar**: ${pv.snapshotAvatarEmoji}`);
    if (pv.snapshotAvatarUrl) lines.push(`- **Avatar URL**: ${pv.snapshotAvatarUrl}`);
    lines.push("");
    return lines.join("\n");
  }

  private generateToolsMd(
    toolQuotaPolicy: Array<{
      toolCode: string;
      dailyCallLimit: number | null;
      activationStatus: string;
    }>
  ): string {
    const lines: string[] = ["# TOOLS.md — Your Available Tools"];
    lines.push("");

    const active = toolQuotaPolicy.filter((t) => t.activationStatus === "active");
    const inactive = toolQuotaPolicy.filter((t) => t.activationStatus !== "active");

    if (active.length > 0) {
      lines.push("## Active Tools");
      lines.push("");
      for (const tool of active) {
        const limit =
          tool.dailyCallLimit !== null ? ` (daily limit: ${String(tool.dailyCallLimit)})` : "";
        lines.push(`- **${tool.toolCode}**${limit}`);
      }
      lines.push("");
    }

    if (inactive.length > 0) {
      lines.push("## Disabled Tools");
      lines.push("");
      for (const tool of inactive) {
        lines.push(`- ~~${tool.toolCode}~~ — not available on current plan`);
      }
      lines.push("");
    }

    if (toolQuotaPolicy.length === 0) {
      lines.push("No tools configured yet.");
      lines.push("");
    }

    return lines.join("\n");
  }

  private generateAgentsMd(
    ctx: {
      governance: AssistantGovernance;
      effectiveCapabilities: Record<string, unknown>;
      memoryControl: unknown;
      tasksControl: unknown;
    },
    template: string | null
  ): string {
    const mc = ctx.memoryControl as Record<string, unknown> | null;
    const tc = ctx.tasksControl as Record<string, unknown> | null;

    const memoryPolicyBlock = mc
      ? "## Memory Policy\n\n- Remember important facts about your human from conversations\n- Update MEMORY.md with key information you learn\n- Daily conversation notes go in memory/ directory\n"
      : "";

    const tasksPolicyBlock = tc
      ? "## Tasks Policy\n\n- You may manage reminders and recurring tasks for your human\n- Track tasks in HEARTBEAT.md\n"
      : "";

    if (template) {
      return this.interpolateTemplate(template, {
        memory_policy_block: memoryPolicyBlock,
        tasks_policy_block: tasksPolicyBlock
      });
    }

    const lines: string[] = ["# AGENTS.md — Governance & Capabilities", ""];
    if (memoryPolicyBlock) {
      lines.push(memoryPolicyBlock);
      lines.push("");
    }
    if (tasksPolicyBlock) {
      lines.push(tasksPolicyBlock);
      lines.push("");
    }
    return lines.join("\n");
  }

  private generateHeartbeatMd(tasksControl: unknown): string {
    const tc = tasksControl as Record<string, unknown> | null;
    if (!tc) {
      return "# HEARTBEAT.md\n\nNo tasks configured.\n";
    }
    return "# HEARTBEAT.md\n\nCheck in periodically. Review pending tasks and reminders.\n";
  }

  private generateBootstrapMd(
    pv: AssistantPublishedVersion,
    userCtx: { displayName: string | null }
  ): string {
    const assistantName = pv.snapshotDisplayName ?? "Assistant";
    const humanName = userCtx.displayName ?? "your human";
    const traits = pv.snapshotTraits;

    const lines: string[] = ["# BOOTSTRAP.md — Hello, World"];
    lines.push("");
    lines.push("You just came online for the first time!");
    lines.push("");
    lines.push(`Your name is **${assistantName}**. Your human's name is **${humanName}**.`);

    if (traits && Object.keys(traits).length > 0) {
      const traitDesc = Object.entries(traits)
        .map(([t, v]) => `${t}: ${String(v)}/100`)
        .join(", ");
      lines.push(`They set your personality to: ${traitDesc}.`);
    }

    lines.push("");
    lines.push("Introduce yourself naturally. Don't interrogate — just talk.");
    lines.push("");
    lines.push("After your first conversation:");
    lines.push("- Update SOUL.md with what you learned about yourself");
    lines.push("- Update USER.md with what you learned about your human");
    lines.push("- Then delete this file — you won't need it again.");
    lines.push("");

    return lines.join("\n");
  }

  private async resolveTelegramChannelConfig(assistantId: string): Promise<{
    enabled: boolean;
    botToken: string | null;
    webhookUrl: string | null;
    webhookSecret: string | null;
    dmPolicy: string;
    groupReplyMode: string;
    parseMode: string;
    inbound: boolean;
    outbound: boolean;
  }> {
    const binding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
      where: {
        assistantId,
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        bindingState: "active"
      }
    });
    if (!binding) {
      return {
        enabled: false,
        botToken: null,
        webhookUrl: null,
        webhookSecret: null,
        dmPolicy: "open",
        groupReplyMode: "mention_reply",
        parseMode: "plain_text",
        inbound: false,
        outbound: false
      };
    }

    const botToken = await this.platformRuntimeProviderSecretStoreService
      .resolveSecretValueByProviderKey(`telegram_bot:${assistantId}`)
      .catch(() => null);

    const config = loadApiConfig(process.env);
    const baseUrl = config.TELEGRAM_WEBHOOK_BASE_URL ?? null;
    const hmacSecret = config.TELEGRAM_WEBHOOK_HMAC_SECRET ?? null;

    let webhookUrl: string | null = null;
    let webhookSecret: string | null = null;
    if (baseUrl && hmacSecret) {
      webhookUrl = `${baseUrl}/telegram-webhook/${assistantId}`;
      webhookSecret = createHmac("sha256", hmacSecret)
        .update(assistantId)
        .digest("hex")
        .slice(0, 64);
    }

    const bindingConfig =
      binding.config && typeof binding.config === "object" && !Array.isArray(binding.config)
        ? (binding.config as Record<string, unknown>)
        : {};
    const bindingPolicy =
      binding.policy && typeof binding.policy === "object" && !Array.isArray(binding.policy)
        ? (binding.policy as Record<string, unknown>)
        : {};

    return {
      enabled: botToken !== null,
      botToken,
      webhookUrl,
      webhookSecret,
      dmPolicy: "open",
      groupReplyMode:
        typeof bindingConfig.groupReplyMode === "string"
          ? bindingConfig.groupReplyMode
          : "mention_reply",
      parseMode:
        typeof bindingConfig.defaultParseMode === "string"
          ? bindingConfig.defaultParseMode
          : "plain_text",
      inbound: bindingPolicy.inboundUserMessages !== false,
      outbound: bindingPolicy.outboundAssistantMessages !== false
    };
  }

  private toGovernanceLayer(
    governance: AssistantGovernance,
    effectiveCapabilities: Record<string, unknown>,
    toolAvailability: Record<string, unknown>,
    openclawCapabilityEnvelope: Record<string, unknown>,
    runtimeProviderProfile: unknown
  ): Record<string, unknown> {
    return {
      capabilityEnvelope: governance.capabilityEnvelope,
      secretRefs: governance.secretRefs,
      policyEnvelope: governance.policyEnvelope,
      runtimeProviderProfile,
      effectiveCapabilities,
      toolAvailability,
      openclawCapabilityEnvelope,
      memoryControl: governance.memoryControl,
      tasksControl: governance.tasksControl,
      quota: {
        planCode: governance.quotaPlanCode,
        hook: governance.quotaHook
      },
      auditHook: governance.auditHook
    };
  }
}
