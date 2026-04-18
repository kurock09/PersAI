import { Injectable } from "@nestjs/common";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

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
};

export const DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY: KnowledgeRetrievalPolicy = {
  defaultMaxResults: 5,
  maxMaxResults: 8,
  lexicalCandidateLimit: 60,
  vectorCandidateLimit: 240,
  knowledgeFetchWindowRadius: 1,
  chatFetchWindowRadius: 2,
  fetchMaxChars: 6_000,
  helperEnabled: true,
  helperCandidateLimit: 6,
  helperMaxOutputTokens: 220,
  embeddingSearchEnabled: true
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
        DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.embeddingSearchEnabled
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
}
