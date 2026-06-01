import { createHash } from "node:crypto";
import {
  PERSAI_RUNTIME_CONTRACT_SCHEMA,
  type RuntimeVideoModelParameters,
  type RuntimeAssistantVoiceProfile,
  type RuntimeBrowserConfig,
  type RuntimeContextHydrationConfig,
  type RuntimeKnowledgeAccessConfig,
  type RuntimeSandboxPolicy,
  type RuntimeSharedCompactionConfig,
  type RuntimeToolBudgetsConfig,
  type RuntimeToolPolicy,
  type RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";

export const PERSAI_RUNTIME_BUNDLE_SCHEMA = "persai.runtime.bundle.v1" as const;

export interface AssistantRuntimeBundleMetadata {
  assistantId: string;
  workspaceId: string;
  publishedVersionId: string;
  publishedVersion: number;
  algorithmVersion: number;
  configGeneration: number;
}

export interface AssistantRuntimeBundlePersona {
  displayName: string | null;
  instructions: string | null;
  traits: Record<string, number> | null;
  avatarEmoji: string | null;
  avatarUrl: string | null;
  assistantGender: string | null;
  voiceProfile: RuntimeAssistantVoiceProfile;
}

export interface AssistantRuntimeBundleUserContext {
  displayName: string | null;
  birthday: string | null;
  gender: string | null;
  locale: string;
  timezone: string;
}

export interface AssistantRuntimeEnabledSkillSummary {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
  iconEmoji?: string | null;
  routingExamples?: string[];
}

export interface AssistantRuntimeBundleSecretRef {
  source: string;
  provider: string;
  id: string;
}

export interface AssistantRuntimeBundleToolCredentialRef {
  refKey: string;
  secretRef: AssistantRuntimeBundleSecretRef;
  configured: boolean;
  providerId?: string;
  modelKey?: string;
  videoModelParameters?: RuntimeVideoModelParameters | null;
  fallbacks?: AssistantRuntimeBundleToolCredentialRef[];
}

export type AssistantRuntimeBundleToolPolicy = RuntimeToolPolicy;

export interface AssistantRuntimeBundleQuota {
  planCode: string | null;
  workspaceQuotaBytes: number;
  quotaHook: unknown;
}

export interface AssistantRuntimeBundleRuntimeConfig {
  runtimeAssignment: unknown;
  runtimeProviderProfile: unknown;
  runtimeProviderRouting: unknown;
  routingFastModelKey?: string | null;
  routerPolicy?: unknown;
  contextHydration: RuntimeContextHydrationConfig;
  sharedCompaction: RuntimeSharedCompactionConfig;
  knowledgeAccess: RuntimeKnowledgeAccessConfig;
  workerTools: RuntimeWorkerToolsConfig;
  browser: RuntimeBrowserConfig;
  sandbox?: RuntimeSandboxPolicy;
  /**
   * ADR-074 Slice L1 — per-assistant tool-loop budget overrides. Optional;
   * the runtime falls back to `TOOL_LOOP_LIMIT_BY_MODE` code defaults when
   * absent or when a leaf is `null`. Per-tool hard caps live on each
   * `RuntimeToolPolicy.perTurnCap` so the cap travels with the tool itself.
   */
  toolBudgets?: RuntimeToolBudgetsConfig | null;
}

export interface AssistantRuntimeBundleGovernance {
  capabilityEnvelope: unknown;
  secretRefs: unknown;
  policyEnvelope: unknown;
  effectiveCapabilities: unknown;
  toolAvailability: unknown;
  memoryControl: unknown;
  tasksControl: unknown;
  toolCredentialRefs: Record<string, AssistantRuntimeBundleToolCredentialRef>;
  documentProviderConfig?: {
    pdfmonkeyTemplateId: string | null;
  };
  toolPolicies: AssistantRuntimeBundleToolPolicy[];
  quota: AssistantRuntimeBundleQuota;
  auditHook: unknown;
}

export interface AssistantRuntimeBundleTelegramChannel {
  enabled: boolean;
  autoCompactionEnabled: boolean;
  dmPolicy: string;
  groupReplyMode: string;
  parseMode: string;
  inbound: boolean;
  outbound: boolean;
  accessMode: string;
  ownerClaimStatus: string;
  ownerClaimCode: string | null;
  ownerClaimCodeExpiresAt: string | null;
  ownerTelegramUserId: number | null;
  ownerTelegramUsername: string | null;
  ownerTelegramChatId: string | null;
}

export interface AssistantRuntimePromptDocuments {
  soul: string;
  user: string;
  identity: string;
  enabledSkills?: string;
  tools: string;
  agents: string;
  heartbeat: string;
  /**
   * ADR-074 Slice T1: presence is a NEW per-turn developer-tail block (sibling
   * of `heartbeat`). The compiled text is the raw template string with the
   * four `{{...}}` placeholders unresolved; the runtime presence renderer
   * interpolates them at turn-construction time and inserts the result into
   * `developerInstructions` between `routingGuidance` and `heartbeat`.
   *
   * Optional on the wire so legacy bundle JSON without `presence` (compiled
   * before T1 landed, or by a fallback synthesizer) keeps deserializing; the
   * runtime renderer treats absence as "skip block".
   */
  presence?: string;
  routerClassifier?: string;
  skillStateClassifier?: string;
  preview: string;
  welcome: string;
  bootstrap?: string;
}

export interface AssistantRuntimeCompiledOrdinaryPromptSections {
  assistantIdentity: string | null;
  userIdentity: string | null;
  locale: string;
  timezone: string;
  personaInstructions: string | null;
  soul: string;
  user: string;
  identity: string;
  enabledSkills: string;
  tools: string;
  agents: string;
  heartbeat: string;
}

export interface AssistantRuntimePromptStablePrefix {
  text: string | null;
  hash: string | null;
}

export interface AssistantRuntimePromptConstructor {
  ordinary: {
    sections: AssistantRuntimeCompiledOrdinaryPromptSections;
    systemPrompt: string | null;
    stablePrefix?: AssistantRuntimePromptStablePrefix;
  };
  onboarding: {
    previewTurnPrompt: string;
    welcomeTurnPrompt: string;
    firstTurnPrompt?: string;
  };
}

export interface AssistantRuntimeBundleChannels {
  bindings: unknown;
  telegram: AssistantRuntimeBundleTelegramChannel;
}

export interface AssistantRuntimeBundleSkills {
  enabled: AssistantRuntimeEnabledSkillSummary[];
}

export interface AssistantRuntimeBundle {
  schema: typeof PERSAI_RUNTIME_BUNDLE_SCHEMA;
  contractSchema: typeof PERSAI_RUNTIME_CONTRACT_SCHEMA;
  metadata: AssistantRuntimeBundleMetadata;
  persona: AssistantRuntimeBundlePersona;
  userContext: AssistantRuntimeBundleUserContext;
  runtime: AssistantRuntimeBundleRuntimeConfig;
  governance: AssistantRuntimeBundleGovernance;
  channels: AssistantRuntimeBundleChannels;
  skills?: AssistantRuntimeBundleSkills;
  promptDocuments: AssistantRuntimePromptDocuments;
  promptConstructor: AssistantRuntimePromptConstructor;
}

export interface CreateAssistantRuntimeBundleInput {
  metadata: AssistantRuntimeBundleMetadata;
  persona: AssistantRuntimeBundlePersona;
  userContext: AssistantRuntimeBundleUserContext;
  runtime: AssistantRuntimeBundleRuntimeConfig;
  governance: AssistantRuntimeBundleGovernance;
  channels: AssistantRuntimeBundleChannels;
  skills?: AssistantRuntimeBundleSkills;
  promptDocuments: AssistantRuntimePromptDocuments;
  promptConstructor?: AssistantRuntimePromptConstructor;
}

export interface AssistantRuntimeBundleArtifact {
  bundle: AssistantRuntimeBundle;
  document: string;
  hash: string;
}

export function buildAssistantRuntimePromptStablePrefix(
  text: string | null | undefined
): AssistantRuntimePromptStablePrefix {
  const normalized = typeof text === "string" && text.trim().length > 0 ? text.trim() : null;
  return {
    text: normalized,
    hash: normalized === null ? null : createHash("sha256").update(normalized).digest("hex")
  };
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }

  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      sorted[key] = sortKeysDeep(nested);
    }
    return sorted;
  }

  return value;
}

export function createAssistantRuntimeBundle(
  input: CreateAssistantRuntimeBundleInput
): AssistantRuntimeBundle {
  const promptConstructor: AssistantRuntimePromptConstructor = input.promptConstructor ?? {
    ordinary: {
      sections: {
        assistantIdentity:
          input.persona.displayName === null
            ? null
            : `Assistant display name: ${input.persona.displayName}`,
        userIdentity:
          input.userContext.displayName === null
            ? null
            : `User display name: ${input.userContext.displayName}`,
        locale: `User locale: ${input.userContext.locale}`,
        timezone: `User timezone: ${input.userContext.timezone}`,
        personaInstructions: input.persona.instructions,
        soul: input.promptDocuments.soul,
        user: input.promptDocuments.user,
        identity: input.promptDocuments.identity,
        enabledSkills: input.promptDocuments.enabledSkills ?? "",
        tools: input.promptDocuments.tools,
        agents: input.promptDocuments.agents,
        heartbeat: input.promptDocuments.heartbeat
      },
      // ADR-074 P1: the fallback synthesizer mirrors the production compile path and intentionally
      // omits `heartbeat` from both `systemPrompt` and `stablePrefix`. Heartbeat is surfaced via
      // `promptDocuments.heartbeat` only and is rendered by the runtime as a per-turn developer
      // message tail so it never invalidates provider prompt caching.
      systemPrompt: [
        input.persona.displayName === null
          ? null
          : `Assistant display name: ${input.persona.displayName}`,
        input.userContext.displayName === null
          ? null
          : `User display name: ${input.userContext.displayName}`,
        `User locale: ${input.userContext.locale}`,
        `User timezone: ${input.userContext.timezone}`,
        input.persona.instructions,
        input.promptDocuments.soul,
        input.promptDocuments.user,
        input.promptDocuments.identity,
        input.promptDocuments.enabledSkills,
        input.promptDocuments.tools,
        input.promptDocuments.agents
      ]
        .filter(
          (section): section is string => typeof section === "string" && section.trim().length > 0
        )
        .join("\n\n"),
      stablePrefix: buildAssistantRuntimePromptStablePrefix(
        [
          input.persona.displayName === null
            ? null
            : `Assistant display name: ${input.persona.displayName}`,
          input.userContext.displayName === null
            ? null
            : `User display name: ${input.userContext.displayName}`,
          `User locale: ${input.userContext.locale}`,
          `User timezone: ${input.userContext.timezone}`,
          input.persona.instructions,
          input.promptDocuments.soul,
          input.promptDocuments.user,
          input.promptDocuments.identity,
          input.promptDocuments.enabledSkills,
          input.promptDocuments.tools,
          input.promptDocuments.agents
        ]
          .filter(
            (section): section is string => typeof section === "string" && section.trim().length > 0
          )
          .join("\n\n")
      )
    },
    onboarding: {
      previewTurnPrompt: input.promptDocuments.preview,
      welcomeTurnPrompt: input.promptDocuments.welcome,
      firstTurnPrompt: input.promptDocuments.welcome
    }
  };
  return {
    schema: PERSAI_RUNTIME_BUNDLE_SCHEMA,
    contractSchema: PERSAI_RUNTIME_CONTRACT_SCHEMA,
    metadata: input.metadata,
    persona: input.persona,
    userContext: input.userContext,
    runtime: input.runtime,
    governance: input.governance,
    channels: input.channels,
    ...(input.skills === undefined ? {} : { skills: input.skills }),
    promptDocuments: {
      ...input.promptDocuments,
      bootstrap: input.promptDocuments.bootstrap ?? input.promptDocuments.welcome
    },
    promptConstructor
  };
}

export function serializeAssistantRuntimeBundle(bundle: AssistantRuntimeBundle): string {
  return JSON.stringify(sortKeysDeep(bundle), null, 2);
}

export function hashAssistantRuntimeBundleDocument(document: string): string {
  return createHash("sha256").update(document).digest("hex");
}

export function compileAssistantRuntimeBundle(
  input: CreateAssistantRuntimeBundleInput
): AssistantRuntimeBundleArtifact {
  const bundle = createAssistantRuntimeBundle(input);
  const document = serializeAssistantRuntimeBundle(bundle);
  return {
    bundle,
    document,
    hash: hashAssistantRuntimeBundleDocument(document)
  };
}
