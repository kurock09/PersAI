import { createHash } from "node:crypto";
import {
  PERSAI_RUNTIME_CONTRACT_SCHEMA,
  type RuntimeAssistantVoiceProfile,
  type RuntimeBrowserConfig,
  type RuntimeKnowledgeAccessConfig,
  type RuntimeSharedCompactionConfig,
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
  optimizationPolicy: unknown;
  sharedCompaction: RuntimeSharedCompactionConfig;
  knowledgeAccess: RuntimeKnowledgeAccessConfig;
  workerTools: RuntimeWorkerToolsConfig;
  browser: RuntimeBrowserConfig;
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
  tools: string;
  agents: string;
  heartbeat: string;
  bootstrap: string;
}

export interface AssistantRuntimeBundleChannels {
  bindings: unknown;
  telegram: AssistantRuntimeBundleTelegramChannel;
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
  promptDocuments: AssistantRuntimePromptDocuments;
}

export interface CreateAssistantRuntimeBundleInput {
  metadata: AssistantRuntimeBundleMetadata;
  persona: AssistantRuntimeBundlePersona;
  userContext: AssistantRuntimeBundleUserContext;
  runtime: AssistantRuntimeBundleRuntimeConfig;
  governance: AssistantRuntimeBundleGovernance;
  channels: AssistantRuntimeBundleChannels;
  promptDocuments: AssistantRuntimePromptDocuments;
}

export interface AssistantRuntimeBundleArtifact {
  bundle: AssistantRuntimeBundle;
  document: string;
  hash: string;
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
  return {
    schema: PERSAI_RUNTIME_BUNDLE_SCHEMA,
    contractSchema: PERSAI_RUNTIME_CONTRACT_SCHEMA,
    metadata: input.metadata,
    persona: input.persona,
    userContext: input.userContext,
    runtime: input.runtime,
    governance: input.governance,
    channels: input.channels,
    promptDocuments: input.promptDocuments
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
