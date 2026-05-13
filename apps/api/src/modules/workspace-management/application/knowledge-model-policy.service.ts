import { Injectable } from "@nestjs/common";
import { normalizeAdminKnowledgeRetrievalPolicyRecord } from "./admin-knowledge-retrieval-policy";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID } from "./platform-runtime-provider-settings";

/**
 * ADR-094 Step 1 — per-plan knowledge retrieval policy. The five `smart…` /
 * `chatSection…` / `fetchFullMode…` keys below are ADDITIVE against the
 * pre-ADR-094 contract: they describe how much volume a plan is allowed to
 * pull through the smart `knowledge_search` and the flexible `knowledge_fetch`
 * tool. Hard ceilings live in admin-knowledge-retrieval-policy.ts; the
 * effective per-call limit is `min(plan.field, admin.field)`.
 */
export type KnowledgeRetrievalPolicy = {
  defaultMaxResults: number;
  maxMaxResults: number;
  lexicalCandidateLimit: number;
  vectorCandidateLimit: number;
  knowledgeFetchWindowRadius: number;
  chatFetchWindowRadius: number;
  fetchMaxChars: number;
  helperEnabled: boolean;
  helperCandidateLimit: number;
  helperMaxOutputTokens: number;
  embeddingSearchEnabled: boolean;
  /** ADR-094 — documents up to this length are inlined whole by smart search. */
  smartSearchShortDocChars: number;
  /** ADR-094 — documents up to this length are inlined as an extended section. */
  smartSearchMediumDocChars: number;
  /** ADR-094 — default radius (in messages) for chat `mode = "section"` fetch. */
  chatSectionDefaultRadius: number;
  /** ADR-094 — plan cap on chars returned by `knowledge_fetch` with `mode = "full"`. */
  fetchFullModeMaxChars: number;
  /** ADR-094 — plan cap on messages returned by chat `knowledge_fetch` with `mode = "full"`. */
  fetchFullModeMaxChatMessages: number;
};

/**
 * ADR-094 — the default sits at Start-tier shape (1 paid step above Free).
 * Free is now an EXPLICIT override in `billingHints.retrievalPolicy`, not the
 * implicit baseline. This removes the long-standing problem of every plan
 * silently inheriting Free-grade limits because admin never customised them.
 */
export const DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY: KnowledgeRetrievalPolicy = {
  defaultMaxResults: 6,
  maxMaxResults: 10,
  lexicalCandidateLimit: 60,
  vectorCandidateLimit: 240,
  knowledgeFetchWindowRadius: 3,
  chatFetchWindowRadius: 10,
  fetchMaxChars: 8_000,
  helperEnabled: true,
  helperCandidateLimit: 6,
  helperMaxOutputTokens: 220,
  embeddingSearchEnabled: true,
  smartSearchShortDocChars: 2_000,
  smartSearchMediumDocChars: 8_000,
  chatSectionDefaultRadius: 15,
  fetchFullModeMaxChars: 25_000,
  fetchFullModeMaxChatMessages: 150
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNullablePositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

@Injectable()
export class KnowledgeModelPolicyService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService
  ) {}

  async resolveAssistantEmbeddingModelKey(assistantId: string): Promise<string | null> {
    const billingHints = await this.resolveAssistantPlanBillingHints(assistantId);
    const value = billingHints?.embeddingModelKey;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  async resolveAssistantRetrievalModelKey(assistantId: string): Promise<string | null> {
    const billingHints = await this.resolveAssistantPlanBillingHints(assistantId);
    const value = billingHints?.retrievalModelKey;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  async resolveAdminKnowledgeEmbeddingModelKey(): Promise<string | null> {
    const policy = await this.resolveAdminKnowledgeRetrievalPolicy();
    return policy.embeddingModelKey;
  }

  async resolveAdminKnowledgeRetrievalModelKey(): Promise<string | null> {
    const policy = await this.resolveAdminKnowledgeRetrievalPolicy();
    return policy.retrievalModelKey;
  }

  async resolveAdminKnowledgeAuthoringModelKey(): Promise<string | null> {
    const policy = await this.resolveAdminKnowledgeRetrievalPolicy();
    return policy.authoringModelKey;
  }

  async resolveAssistantRetrievalPolicy(assistantId: string): Promise<KnowledgeRetrievalPolicy> {
    const billingHints = await this.resolveAssistantPlanBillingHints(assistantId);
    const retrievalPolicy = asObject(billingHints?.retrievalPolicy ?? null);
    return {
      defaultMaxResults:
        toNullablePositiveInt(retrievalPolicy?.defaultMaxResults) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.defaultMaxResults,
      maxMaxResults:
        toNullablePositiveInt(retrievalPolicy?.maxMaxResults) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.maxMaxResults,
      lexicalCandidateLimit:
        toNullablePositiveInt(retrievalPolicy?.lexicalCandidateLimit) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.lexicalCandidateLimit,
      vectorCandidateLimit:
        toNullablePositiveInt(retrievalPolicy?.vectorCandidateLimit) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.vectorCandidateLimit,
      knowledgeFetchWindowRadius:
        toNullablePositiveInt(retrievalPolicy?.knowledgeFetchWindowRadius) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.knowledgeFetchWindowRadius,
      chatFetchWindowRadius:
        toNullablePositiveInt(retrievalPolicy?.chatFetchWindowRadius) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.chatFetchWindowRadius,
      fetchMaxChars:
        toNullablePositiveInt(retrievalPolicy?.fetchMaxChars) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.fetchMaxChars,
      helperEnabled:
        toNullableBoolean(retrievalPolicy?.helperEnabled) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.helperEnabled,
      helperCandidateLimit:
        toNullablePositiveInt(retrievalPolicy?.helperCandidateLimit) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.helperCandidateLimit,
      helperMaxOutputTokens:
        toNullablePositiveInt(retrievalPolicy?.helperMaxOutputTokens) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.helperMaxOutputTokens,
      embeddingSearchEnabled:
        toNullableBoolean(retrievalPolicy?.embeddingSearchEnabled) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.embeddingSearchEnabled,
      smartSearchShortDocChars:
        toNullablePositiveInt(retrievalPolicy?.smartSearchShortDocChars) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.smartSearchShortDocChars,
      smartSearchMediumDocChars:
        toNullablePositiveInt(retrievalPolicy?.smartSearchMediumDocChars) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.smartSearchMediumDocChars,
      chatSectionDefaultRadius:
        toNullablePositiveInt(retrievalPolicy?.chatSectionDefaultRadius) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.chatSectionDefaultRadius,
      fetchFullModeMaxChars:
        toNullablePositiveInt(retrievalPolicy?.fetchFullModeMaxChars) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.fetchFullModeMaxChars,
      fetchFullModeMaxChatMessages:
        toNullablePositiveInt(retrievalPolicy?.fetchFullModeMaxChatMessages) ??
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.fetchFullModeMaxChatMessages
    };
  }

  private async resolveAssistantPlanBillingHints(
    assistantId: string
  ): Promise<Record<string, unknown> | null> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: assistantId },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        governance: {
          select: {
            assistantPlanOverrideCode: true,
            quotaPlanCode: true
          }
        }
      }
    });
    if (assistant === null) {
      return null;
    }

    const effectiveSubscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      assistantPlanOverrideCode: assistant.governance?.assistantPlanOverrideCode ?? null,
      assistantQuotaPlanCode: assistant.governance?.quotaPlanCode ?? null
    });
    const planCode = effectiveSubscription.planCode;
    if (planCode === null) {
      return null;
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { billingProviderHints: true }
    });
    return asObject(plan?.billingProviderHints ?? null);
  }

  /**
   * ADR-094 — exposed so `ReadAssistantKnowledgeService` and
   * `OrchestrateRuntimeRetrievalService` can read the admin-controlled smart
   * retrieval ceilings (smart-search summary char cap, full-mode hard caps).
   */
  async resolveAdminKnowledgeRetrievalPolicy() {
    const row = await this.prisma.platformRuntimeProviderSettings.findUnique({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      select: { adminKnowledgeRetrievalPolicy: true }
    });
    return normalizeAdminKnowledgeRetrievalPolicyRecord(row?.adminKnowledgeRetrievalPolicy ?? null);
  }
}
