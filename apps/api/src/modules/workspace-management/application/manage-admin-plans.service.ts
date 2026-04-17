import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  PERSAI_RUNTIME_VIDEO_GENERATE_MODEL_KEYS,
  isPersaiRuntimeVideoGenerateModelKey,
  type PersaiRuntimeVideoGenerateModelKey
} from "@persai/runtime-contract";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository,
  type AssistantPlanCatalogWriteInput
} from "../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalog } from "../domain/assistant-plan-catalog.entity";
import type {
  AdminCreatePlanInput,
  AdminPlanInput,
  AdminPlanState,
  AdminPlanRuntimeTier,
  AdminPlanToolActivationInput
} from "./admin-plan-management.types";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
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
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { isPlanManagedTool } from "../../../../prisma/tool-catalog-data";

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

function toVideoGenerateModelKey(value: unknown): PersaiRuntimeVideoGenerateModelKey | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return isPersaiRuntimeVideoGenerateModelKey(trimmed) ? trimmed : null;
}

function parseVideoGenerateModelKey(value: unknown): PersaiRuntimeVideoGenerateModelKey | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const modelKey = toVideoGenerateModelKey(value);
  if (modelKey !== null) {
    return modelKey;
  }
  throw new BadRequestException(
    `videoGenerateModelKey must be one of ${PERSAI_RUNTIME_VIDEO_GENERATE_MODEL_KEYS.join(", ")}, or null.`
  );
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

function toNullablePositiveInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return null;
}

function parseObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an object.`);
  }
  return value as Record<string, unknown>;
}

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

function normalizePlanToolDisplayName(toolCode: string, displayName: string): string {
  if (toolCode === "memory_search") {
    return "Knowledge Search";
  }
  if (toolCode === "memory_get") {
    return "Knowledge Fetch";
  }
  return displayName;
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
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService
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
      input.retrievalModelKey
    ]);

    const created = await this.planCatalogRepository.create(input.code, this.toWriteInput(input));
    await this.bumpConfigGenerationService.execute();
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
        legacyOwnerFallback: access.hasLegacyOwnerFallback,
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
    input: AdminPlanInput,
    stepUpToken: string | null
  ): Promise<AdminPlanState> {
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.plan.update",
      stepUpToken
    );
    const normalizedCode = parseRequiredString(code, "code").toLowerCase();
    const updated = await this.planCatalogRepository.updateByCode(
      normalizedCode,
      this.toWriteInput(input)
    );
    if (updated === null) {
      throw new NotFoundException("Plan not found.");
    }
    await this.assertModelKeysAvailable([
      input.primaryModelKey,
      input.premiumModelKey,
      input.reasoningModelKey,
      input.retrievalModelKey
    ]);
    await this.bumpConfigGenerationService.execute();
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
        legacyOwnerFallback: access.hasLegacyOwnerFallback,
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
    await this.bumpConfigGenerationService.execute();
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
        legacyOwnerFallback: access.hasLegacyOwnerFallback,
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
    const quotaLimitsRaw =
      parsed.quotaLimits !== undefined && parsed.quotaLimits !== null
        ? parseObject(parsed.quotaLimits, "quotaLimits")
        : {};
    const contextPolicy =
      parsed.contextPolicy === undefined || parsed.contextPolicy === null
        ? createDefaultPlanContextHydrationPolicy()
        : parsePlanContextHydrationPolicy(parsed.contextPolicy, "contextPolicy");

    const toolActivations = this.parseToolActivations(parsed.toolActivations);

    const result: AdminPlanInput = {
      displayName: parseRequiredString(parsed.displayName, "displayName"),
      description: toNullableString(parsed.description),
      status,
      defaultOnRegistration: toBoolean(parsed.defaultOnRegistration),
      trialEnabled,
      trialDurationDays: parseTrialDuration(parsed.trialDurationDays, trialEnabled),
      metadata: {
        commercialTag: toNullableString(metadata.commercialTag),
        notes: toNullableString(metadata.notes)
      },
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
        mediaStorageBytesLimit: toNullablePositiveInt(quotaLimitsRaw.mediaStorageBytesLimit),
        workspaceStorageBytesLimit: toNullablePositiveInt(quotaLimitsRaw.workspaceStorageBytesLimit)
      },
      contextPolicy,
      primaryModelKey: toNullableString(parsed.primaryModelKey),
      premiumModelKey: toNullableString(parsed.premiumModelKey),
      reasoningModelKey: toNullableString(parsed.reasoningModelKey),
      retrievalModelKey: toNullableString(parsed.retrievalModelKey),
      videoGenerateModelKey: parseVideoGenerateModelKey(parsed.videoGenerateModelKey),
      runtimeTierDefault: parseRuntimeTier(parsed.runtimeTierDefault)
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
      return { toolCode, active, dailyCallLimit };
    });
  }

  private toWriteInput(input: AdminPlanInput): AssistantPlanCatalogWriteInput {
    const quotaAccounting: Record<string, unknown> = {};
    if (input.quotaLimits.tokenBudgetLimit !== null) {
      quotaAccounting.tokenBudgetLimit = input.quotaLimits.tokenBudgetLimit;
    }
    if (input.quotaLimits.mediaStorageBytesLimit !== null) {
      quotaAccounting.mediaStorageBytesLimit = input.quotaLimits.mediaStorageBytesLimit;
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
        ...(Object.keys(quotaAccounting).length > 0 ? { quotaAccounting } : {}),
        contextPolicy: toPlanContextHydrationPolicyDocument(input.contextPolicy),
        ...(input.primaryModelKey !== null ? { primaryModelKey: input.primaryModelKey } : {}),
        ...(input.premiumModelKey !== null ? { premiumModelKey: input.premiumModelKey } : {}),
        ...(input.reasoningModelKey !== null ? { reasoningModelKey: input.reasoningModelKey } : {}),
        ...(input.retrievalModelKey !== null ? { retrievalModelKey: input.retrievalModelKey } : {}),
        ...(input.videoGenerateModelKey !== null
          ? { videoGenerateModelKey: input.videoGenerateModelKey }
          : {}),
        ...(input.runtimeTierDefault !== null
          ? { runtimeTierDefault: input.runtimeTierDefault }
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
        limitsPermissions: []
      },
      toolActivationOverrides: (input.toolActivations ?? []).map((ta) => ({
        toolCode: ta.toolCode,
        active: ta.active,
        dailyCallLimit: ta.dailyCallLimit
      }))
    };
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
    const entitlement = plan.entitlementModel;
    const toolClasses = entitlement?.toolClasses ?? [];
    const channelsAndSurfaces = entitlement?.channelsAndSurfaces ?? [];
    const mediaClasses = entitlement?.mediaClasses ?? [];
    const contextPolicy = resolveStoredPlanContextHydrationPolicy(billingHints.contextPolicy);

    return {
      code: plan.code,
      displayName: plan.displayName,
      description: plan.description,
      status: plan.status,
      defaultOnRegistration: plan.isDefaultFirstRegistrationPlan,
      trialEnabled: plan.isTrialPlan,
      trialDurationDays: plan.trialDurationDays,
      metadata: {
        commercialTag: toNullableString(billingHints.commercialTag),
        notes: toNullableString(billingHints.notes)
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
        mediaStorageBytesLimit: toNullablePositiveInt(quotaAccountingRaw.mediaStorageBytesLimit),
        workspaceStorageBytesLimit: toNullablePositiveInt(
          quotaAccountingRaw.workspaceStorageBytesLimit
        )
      },
      contextPolicy,
      primaryModelKey: toNullableString(billingHints.primaryModelKey),
      premiumModelKey: toNullableString(billingHints.premiumModelKey),
      reasoningModelKey: toNullableString(billingHints.reasoningModelKey),
      retrievalModelKey: toNullableString(billingHints.retrievalModelKey),
      videoGenerateModelKey: toVideoGenerateModelKey(billingHints.videoGenerateModelKey),
      runtimeTierDefault: parseRuntimeTier(billingHints.runtimeTierDefault),
      toolActivations: plan.toolActivations.map((ta) => ({
        toolCode: ta.toolCode,
        displayName: normalizePlanToolDisplayName(ta.toolCode, ta.displayName),
        toolClass: ta.toolClass,
        policyClass: ta.policyClass,
        active: ta.activationStatus === "active",
        dailyCallLimit: ta.dailyCallLimit,
        visibleInPlanEditor: ta.policyClass === "plan_managed"
      })),
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString()
    };
  }
}
