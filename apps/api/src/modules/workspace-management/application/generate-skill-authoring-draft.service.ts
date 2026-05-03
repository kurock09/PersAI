import { loadApiConfig } from "@persai/config";
import {
  type ProviderGatewayTextGenerateRequest,
  type ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { KnowledgeModelPolicyService } from "./knowledge-model-policy.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import {
  normalizeSkillAuthoringDraftProposal,
  parseSkillAuthoringDraftRequest,
  type SkillAuthoringDraftProposalState,
  type SkillAuthoringDraftRequest
} from "./skill-authoring-draft.types";
import type { PlatformRuntimeProviderSettingsState } from "./platform-runtime-provider-settings";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const AUTHORING_TIMEOUT_MS = 60_000;
const AUTHORING_MAX_OUTPUT_TOKENS = 2_400;

type AuthoringProviderKey = "openai" | "anthropic";

@Injectable()
export class GenerateSkillAuthoringDraftService {
  private readonly logger = new Logger(GenerateSkillAuthoringDraftService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly knowledgeModelPolicyService: KnowledgeModelPolicyService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService
  ) {}

  parseInput(body: unknown): SkillAuthoringDraftRequest {
    try {
      return parseSkillAuthoringDraftRequest(body);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid Skill authoring draft request."
      );
    }
  }

  async execute(input: {
    userId: string;
    skillId: string;
    request: SkillAuthoringDraftRequest;
  }): Promise<SkillAuthoringDraftProposalState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(input.userId);
    const skill = await this.prisma.skill.findFirst({
      where: { id: input.skillId },
      include: {
        documents: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 8
        },
        knowledgeCards: {
          where: { lifecycleStatus: { not: "archived" } },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 8
        }
      }
    });
    if (skill === null) {
      throw new NotFoundException("Skill not found.");
    }

    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_PROVIDER_GATEWAY_BASE_URL?.trim();
    if (!baseUrl) {
      throw new ConflictException("Provider gateway is not configured for admin authoring.");
    }

    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const modelSelection = await this.resolveAuthoringModel(settings);
    const request: ProviderGatewayTextGenerateRequest = {
      provider: modelSelection.providerKey,
      model: modelSelection.modelKey,
      systemPrompt: this.buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                task: "Draft or enrich an admin-managed PersAI Skill.",
                adminPrompt: input.request.prompt,
                savedSkill: {
                  id: skill.id,
                  status: skill.status,
                  name: skill.name,
                  description: skill.description,
                  category: skill.category,
                  tags: skill.tags,
                  instructionCard: skill.instructionCard,
                  iconEmoji: skill.iconEmoji,
                  color: skill.color
                },
                currentUiDraft: input.request.currentDraft,
                existingKnowledgeCards: skill.knowledgeCards.map((card) => ({
                  title: card.title,
                  locale: card.locale,
                  tags: card.tags,
                  lifecycleStatus: card.lifecycleStatus,
                  bodyPreview: card.body.slice(0, 500)
                })),
                uploadedDocuments: skill.documents.map((document) => ({
                  displayName: document.displayName,
                  description: document.description,
                  status: document.status,
                  originalFilename: document.originalFilename,
                  mimeType: document.mimeType
                }))
              })
            }
          ]
        }
      ],
      maxOutputTokens: AUTHORING_MAX_OUTPUT_TOKENS,
      outputSchema: {
        name: "skill_authoring_draft",
        description: "Draft Skill fields and draft-only knowledge card proposals.",
        strict: true,
        schema: this.buildOutputSchema()
      },
      requestMetadata: {
        classification: "admin_authoring",
        runtimeRequestId: null,
        runtimeSessionId: null,
        toolLoopIteration: null,
        compactionToolCode: null
      }
    };

    const result = await this.postJson(
      new URL("/api/v1/providers/generate-text", baseUrl).toString(),
      request,
      AUTHORING_TIMEOUT_MS
    );
    const rawProposal = parseJsonObject(result.text ?? "");
    return normalizeSkillAuthoringDraftProposal({
      providerKey: modelSelection.providerKey,
      modelKey: modelSelection.modelKey,
      generatedAt: new Date(),
      rawProposal
    });
  }

  private async resolveAuthoringModel(settings: PlatformRuntimeProviderSettingsState): Promise<{
    providerKey: AuthoringProviderKey;
    modelKey: string;
  }> {
    if (settings.primary === null) {
      throw new ConflictException("Primary runtime provider is not configured.");
    }
    const configuredModel =
      await this.knowledgeModelPolicyService.resolveAdminKnowledgeAuthoringModelKey();
    const modelKey = configuredModel ?? settings.primary.model;
    const providerKey =
      this.resolveProviderForModel(settings, modelKey) ?? settings.primary.provider;
    return { providerKey, modelKey };
  }

  private resolveProviderForModel(
    settings: PlatformRuntimeProviderSettingsState,
    modelKey: string
  ): AuthoringProviderKey | null {
    const primaryProvider = settings.primary?.provider ?? null;
    if (
      primaryProvider !== null &&
      (settings.availableModelCatalogByProvider[primaryProvider].chat.includes(modelKey) ||
        settings.availableModelsByProvider[primaryProvider].includes(modelKey))
    ) {
      return primaryProvider;
    }
    for (const provider of ["openai", "anthropic"] as const) {
      if (
        settings.availableModelCatalogByProvider[provider].chat.includes(modelKey) ||
        settings.availableModelsByProvider[provider].includes(modelKey)
      ) {
        return provider;
      }
    }
    if (settings.primary?.model === modelKey) {
      return settings.primary.provider;
    }
    this.logger.warn(
      `Admin authoring model "${modelKey}" is not present in the configured chat catalog; using primary provider transport.`
    );
    return null;
  }

  private buildSystemPrompt(): string {
    return [
      "You are PersAI's admin Skill authoring assistant.",
      "Return only valid JSON that matches the requested schema.",
      "Your job is to help an admin draft missing Skill fields and propose draft knowledge cards.",
      "Never activate, publish, index, or claim that knowledge is approved.",
      "Do not invent source-backed facts. If facts are uncertain, add a warning.",
      "Prefer concise bilingual fields when enough context exists: English in `en`, Russian in `ru`.",
      "Knowledge cards must be short, reviewable admin drafts, not runtime-ready truth."
    ].join("\n");
  }

  private buildOutputSchema(): Record<string, unknown> {
    return {
      type: "object",
      additionalProperties: false,
      required: ["skillDraft", "knowledgeCards", "warnings"],
      properties: {
        skillDraft: {
          type: "object",
          additionalProperties: false,
          required: [
            "name",
            "description",
            "category",
            "tags",
            "instructionCard",
            "iconEmoji",
            "color"
          ],
          properties: {
            name: { $ref: "#/$defs/localizedText" },
            description: { $ref: "#/$defs/localizedText" },
            category: { type: ["string", "null"] },
            tags: { type: "array", items: { type: "string" } },
            instructionCard: {
              type: ["object", "null"],
              additionalProperties: false,
              required: ["title", "body", "guardrails", "examples"],
              properties: {
                title: { type: "string" },
                body: { type: "string" },
                guardrails: { type: "array", items: { type: "string" } },
                examples: { type: "array", items: { type: "string" } }
              }
            },
            iconEmoji: { type: ["string", "null"] },
            color: { type: ["string", "null"] }
          }
        },
        knowledgeCards: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "body", "locale", "tags"],
            properties: {
              title: { type: "string" },
              body: { type: "string" },
              locale: { type: ["string", "null"] },
              tags: { type: "array", items: { type: "string" } }
            }
          }
        },
        warnings: {
          type: "array",
          items: { type: "string" }
        }
      },
      $defs: {
        localizedText: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["en", "ru"],
          properties: {
            en: { type: ["string", "null"] },
            ru: { type: ["string", "null"] }
          }
        }
      }
    };
  }

  private async postJson(
    url: string,
    body: ProviderGatewayTextGenerateRequest,
    timeoutMs: number
  ): Promise<ProviderGatewayTextGenerateResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new ConflictException(
          bodyText.trim().length > 0
            ? `Admin authoring generation failed: HTTP ${response.status}: ${bodyText.trim()}`
            : `Admin authoring generation failed: HTTP ${response.status}`
        );
      }
      return (await response.json()) as ProviderGatewayTextGenerateResult;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    throw new ConflictException("Admin authoring model returned invalid JSON.");
  }
}
