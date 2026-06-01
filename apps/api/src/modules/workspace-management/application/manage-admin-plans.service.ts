import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository,
  type AssistantPlanCatalogWriteInput
} from "../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalog } from "../domain/assistant-plan-catalog.entity";
import type {
  AdminCreatePlanInput,
  AdminPlanInput,
  AdminPlanRetrievalPolicy,
  PublicPricingPlanState,
  AdminPlanState,
  AdminPlanRuntimeTier,
  AdminPlanToolActivationInput
} from "./admin-plan-management.types";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import { MaterializationRolloutService } from "./materialization-rollout.service";
import {
  AdminAuthorizationService,
  type DangerousAdminActionCode
} from "./admin-authorization.service";
import {
  createDefaultPlanContextHydrationPolicy,
  parsePlanContextHydrationPolicy,
  resolveStoredPlanContextHydrationPolicy,
  toPlanContextHydrationPolicyDocument
} from "./context-hydration-policy";
import {
  createDefaultPlanSandboxPolicy,
  parsePlanSandboxPolicy,
  resolveStoredPlanSandboxPolicy,
  toPlanSandboxPolicyDocument
} from "./sandbox-policy";
import {
  createDefaultPlanToolBudgets,
  hasAnyToolBudgetOverride,
  parsePlanToolBudgets,
  resolveStoredPlanToolBudgets,
  toPlanToolBudgetsDocument
} from "./tool-budgets-policy";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { getRuntimeProviderCatalogModelsByCapability } from "./runtime-provider-profile";
import { isPlanManagedTool, TOOL_CATALOG } from "../../../../prisma/tool-catalog-data";
import { toNormalizedNonEmptyModelKey } from "./model-key-normalization";
import { DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY } from "./knowledge-model-policy.service";

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const MAX_PLAN_HIGHLIGHT_ITEMS = 8;

function parseCurrencyCode(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${fieldName} must be a string or null.`);
  }
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3,8}$/.test(normalized)) {
    throw new BadRequestException(`${fieldName} must be an uppercase currency code like RUB.`);
  }
  return normalized;
}

function parseBillingPeriod(value: unknown, fieldName: string): "month" | "year" | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value === "month" || value === "year") {
    return value;
  }
  throw new BadRequestException(`${fieldName} must be 'month', 'year', or null.`);
}

function parseStatus(value: unknown): "active" | "inactive" {
  if (value === "active" || value === "inactive") {
    return value;
  }
  throw new BadRequestException("status must be 'active' or 'inactive'.");
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function parseRuntimeTier(value: unknown): AdminPlanRuntimeTier | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (
    value === "free_shared_restricted" ||
    value === "paid_shared_restricted" ||
    value === "paid_isolated"
  ) {
    return value;
  }
  throw new BadRequestException(
    "runtimeTierDefault must be one of free_shared_restricted, paid_shared_restricted, paid_isolated, or null."
  );
}

function parseOptionalPlanModelKey(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const modelKey = toNormalizedNonEmptyModelKey(value);
  if (modelKey === null) {
    throw new BadRequestException(`${fieldName} must be a non-empty string or null.`);
  }
  return modelKey;
}

function parseTrialDuration(value: unknown, trialEnabled: boolean): number | null {
  if (!trialEnabled) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(
      "trialDurationDays must be an integer greater than 0 when trialEnabled=true."
    );
  }
  return value;
}

function parseTrialFallbackPlanCode(value: unknown, trialEnabled: boolean): string | null {
  if (!trialEnabled) {
    return null;
  }
  const planCode = parseRequiredString(
    value,
    "lifecyclePolicy.trialFallbackPlanCode"
  ).toLowerCase();
  return planCode;
}

function parseOptionalFallbackPlanCode(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return parseRequiredString(value, fieldName).toLowerCase();
}

function toNullablePositiveInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return null;
}

function toNullableNonNegativeInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return null;
}

function parseRequiredPositiveInt(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${fieldName} must be an integer greater than 0.`);
  }
  return value;
}

/**
 * Same shape as `parseRequiredPositiveInt`, but accepts `undefined`/`null`
 * and falls back to the supplied default. Used by ADR-094 retrieval-policy
 * keys where the JSON document may legitimately omit a key (UI sends it
 * explicitly; legacy-shaped rows fall back to the runtime default).
 */
function parsePositiveIntWithDefault(
  value: unknown,
  fieldName: string,
  defaultValue: number
): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return parseRequiredPositiveInt(value, fieldName);
}

function parsePlanAssistantPolicy(value: unknown): AdminPlanInput["assistantPolicy"] {
  if (value === undefined || value === null) {
    return { maxAssistants: 1 };
  }
  const parsed = parseObject(value, "assistantPolicy");
  return {
    maxAssistants: parseRequiredPositiveInt(parsed.maxAssistants, "assistantPolicy.maxAssistants")
  };
}

function parseObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseStringList(value: unknown, fieldName: string): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an array of strings.`);
  }
  const items = value
    .map((item, idx) => {
      if (typeof item !== "string") {
        throw new BadRequestException(`${fieldName}[${String(idx)}] must be a string.`);
      }
      return item.trim();
    })
    .filter((item) => item.length > 0);
  if (items.length > MAX_PLAN_HIGHLIGHT_ITEMS) {
    throw new BadRequestException(
      `${fieldName} must contain at most ${String(MAX_PLAN_HIGHLIGHT_ITEMS)} items.`
    );
  }
  return items;
}

function parseLocalizedText(
  value: unknown,
  fieldName: string
): { ru: string | null; en: string | null } {
  const parsed = value === undefined || value === null ? {} : parseObject(value, fieldName);
  return {
    ru: toNullableString(parsed.ru),
    en: toNullableString(parsed.en)
  };
}

function parseLocalizedTextList(
  value: unknown,
  fieldName: string
): {
  ru: string[];
  en: string[];
} {
  const parsed = value === undefined || value === null ? {} : parseObject(value, fieldName);
  return {
    ru: parseStringList(parsed.ru, `${fieldName}.ru`),
    en: parseStringList(parsed.en, `${fieldName}.en`)
  };
}

function parsePlanPresentation(value: unknown): AdminPlanInput["presentation"] {
  const parsed = value === undefined || value === null ? {} : parseObject(value, "presentation");
  const priceRaw =
    parsed.price === undefined || parsed.price === null
      ? {}
      : parseObject(parsed.price, "presentation.price");
  return {
    showOnPricingPage: toBoolean(parsed.showOnPricingPage),
    displayOrder: toNullableNonNegativeInt(parsed.displayOrder) ?? 0,
    highlighted: toBoolean(parsed.highlighted),
    title: parseLocalizedText(parsed.title, "presentation.title"),
    subtitle: parseLocalizedText(parsed.subtitle, "presentation.subtitle"),
    notes: parseLocalizedText(parsed.notes, "presentation.notes"),
    badge: parseLocalizedText(parsed.badge, "presentation.badge"),
    ctaLabel: parseLocalizedText(parsed.ctaLabel, "presentation.ctaLabel"),
    price: {
      amount: toNullableNonNegativeInt(priceRaw.amount),
      currency: parseCurrencyCode(priceRaw.currency, "presentation.price.currency"),
      billingPeriod: parseBillingPeriod(priceRaw.billingPeriod, "presentation.price.billingPeriod")
    },
    highlightItems: parseLocalizedTextList(parsed.highlightItems, "presentation.highlightItems")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergePlanPatchValue(currentValue: unknown, patchValue: unknown): unknown {
  if (patchValue === undefined) {
    return currentValue;
  }
  if (isRecord(currentValue) && isRecord(patchValue)) {
    return mergePlanPatchObject(currentValue, patchValue);
  }
  if (patchValue === null && isRecord(currentValue)) {
    return currentValue;
  }
  return patchValue;
}

function mergePlanPatchObject(
  currentValue: Record<string, unknown>,
  patchValue: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...currentValue };
  for (const [key, value] of Object.entries(patchValue)) {
    merged[key] = mergePlanPatchValue(currentValue[key], value);
  }
  return merged;
}

const PLAN_MANAGED_TOOL_DEFAULTS = TOOL_CATALOG.filter((tool) => isPlanManagedTool(tool.code)).map(
  (tool) => ({
    toolCode: tool.code,
    toolClass: tool.toolClass
  })
);

function hasAllowedFlag(items: unknown, key: string): boolean {
  if (!Array.isArray(items)) {
    return false;
  }
  return items.some((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const typed = item as Record<string, unknown>;
    return typed.key === key && typed.allowed === true;
  });
}

function hasQuotaGovernedFlag(items: unknown, key: string): boolean {
  if (!Array.isArray(items)) {
    return false;
  }
  return items.some((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const typed = item as Record<string, unknown>;
    return typed.key === key && typed.quotaGoverned === true;
  });
}

function readEnabledSkillLimitFromLimitsPermissions(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const typed = item as Record<string, unknown>;
    if (
      typed.key === "enabled_skills_limit" ||
      typed.key === "max_enabled_skills" ||
      typed.key === "skill_assignments_limit"
    ) {
      const limit = toNullableNonNegativeInt(typed.value) ?? toNullableNonNegativeInt(typed.limit);
      if (limit !== null) {
        return limit;
      }
    }
  }
  return null;
}

function normalizePlanToolDisplayName(toolCode: string, displayName: string): string {
  if (toolCode === "files") {
    return "Files";
  }
  if (toolCode === "memory_search") {
    return "Knowledge Search";
  }
  if (toolCode === "memory_get") {
    return "Knowledge Fetch";
  }
  return displayName;
}

function parseAdminPlanRetrievalPolicy(value: unknown): AdminPlanRetrievalPolicy {
  if (value === undefined || value === null) {
    return { ...DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY };
  }
  const parsed = parseObject(value, "retrievalPolicy");
  return {
    defaultMaxResults: parseRequiredPositiveInt(
      parsed.defaultMaxResults,
      "retrievalPolicy.defaultMaxResults"
    ),
    maxMaxResults: parseRequiredPositiveInt(parsed.maxMaxResults, "retrievalPolicy.maxMaxResults"),
    lexicalCandidateLimit: parseRequiredPositiveInt(
      parsed.lexicalCandidateLimit,
      "retrievalPolicy.lexicalCandidateLimit"
    ),
    vectorCandidateLimit: parseRequiredPositiveInt(
      parsed.vectorCandidateLimit,
      "retrievalPolicy.vectorCandidateLimit"
    ),
    knowledgeFetchWindowRadius: parseRequiredPositiveInt(
      parsed.knowledgeFetchWindowRadius,
      "retrievalPolicy.knowledgeFetchWindowRadius"
    ),
    chatFetchWindowRadius: parseRequiredPositiveInt(
      parsed.chatFetchWindowRadius,
      "retrievalPolicy.chatFetchWindowRadius"
    ),
    fetchMaxChars: parseRequiredPositiveInt(parsed.fetchMaxChars, "retrievalPolicy.fetchMaxChars"),
    helperEnabled:
      typeof parsed.helperEnabled === "boolean"
        ? parsed.helperEnabled
        : DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.helperEnabled,
    helperCandidateLimit: parseRequiredPositiveInt(
      parsed.helperCandidateLimit,
      "retrievalPolicy.helperCandidateLimit"
    ),
    helperMaxOutputTokens: parseRequiredPositiveInt(
      parsed.helperMaxOutputTokens,
      "retrievalPolicy.helperMaxOutputTokens"
    ),
    embeddingSearchEnabled:
      typeof parsed.embeddingSearchEnabled === "boolean"
        ? parsed.embeddingSearchEnabled
        : DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.embeddingSearchEnabled,
    smartSearchShortDocChars: parsePositiveIntWithDefault(
      parsed.smartSearchShortDocChars,
      "retrievalPolicy.smartSearchShortDocChars",
      DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.smartSearchShortDocChars
    ),
    smartSearchMediumDocChars: parsePositiveIntWithDefault(
      parsed.smartSearchMediumDocChars,
      "retrievalPolicy.smartSearchMediumDocChars",
      DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.smartSearchMediumDocChars
    ),
    chatSectionDefaultRadius: parsePositiveIntWithDefault(
      parsed.chatSectionDefaultRadius,
      "retrievalPolicy.chatSectionDefaultRadius",
      DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.chatSectionDefaultRadius
    ),
    fetchFullModeMaxChars: parsePositiveIntWithDefault(
      parsed.fetchFullModeMaxChars,
      "retrievalPolicy.fetchFullModeMaxChars",
      DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.fetchFullModeMaxChars
    ),
    fetchFullModeMaxChatMessages: parsePositiveIntWithDefault(
      parsed.fetchFullModeMaxChatMessages,
      "retrievalPolicy.fetchFullModeMaxChatMessages",
      DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY.fetchFullModeMaxChatMessages
    )
  };
}

function formatPlanDeleteInUseMessage(params: {
  workspaceSubscriptionCount: number;
  assistantOverrideCount: number;
  assistantFallbackCount: number;
}): string {
  const reasons: string[] = [];
  if (params.workspaceSubscriptionCount > 0) {
    reasons.push(`${String(params.workspaceSubscriptionCount)} workspace subscription(s)`);
  }
  if (params.assistantOverrideCount > 0) {
    reasons.push(`${String(params.assistantOverrideCount)} assistant override(s)`);
  }
  if (params.assistantFallbackCount > 0) {
    reasons.push(`${String(params.assistantFallbackCount)} assistant fallback binding(s)`);
  }
  return reasons.length > 0
    ? `Plan is still in use by ${reasons.join(", ")}.`
    : "Plan is still in use.";
}

@Injectable()
export class ManageAdminPlansService {
  constructor(
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly planCatalogRepository: AssistantPlanCatalogRepository,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly materializationRolloutService: MaterializationRolloutService
  ) {}

  async listPlans(userId: string): Promise<AdminPlanState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    let plans = await this.planCatalogRepository.listAll();

    const plansWithoutActivations = plans.filter((p) => p.toolActivations.length === 0);
    if (plansWithoutActivations.length > 0) {
      await this.planCatalogRepository.backfillToolActivationsForPlans(
        plansWithoutActivations.map((p) => p.id)
      );
      plans = await this.planCatalogRepository.listAll();
    }

    return plans.map((plan) => this.toAdminPlanState(plan));
  }

  async listPublicPricingPlans(): Promise<PublicPricingPlanState[]> {
    const plans = await this.planCatalogRepository.listAll();
    return plans
      .map((plan) => this.toAdminPlanState(plan))
      .filter((plan) => plan.status === "active" && plan.presentation.showOnPricingPage)
      .sort((left, right) => {
        if (left.presentation.displayOrder !== right.presentation.displayOrder) {
          return left.presentation.displayOrder - right.presentation.displayOrder;
        }
        return left.code.localeCompare(right.code);
      })
      .map((plan) => ({
        code: plan.code,
        displayName: plan.displayName,
        description: plan.description,
        trialEnabled: plan.trialEnabled,
        trialDurationDays: plan.trialDurationDays,
        defaultOnRegistration: plan.defaultOnRegistration,
        enabledToolCodes: plan.toolActivations
          .filter((tool) => tool.active)
          .map((tool) => tool.toolCode),
        entitlements: plan.entitlements,
        quotaLimits: plan.quotaLimits,
        skillPolicy: plan.skillPolicy,
        assistantPolicy: plan.assistantPolicy,
        presentation: plan.presentation
      }));
  }

  parseCreateInput(body: unknown): AdminCreatePlanInput {
    const parsed = parseObject(body, "request body");
    return {
      code: parseRequiredString(parsed.code, "code").toLowerCase(),
      ...this.parsePlanInput(parsed)
    };
  }

  parseUpdateInput(body: unknown): AdminPlanInput {
    const parsed = parseObject(body, "request body");
    return this.parsePlanInput(parsed);
  }

  parseUpdatePatch(body: unknown): Record<string, unknown> {
    return parseObject(body, "request body");
  }

  async createPlan(
    userId: string,
    input: AdminCreatePlanInput,
    stepUpToken: string | null
  ): Promise<AdminPlanState> {
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.plan.create",
      stepUpToken
    );
    const existing = await this.planCatalogRepository.findByCode(input.code);
    if (existing !== null) {
      throw new ConflictException("Plan code already exists.");
    }
    await this.assertModelKeysAvailable([
      input.primaryModelKey,
      input.premiumModelKey,
      input.reasoningModelKey,
      input.systemToolModelKey,
      input.retrievalModelKey,
      input.embeddingModelKey
    ]);
    await this.assertCapabilityModelKeysAvailable([
      { modelKey: input.imageGenerateModelKey, capability: "image" },
      { modelKey: input.imageGenerateFallbackModelKey, capability: "image" },
      { modelKey: input.imageEditModelKey, capability: "image" },
      { modelKey: input.imageEditFallbackModelKey, capability: "image" },
      { modelKey: input.videoGenerateModelKey, capability: "video" },
      { modelKey: input.videoGenerateFallbackModelKey, capability: "video" }
    ]);
    await this.assertLifecycleFallbackPlansAreActive(input, input.code);

    const created = await this.planCatalogRepository.create(input.code, this.toWriteInput(input));
    const configGeneration = await this.bumpConfigGenerationService.execute();
    await this.materializationRolloutService.createAutomaticGlobalRollout({
      actorUserId: userId,
      workspaceId: access.workspaceId,
      rolloutType: "plan_change",
      triggerSource: "plan_settings",
      scopeType: "effective_plan",
      criticality: "hard",
      targetGeneration: configGeneration,
      scopeMetadata: {
        reason: "admin.plan.create",
        planCode: created.code
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Admin queued a plan-change materialization rollout."
    });
    await this.appendAssistantAuditEventService.execute({
      workspaceId: access.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.plan_created",
      summary: "Admin plan created.",
      details: {
        action: "admin.plan.create" as DangerousAdminActionCode,
        actorRoles: access.roles,
        stepUpVerified: true,
        code: created.code,
        status: created.status,
        defaultOnRegistration: created.isDefaultFirstRegistrationPlan,
        trialEnabled: created.isTrialPlan
      }
    });
    return this.toAdminPlanState(created);
  }

  async updatePlan(
    userId: string,
    code: string,
    patch: Record<string, unknown>,
    stepUpToken: string | null
  ): Promise<AdminPlanState> {
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.plan.update",
      stepUpToken
    );
    const normalizedCode = parseRequiredString(code, "code").toLowerCase();
    const existing = await this.planCatalogRepository.findByCode(normalizedCode);
    if (existing === null) {
      throw new NotFoundException("Plan not found.");
    }
    const mergedInput = this.parsePlanInput(
      mergePlanPatchObject(this.toAdminPlanState(existing), patch)
    );
    await this.assertModelKeysAvailable([
      mergedInput.primaryModelKey,
      mergedInput.premiumModelKey,
      mergedInput.reasoningModelKey,
      mergedInput.systemToolModelKey,
      mergedInput.retrievalModelKey,
      mergedInput.embeddingModelKey
    ]);
    await this.assertCapabilityModelKeysAvailable([
      { modelKey: mergedInput.imageGenerateModelKey, capability: "image" },
      { modelKey: mergedInput.imageGenerateFallbackModelKey, capability: "image" },
      { modelKey: mergedInput.imageEditModelKey, capability: "image" },
      { modelKey: mergedInput.imageEditFallbackModelKey, capability: "image" },
      { modelKey: mergedInput.videoGenerateModelKey, capability: "video" },
      { modelKey: mergedInput.videoGenerateFallbackModelKey, capability: "video" }
    ]);
    await this.assertLifecycleFallbackPlansAreActive(mergedInput, normalizedCode);
    const updated = await this.planCatalogRepository.updateByCode(
      normalizedCode,
      this.toWriteInput(mergedInput)
    );
    if (updated === null) {
      throw new NotFoundException("Plan not found.");
    }
    const configGeneration = await this.bumpConfigGenerationService.execute();
    await this.materializationRolloutService.createAutomaticGlobalRollout({
      actorUserId: userId,
      workspaceId: access.workspaceId,
      rolloutType: "plan_change",
      triggerSource: "plan_settings",
      scopeType: "effective_plan",
      criticality: "hard",
      targetGeneration: configGeneration,
      scopeMetadata: {
        reason: "admin.plan.update",
        planCode: updated.code
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Admin queued a plan-change materialization rollout."
    });
    await this.appendAssistantAuditEventService.execute({
      workspaceId: access.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.plan_updated",
      summary: "Admin plan updated.",
      details: {
        action: "admin.plan.update" as DangerousAdminActionCode,
        actorRoles: access.roles,
        stepUpVerified: true,
        code: updated.code,
        status: updated.status,
        defaultOnRegistration: updated.isDefaultFirstRegistrationPlan,
        trialEnabled: updated.isTrialPlan
      }
    });
    return this.toAdminPlanState(updated);
  }

  async deletePlan(userId: string, code: string, stepUpToken: string | null): Promise<void> {
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.plan.delete",
      stepUpToken
    );
    const normalizedCode = parseRequiredString(code, "code").toLowerCase();
    const deleteImpact = await this.planCatalogRepository.getDeleteImpactByCode(normalizedCode);
    if (deleteImpact === null) {
      throw new NotFoundException("Plan not found.");
    }
    if (deleteImpact.isDefaultRegistrationPlan) {
      throw new ConflictException("Default registration plan cannot be deleted.");
    }
    if (
      deleteImpact.workspaceSubscriptionCount > 0 ||
      deleteImpact.assistantOverrideCount > 0 ||
      deleteImpact.assistantFallbackCount > 0
    ) {
      throw new ConflictException(
        formatPlanDeleteInUseMessage({
          workspaceSubscriptionCount: deleteImpact.workspaceSubscriptionCount,
          assistantOverrideCount: deleteImpact.assistantOverrideCount,
          assistantFallbackCount: deleteImpact.assistantFallbackCount
        })
      );
    }
    const deleted = await this.planCatalogRepository.deleteByCode(normalizedCode);
    if (!deleted) {
      throw new NotFoundException("Plan not found.");
    }
    const configGeneration = await this.bumpConfigGenerationService.execute();
    await this.materializationRolloutService.createAutomaticGlobalRollout({
      actorUserId: userId,
      workspaceId: access.workspaceId,
      rolloutType: "plan_change",
      triggerSource: "plan_settings",
      scopeType: "effective_plan",
      criticality: "hard",
      targetGeneration: configGeneration,
      scopeMetadata: {
        reason: "admin.plan.delete",
        planCode: normalizedCode
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Admin queued a plan-change materialization rollout."
    });
    await this.appendAssistantAuditEventService.execute({
      workspaceId: access.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.plan_deleted",
      summary: "Admin plan deleted.",
      details: {
        action: "admin.plan.delete" as DangerousAdminActionCode,
        actorRoles: access.roles,
        stepUpVerified: true,
        code: normalizedCode
      }
    });
  }

  private parsePlanInput(parsed: Record<string, unknown>): AdminPlanInput {
    const status = parseStatus(parsed.status);
    const trialEnabled = toBoolean(parsed.trialEnabled);
    const entitlements = parseObject(parsed.entitlements, "entitlements");
    const toolClasses = parseObject(entitlements.toolClasses, "entitlements.toolClasses");
    const channelsAndSurfaces = parseObject(
      entitlements.channelsAndSurfaces,
      "entitlements.channelsAndSurfaces"
    );
    const mediaClassesRaw = entitlements.mediaClasses
      ? parseObject(entitlements.mediaClasses, "entitlements.mediaClasses")
      : {};
    const metadata = parseObject(parsed.metadata, "metadata");
    const presentation = parsePlanPresentation(parsed.presentation);
    const lifecyclePolicyRaw =
      parsed.lifecyclePolicy !== undefined && parsed.lifecyclePolicy !== null
        ? parseObject(parsed.lifecyclePolicy, "lifecyclePolicy")
        : {};
    const quotaLimitsRaw =
      parsed.quotaLimits !== undefined && parsed.quotaLimits !== null
        ? parseObject(parsed.quotaLimits, "quotaLimits")
        : {};
    const skillPolicyRaw =
      parsed.skillPolicy !== undefined && parsed.skillPolicy !== null
        ? parseObject(parsed.skillPolicy, "skillPolicy")
        : {};
    const assistantPolicy = parsePlanAssistantPolicy(parsed.assistantPolicy);
    const contextPolicy =
      parsed.contextPolicy === undefined || parsed.contextPolicy === null
        ? createDefaultPlanContextHydrationPolicy()
        : parsePlanContextHydrationPolicy(parsed.contextPolicy, "contextPolicy");
    const retrievalPolicy = parseAdminPlanRetrievalPolicy(parsed.retrievalPolicy);
    const sandboxPolicy =
      parsed.sandboxPolicy === undefined || parsed.sandboxPolicy === null
        ? createDefaultPlanSandboxPolicy()
        : parsePlanSandboxPolicy(parsed.sandboxPolicy, "sandboxPolicy");
    const toolBudgets =
      parsed.toolBudgets === undefined || parsed.toolBudgets === null
        ? createDefaultPlanToolBudgets()
        : parsePlanToolBudgets(parsed.toolBudgets, "toolBudgets");

    const toolActivations = this.parseToolActivations(parsed.toolActivations);

    const result: AdminPlanInput = {
      displayName: parseRequiredString(parsed.displayName, "displayName"),
      description: toNullableString(parsed.description),
      status,
      defaultOnRegistration: toBoolean(parsed.defaultOnRegistration),
      trialEnabled,
      trialDurationDays: parseTrialDuration(parsed.trialDurationDays, trialEnabled),
      lifecyclePolicy: {
        trialFallbackPlanCode: parseTrialFallbackPlanCode(
          lifecyclePolicyRaw.trialFallbackPlanCode,
          trialEnabled
        ),
        paidFallbackPlanCode: parseOptionalFallbackPlanCode(
          lifecyclePolicyRaw.paidFallbackPlanCode,
          "lifecyclePolicy.paidFallbackPlanCode"
        )
      },
      metadata: {
        commercialTag: toNullableString(metadata.commercialTag),
        notes: toNullableString(metadata.notes)
      },
      presentation,
      entitlements: {
        toolClasses: {
          costDrivingTools: toBoolean(toolClasses.costDrivingTools),
          utilityTools: toBoolean(toolClasses.utilityTools),
          costDrivingQuotaGoverned: toBoolean(toolClasses.costDrivingQuotaGoverned),
          utilityQuotaGoverned: toBoolean(toolClasses.utilityQuotaGoverned)
        },
        channelsAndSurfaces: {
          webChat: toBoolean(channelsAndSurfaces.webChat),
          telegram: toBoolean(channelsAndSurfaces.telegram),
          whatsapp: toBoolean(channelsAndSurfaces.whatsapp),
          max: toBoolean(channelsAndSurfaces.max)
        },
        mediaClasses: {
          image: toBoolean(mediaClassesRaw.image),
          audio: toBoolean(mediaClassesRaw.audio),
          video: toBoolean(mediaClassesRaw.video),
          file: toBoolean(mediaClassesRaw.file)
        }
      },
      quotaLimits: {
        tokenBudgetLimit: toNullablePositiveInt(quotaLimitsRaw.tokenBudgetLimit),
        activeWebChatsLimit: toNullableNonNegativeInt(quotaLimitsRaw.activeWebChatsLimit),
        messagesPerChat: toNullableNonNegativeInt(quotaLimitsRaw.messagesPerChat),
        imageGenerateMonthlyUnitsLimit: toNullablePositiveInt(
          quotaLimitsRaw.imageGenerateMonthlyUnitsLimit
        ),
        imageEditMonthlyUnitsLimit: toNullablePositiveInt(
          quotaLimitsRaw.imageEditMonthlyUnitsLimit
        ),
        videoGenerateMonthlyUnitsLimit: toNullablePositiveInt(
          quotaLimitsRaw.videoGenerateMonthlyUnitsLimit
        ),
        documentMonthlyUnitsLimit: toNullablePositiveInt(quotaLimitsRaw.documentMonthlyUnitsLimit),
        mediaStorageBytesLimit: toNullablePositiveInt(quotaLimitsRaw.mediaStorageBytesLimit),
        knowledgeStorageBytesLimit: toNullablePositiveInt(
          quotaLimitsRaw.knowledgeStorageBytesLimit
        ),
        workspaceStorageBytesLimit: toNullablePositiveInt(quotaLimitsRaw.workspaceStorageBytesLimit)
      },
      skillPolicy: {
        maxEnabledSkills: toNullableNonNegativeInt(skillPolicyRaw.maxEnabledSkills)
      },
      assistantPolicy,
      contextPolicy,
      retrievalPolicy,
      sandboxPolicy,
      primaryModelKey: toNormalizedNonEmptyModelKey(parsed.primaryModelKey),
      premiumModelKey: toNormalizedNonEmptyModelKey(parsed.premiumModelKey),
      reasoningModelKey: toNormalizedNonEmptyModelKey(parsed.reasoningModelKey),
      systemToolModelKey: toNormalizedNonEmptyModelKey(parsed.systemToolModelKey),
      retrievalModelKey: toNormalizedNonEmptyModelKey(parsed.retrievalModelKey),
      embeddingModelKey: toNormalizedNonEmptyModelKey(parsed.embeddingModelKey),
      imageGenerateModelKey: parseOptionalPlanModelKey(
        parsed.imageGenerateModelKey,
        "imageGenerateModelKey"
      ),
      imageGenerateFallbackModelKey: parseOptionalPlanModelKey(
        parsed.imageGenerateFallbackModelKey,
        "imageGenerateFallbackModelKey"
      ),
      imageEditModelKey: parseOptionalPlanModelKey(parsed.imageEditModelKey, "imageEditModelKey"),
      imageEditFallbackModelKey: parseOptionalPlanModelKey(
        parsed.imageEditFallbackModelKey,
        "imageEditFallbackModelKey"
      ),
      videoGenerateModelKey: parseOptionalPlanModelKey(
        parsed.videoGenerateModelKey,
        "videoGenerateModelKey"
      ),
      videoGenerateFallbackModelKey: parseOptionalPlanModelKey(
        parsed.videoGenerateFallbackModelKey,
        "videoGenerateFallbackModelKey"
      ),
      runtimeTierDefault: parseRuntimeTier(parsed.runtimeTierDefault),
      toolBudgets
    };
    if (toolActivations) {
      result.toolActivations = toolActivations;
    }
    return result;
  }

  private parseToolActivations(raw: unknown): AdminPlanToolActivationInput[] | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (!Array.isArray(raw)) {
      throw new BadRequestException("toolActivations must be an array.");
    }
    const seenToolCodes = new Set<string>();
    return raw.map((item, idx) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new BadRequestException(`toolActivations[${String(idx)}] must be an object.`);
      }
      const typed = item as Record<string, unknown>;
      const toolCode = parseRequiredString(
        typed.toolCode,
        `toolActivations[${String(idx)}].toolCode`
      );
      if (!isPlanManagedTool(toolCode)) {
        throw new BadRequestException(
          `toolActivations[${String(idx)}].toolCode "${toolCode}" is not plan-managed and cannot be edited here.`
        );
      }
      if (seenToolCodes.has(toolCode)) {
        throw new BadRequestException(
          `toolActivations[${String(idx)}].toolCode "${toolCode}" is duplicated.`
        );
      }
      seenToolCodes.add(toolCode);
      const active = toBoolean(typed.active);
      let dailyCallLimit: number | null = null;
      if (typed.dailyCallLimit !== undefined && typed.dailyCallLimit !== null) {
        if (
          typeof typed.dailyCallLimit !== "number" ||
          !Number.isInteger(typed.dailyCallLimit) ||
          typed.dailyCallLimit < 0
        ) {
          throw new BadRequestException(
            `toolActivations[${String(idx)}].dailyCallLimit must be a non-negative integer or null.`
          );
        }
        dailyCallLimit = typed.dailyCallLimit;
      }
      let perTurnCap: number | null = null;
      if (typed.perTurnCap !== undefined && typed.perTurnCap !== null) {
        if (
          typeof typed.perTurnCap !== "number" ||
          !Number.isInteger(typed.perTurnCap) ||
          typed.perTurnCap <= 0
        ) {
          throw new BadRequestException(
            `toolActivations[${String(idx)}].perTurnCap must be a positive integer or null.`
          );
        }
        perTurnCap = typed.perTurnCap;
      }
      return { toolCode, active, dailyCallLimit, perTurnCap };
    });
  }

  private toWriteInput(input: AdminPlanInput): AssistantPlanCatalogWriteInput {
    const quotaAccounting: Record<string, unknown> = {};
    if (input.quotaLimits.tokenBudgetLimit !== null) {
      quotaAccounting.tokenBudgetLimit = input.quotaLimits.tokenBudgetLimit;
    }
    if (input.quotaLimits.activeWebChatsLimit !== null) {
      quotaAccounting.activeWebChatsLimit = input.quotaLimits.activeWebChatsLimit;
    }
    if (input.quotaLimits.messagesPerChat !== null) {
      quotaAccounting.messagesPerChat = input.quotaLimits.messagesPerChat;
    }
    if (input.quotaLimits.imageGenerateMonthlyUnitsLimit !== null) {
      quotaAccounting.imageGenerateMonthlyUnitsLimit =
        input.quotaLimits.imageGenerateMonthlyUnitsLimit;
    }
    if (input.quotaLimits.imageEditMonthlyUnitsLimit !== null) {
      quotaAccounting.imageEditMonthlyUnitsLimit = input.quotaLimits.imageEditMonthlyUnitsLimit;
    }
    if (input.quotaLimits.videoGenerateMonthlyUnitsLimit !== null) {
      quotaAccounting.videoGenerateMonthlyUnitsLimit =
        input.quotaLimits.videoGenerateMonthlyUnitsLimit;
    }
    if (input.quotaLimits.documentMonthlyUnitsLimit !== null) {
      quotaAccounting.documentMonthlyUnitsLimit = input.quotaLimits.documentMonthlyUnitsLimit;
    }
    if (input.quotaLimits.mediaStorageBytesLimit !== null) {
      quotaAccounting.mediaStorageBytesLimit = input.quotaLimits.mediaStorageBytesLimit;
    }
    if (input.quotaLimits.knowledgeStorageBytesLimit !== null) {
      quotaAccounting.knowledgeStorageBytesLimit = input.quotaLimits.knowledgeStorageBytesLimit;
    }
    if (input.quotaLimits.workspaceStorageBytesLimit !== null) {
      quotaAccounting.workspaceStorageBytesLimit = input.quotaLimits.workspaceStorageBytesLimit;
    }
    return {
      displayName: input.displayName,
      description: input.description,
      status: input.status,
      isDefaultFirstRegistrationPlan: input.defaultOnRegistration,
      isTrialPlan: input.trialEnabled,
      trialDurationDays: input.trialDurationDays,
      billingProviderHints: {
        schema: "persai.billingHints.v1",
        providerAgnostic: true,
        commercialTag: input.metadata.commercialTag,
        notes: input.metadata.notes,
        presentation: {
          schema: "persai.planPresentation.v1",
          showOnPricingPage: input.presentation.showOnPricingPage,
          displayOrder: input.presentation.displayOrder,
          highlighted: input.presentation.highlighted,
          title: input.presentation.title,
          subtitle: input.presentation.subtitle,
          notes: input.presentation.notes,
          badge: input.presentation.badge,
          ctaLabel: input.presentation.ctaLabel,
          price: input.presentation.price,
          highlightItems: input.presentation.highlightItems
        },
        lifecyclePolicy: {
          schema: "persai.planLifecyclePolicy.v1",
          trialFallbackPlanCode: input.lifecyclePolicy.trialFallbackPlanCode,
          paidFallbackPlanCode: input.lifecyclePolicy.paidFallbackPlanCode
        },
        ...(Object.keys(quotaAccounting).length > 0 ? { quotaAccounting } : {}),
        ...(input.skillPolicy.maxEnabledSkills !== null
          ? { skillPolicy: { maxEnabledSkills: input.skillPolicy.maxEnabledSkills } }
          : {}),
        assistantPolicy: {
          schema: "persai.assistantPolicy.v1",
          maxAssistants: input.assistantPolicy.maxAssistants
        },
        contextPolicy: toPlanContextHydrationPolicyDocument(input.contextPolicy),
        retrievalPolicy: input.retrievalPolicy,
        sandboxPolicy: toPlanSandboxPolicyDocument(input.sandboxPolicy),
        ...(input.primaryModelKey !== null ? { primaryModelKey: input.primaryModelKey } : {}),
        ...(input.premiumModelKey !== null ? { premiumModelKey: input.premiumModelKey } : {}),
        ...(input.reasoningModelKey !== null ? { reasoningModelKey: input.reasoningModelKey } : {}),
        ...(input.systemToolModelKey !== null
          ? { systemToolModelKey: input.systemToolModelKey }
          : {}),
        ...(input.retrievalModelKey !== null ? { retrievalModelKey: input.retrievalModelKey } : {}),
        ...(input.embeddingModelKey !== null ? { embeddingModelKey: input.embeddingModelKey } : {}),
        ...(input.imageGenerateModelKey !== null
          ? { imageGenerateModelKey: input.imageGenerateModelKey }
          : {}),
        ...(input.imageGenerateFallbackModelKey !== null
          ? { imageGenerateFallbackModelKey: input.imageGenerateFallbackModelKey }
          : {}),
        ...(input.imageEditModelKey !== null ? { imageEditModelKey: input.imageEditModelKey } : {}),
        ...(input.imageEditFallbackModelKey !== null
          ? { imageEditFallbackModelKey: input.imageEditFallbackModelKey }
          : {}),
        ...(input.videoGenerateModelKey !== null
          ? { videoGenerateModelKey: input.videoGenerateModelKey }
          : {}),
        ...(input.videoGenerateFallbackModelKey !== null
          ? { videoGenerateFallbackModelKey: input.videoGenerateFallbackModelKey }
          : {}),
        ...(input.runtimeTierDefault !== null
          ? { runtimeTierDefault: input.runtimeTierDefault }
          : {}),
        ...(hasAnyToolBudgetOverride(input.toolBudgets)
          ? { toolBudgets: toPlanToolBudgetsDocument(input.toolBudgets) }
          : {})
      },
      entitlementModel: {
        schemaVersion: 1,
        capabilities: [],
        toolClasses: [
          {
            key: "cost_driving",
            allowed: input.entitlements.toolClasses.costDrivingTools,
            quotaGoverned: input.entitlements.toolClasses.costDrivingQuotaGoverned
          },
          {
            key: "utility",
            allowed: input.entitlements.toolClasses.utilityTools,
            quotaGoverned: input.entitlements.toolClasses.utilityQuotaGoverned
          }
        ],
        channelsAndSurfaces: [
          { key: "web_chat", allowed: input.entitlements.channelsAndSurfaces.webChat },
          { key: "telegram", allowed: input.entitlements.channelsAndSurfaces.telegram },
          { key: "whatsapp", allowed: input.entitlements.channelsAndSurfaces.whatsapp },
          { key: "max", allowed: input.entitlements.channelsAndSurfaces.max }
        ],
        mediaClasses: [
          { key: "image", allowed: input.entitlements.mediaClasses.image },
          { key: "audio", allowed: input.entitlements.mediaClasses.audio },
          { key: "video", allowed: input.entitlements.mediaClasses.video },
          { key: "file", allowed: input.entitlements.mediaClasses.file }
        ],
        limitsPermissions:
          input.skillPolicy.maxEnabledSkills === null
            ? []
            : [
                {
                  key: "enabled_skills_limit",
                  value: input.skillPolicy.maxEnabledSkills
                }
              ]
      },
      toolActivationOverrides: this.toCanonicalToolActivationOverrides(input).map((ta) => ({
        toolCode: ta.toolCode,
        active: ta.active,
        dailyCallLimit: ta.dailyCallLimit,
        perTurnCap: ta.perTurnCap
      }))
    };
  }

  private toCanonicalToolActivationOverrides(
    input: AdminPlanInput
  ): AdminPlanToolActivationInput[] {
    const overrides = new Map(
      (input.toolActivations ?? []).map((ta) => [ta.toolCode, ta] as const)
    );
    return PLAN_MANAGED_TOOL_DEFAULTS.map((tool) => {
      const override = overrides.get(tool.toolCode);
      const activeByClass =
        tool.toolClass === "utility"
          ? input.entitlements.toolClasses.utilityTools
          : input.entitlements.toolClasses.costDrivingTools;
      return {
        toolCode: tool.toolCode,
        active: override?.active ?? activeByClass,
        dailyCallLimit: override?.dailyCallLimit ?? null,
        perTurnCap: override?.perTurnCap ?? null
      };
    });
  }

  private async assertModelKeysAvailable(modelKeys: Array<string | null>): Promise<void> {
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const catalog = [
      ...settings.availableModelsByProvider.openai,
      ...settings.availableModelsByProvider.anthropic
    ];
    for (const modelKey of modelKeys) {
      if (modelKey === null) {
        continue;
      }
      if (!catalog.includes(modelKey)) {
        throw new BadRequestException(
          `"${modelKey}" must be selected from Runtime Admin available models.`
        );
      }
    }
  }

  private async assertCapabilityModelKeysAvailable(
    entries: Array<{ modelKey: string | null; capability: "image" | "video" }>
  ): Promise<void> {
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const catalogs = settings.availableModelCatalogByProvider;
    const getCapabilityModels = (
      providerCatalog:
        | { models: Array<{ model: string; active: boolean; capabilities: string[] }> }
        | undefined,
      capability: "image" | "video"
    ): string[] =>
      providerCatalog === undefined
        ? []
        : getRuntimeProviderCatalogModelsByCapability(
            providerCatalog as Parameters<typeof getRuntimeProviderCatalogModelsByCapability>[0],
            capability
          );
    const capabilityCatalogs: Record<
      "image" | "video",
      Array<{
        provider: string;
        models: string[];
      }>
    > = {
      image: [
        {
          provider: "openai",
          models: getCapabilityModels(catalogs.openai, "image")
        },
        {
          provider: "anthropic",
          models: getCapabilityModels(catalogs.anthropic, "image")
        }
      ],
      video: [
        {
          provider: "openai",
          models: getCapabilityModels(catalogs.openai, "video")
        },
        {
          provider: "runway",
          models: getCapabilityModels(catalogs.runway, "video")
        },
        {
          provider: "kling",
          models: getCapabilityModels(catalogs.kling, "video")
        }
      ]
    };
    const providersByVideoModel = new Map<string, Set<string>>();
    for (const catalog of capabilityCatalogs.video) {
      for (const model of catalog.models) {
        const providers = providersByVideoModel.get(model) ?? new Set<string>();
        providers.add(catalog.provider);
        providersByVideoModel.set(model, providers);
      }
    }
    for (const entry of entries) {
      if (entry.modelKey === null) {
        continue;
      }
      if (entry.capability === "video") {
        const duplicateProviders = providersByVideoModel.get(entry.modelKey);
        if (duplicateProviders !== undefined && duplicateProviders.size > 1) {
          throw new BadRequestException(
            `"${entry.modelKey}" is ambiguous across active Runtime Admin video models (${Array.from(
              duplicateProviders
            ).join(
              ", "
            )}). Remove duplicate active video model ids in Admin > Runtime before saving plans.`
          );
        }
      }
      const catalog = capabilityCatalogs[entry.capability].flatMap(
        (providerCatalog) => providerCatalog.models
      );
      if (!catalog.includes(entry.modelKey)) {
        throw new BadRequestException(
          `"${entry.modelKey}" must be selected from Runtime Admin ${entry.capability} models.`
        );
      }
    }
  }

  private async assertLifecycleFallbackPlansAreActive(
    input: AdminPlanInput,
    currentPlanCode: string
  ): Promise<void> {
    const fallbackChecks: Array<{ code: string | null; label: string; required: boolean }> = [
      {
        code: input.lifecyclePolicy.trialFallbackPlanCode,
        label: "trial fallback plan",
        required: input.trialEnabled
      },
      {
        code: input.lifecyclePolicy.paidFallbackPlanCode,
        label: "paid fallback plan",
        required: false
      }
    ];

    for (const check of fallbackChecks) {
      if (!check.required && check.code === null) {
        continue;
      }
      if (check.code === null) {
        throw new BadRequestException(`${check.label} must reference an active plan.`);
      }
      if (check.code === currentPlanCode) {
        throw new BadRequestException(`${check.label} must be a different active plan.`);
      }
      const fallbackPlan = await this.planCatalogRepository.findByCode(check.code);
      if (fallbackPlan === null || fallbackPlan.status !== "active") {
        throw new BadRequestException(`${check.label} must reference an active plan.`);
      }
    }
  }

  private toAdminPlanState(plan: AssistantPlanCatalog): AdminPlanState {
    const billingHints =
      plan.billingProviderHints !== null &&
      typeof plan.billingProviderHints === "object" &&
      !Array.isArray(plan.billingProviderHints)
        ? (plan.billingProviderHints as Record<string, unknown>)
        : {};
    const quotaAccountingRaw =
      billingHints.quotaAccounting !== null &&
      typeof billingHints.quotaAccounting === "object" &&
      !Array.isArray(billingHints.quotaAccounting)
        ? (billingHints.quotaAccounting as Record<string, unknown>)
        : {};
    const skillPolicyRaw =
      billingHints.skillPolicy !== null &&
      typeof billingHints.skillPolicy === "object" &&
      !Array.isArray(billingHints.skillPolicy)
        ? (billingHints.skillPolicy as Record<string, unknown>)
        : {};
    const assistantPolicy = parsePlanAssistantPolicy(billingHints.assistantPolicy);
    const lifecyclePolicyRaw =
      billingHints.lifecyclePolicy !== null &&
      typeof billingHints.lifecyclePolicy === "object" &&
      !Array.isArray(billingHints.lifecyclePolicy)
        ? (billingHints.lifecyclePolicy as Record<string, unknown>)
        : {};
    const presentationRaw =
      billingHints.presentation !== null &&
      typeof billingHints.presentation === "object" &&
      !Array.isArray(billingHints.presentation)
        ? (billingHints.presentation as Record<string, unknown>)
        : {};
    const entitlement = plan.entitlementModel;
    const toolClasses = entitlement?.toolClasses ?? [];
    const channelsAndSurfaces = entitlement?.channelsAndSurfaces ?? [];
    const mediaClasses = entitlement?.mediaClasses ?? [];
    const contextPolicy = resolveStoredPlanContextHydrationPolicy(billingHints.contextPolicy);
    const retrievalPolicy = parseAdminPlanRetrievalPolicy(billingHints.retrievalPolicy);
    const sandboxPolicy = resolveStoredPlanSandboxPolicy(billingHints.sandboxPolicy);
    const toolBudgets = resolveStoredPlanToolBudgets(billingHints.toolBudgets);

    return {
      code: plan.code,
      displayName: plan.displayName,
      description: plan.description,
      status: plan.status,
      defaultOnRegistration: plan.isDefaultFirstRegistrationPlan,
      trialEnabled: plan.isTrialPlan,
      trialDurationDays: plan.trialDurationDays,
      lifecyclePolicy: {
        trialFallbackPlanCode: toNullableString(lifecyclePolicyRaw.trialFallbackPlanCode),
        paidFallbackPlanCode: toNullableString(lifecyclePolicyRaw.paidFallbackPlanCode)
      },
      metadata: {
        commercialTag: toNullableString(billingHints.commercialTag),
        notes: toNullableString(billingHints.notes)
      },
      presentation: {
        showOnPricingPage: toBoolean(presentationRaw.showOnPricingPage),
        displayOrder: toNullableNonNegativeInt(presentationRaw.displayOrder) ?? 0,
        highlighted: toBoolean(presentationRaw.highlighted),
        title: parseLocalizedText(presentationRaw.title, "presentation.title"),
        subtitle: parseLocalizedText(presentationRaw.subtitle, "presentation.subtitle"),
        notes: parseLocalizedText(presentationRaw.notes, "presentation.notes"),
        badge: parseLocalizedText(presentationRaw.badge, "presentation.badge"),
        ctaLabel: parseLocalizedText(presentationRaw.ctaLabel, "presentation.ctaLabel"),
        price: {
          amount:
            isRecord(presentationRaw.price) &&
            toNullableNonNegativeInt(presentationRaw.price.amount) !== null
              ? toNullableNonNegativeInt(presentationRaw.price.amount)
              : null,
          currency: isRecord(presentationRaw.price)
            ? parseCurrencyCode(presentationRaw.price.currency, "presentation.price.currency")
            : null,
          billingPeriod: isRecord(presentationRaw.price)
            ? parseBillingPeriod(
                presentationRaw.price.billingPeriod,
                "presentation.price.billingPeriod"
              )
            : null
        },
        highlightItems: parseLocalizedTextList(
          presentationRaw.highlightItems,
          "presentation.highlightItems"
        )
      },
      entitlements: {
        toolClasses: {
          costDrivingTools: hasAllowedFlag(toolClasses, "cost_driving"),
          utilityTools: hasAllowedFlag(toolClasses, "utility"),
          costDrivingQuotaGoverned: hasQuotaGovernedFlag(toolClasses, "cost_driving"),
          utilityQuotaGoverned: hasQuotaGovernedFlag(toolClasses, "utility")
        },
        channelsAndSurfaces: {
          webChat: hasAllowedFlag(channelsAndSurfaces, "web_chat"),
          telegram: hasAllowedFlag(channelsAndSurfaces, "telegram"),
          whatsapp: hasAllowedFlag(channelsAndSurfaces, "whatsapp"),
          max: hasAllowedFlag(channelsAndSurfaces, "max")
        },
        mediaClasses: {
          image: hasAllowedFlag(mediaClasses, "image"),
          audio: hasAllowedFlag(mediaClasses, "audio"),
          video: hasAllowedFlag(mediaClasses, "video"),
          file: hasAllowedFlag(mediaClasses, "file")
        }
      },
      quotaLimits: {
        tokenBudgetLimit: toNullablePositiveInt(quotaAccountingRaw.tokenBudgetLimit),
        activeWebChatsLimit: toNullableNonNegativeInt(quotaAccountingRaw.activeWebChatsLimit),
        messagesPerChat: toNullableNonNegativeInt(quotaAccountingRaw.messagesPerChat),
        imageGenerateMonthlyUnitsLimit: toNullablePositiveInt(
          quotaAccountingRaw.imageGenerateMonthlyUnitsLimit
        ),
        imageEditMonthlyUnitsLimit: toNullablePositiveInt(
          quotaAccountingRaw.imageEditMonthlyUnitsLimit
        ),
        videoGenerateMonthlyUnitsLimit: toNullablePositiveInt(
          quotaAccountingRaw.videoGenerateMonthlyUnitsLimit
        ),
        documentMonthlyUnitsLimit: toNullablePositiveInt(
          quotaAccountingRaw.documentMonthlyUnitsLimit
        ),
        mediaStorageBytesLimit: toNullablePositiveInt(quotaAccountingRaw.mediaStorageBytesLimit),
        knowledgeStorageBytesLimit: toNullablePositiveInt(
          quotaAccountingRaw.knowledgeStorageBytesLimit
        ),
        workspaceStorageBytesLimit: toNullablePositiveInt(
          quotaAccountingRaw.workspaceStorageBytesLimit
        )
      },
      skillPolicy: {
        maxEnabledSkills:
          toNullableNonNegativeInt(skillPolicyRaw.maxEnabledSkills) ??
          readEnabledSkillLimitFromLimitsPermissions(entitlement?.limitsPermissions)
      },
      assistantPolicy,
      contextPolicy,
      retrievalPolicy,
      sandboxPolicy,
      primaryModelKey: toNormalizedNonEmptyModelKey(billingHints.primaryModelKey),
      premiumModelKey: toNormalizedNonEmptyModelKey(billingHints.premiumModelKey),
      reasoningModelKey: toNormalizedNonEmptyModelKey(billingHints.reasoningModelKey),
      systemToolModelKey: toNormalizedNonEmptyModelKey(billingHints.systemToolModelKey),
      retrievalModelKey: toNormalizedNonEmptyModelKey(billingHints.retrievalModelKey),
      embeddingModelKey: toNormalizedNonEmptyModelKey(billingHints.embeddingModelKey),
      imageGenerateModelKey: toNormalizedNonEmptyModelKey(billingHints.imageGenerateModelKey),
      imageGenerateFallbackModelKey: toNormalizedNonEmptyModelKey(
        billingHints.imageGenerateFallbackModelKey
      ),
      imageEditModelKey: toNormalizedNonEmptyModelKey(billingHints.imageEditModelKey),
      imageEditFallbackModelKey: toNormalizedNonEmptyModelKey(
        billingHints.imageEditFallbackModelKey
      ),
      videoGenerateModelKey: toNormalizedNonEmptyModelKey(billingHints.videoGenerateModelKey),
      videoGenerateFallbackModelKey: toNormalizedNonEmptyModelKey(
        billingHints.videoGenerateFallbackModelKey
      ),
      runtimeTierDefault: parseRuntimeTier(billingHints.runtimeTierDefault),
      toolActivations: plan.toolActivations.map((ta) => ({
        toolCode: ta.toolCode,
        displayName: normalizePlanToolDisplayName(ta.toolCode, ta.displayName),
        toolClass: ta.toolClass,
        policyClass: ta.policyClass,
        active: ta.activationStatus === "active",
        dailyCallLimit: ta.dailyCallLimit,
        perTurnCap: ta.perTurnCap,
        visibleInPlanEditor: ta.policyClass === "plan_managed"
      })),
      toolBudgets,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString()
    };
  }
}
