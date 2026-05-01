import assert from "node:assert/strict";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ManageAdminPlansService } from "../src/modules/workspace-management/application/manage-admin-plans.service";
import type { AssistantPlanCatalog } from "../src/modules/workspace-management/domain/assistant-plan-catalog.entity";

function createService(overrides?: {
  planCatalogRepository?: object;
  appendAssistantAuditEventService?: object;
  adminAuthorizationService?: object;
  bumpConfigGenerationService?: object;
  resolvePlatformRuntimeProviderSettingsService?: object;
}): ManageAdminPlansService {
  return new ManageAdminPlansService(
    (overrides?.planCatalogRepository ?? {}) as never,
    (overrides?.appendAssistantAuditEventService ?? {}) as never,
    (overrides?.adminAuthorizationService ?? {}) as never,
    (overrides?.bumpConfigGenerationService ?? {}) as never,
    (overrides?.resolvePlatformRuntimeProviderSettingsService ?? {}) as never
  );
}

async function run(): Promise<void> {
  const service = createService();
  const contextPolicy = {
    preset: "balanced" as const,
    targetContextBudget: 24000,
    compactionTriggerThreshold: 8000,
    keepRecentMinimum: 4,
    knowledgeHydrationBudget: 2400,
    autoCompactionWeb: false,
    autoCompactionTelegram: true,
    crossSessionCarryOverTtlDays: 7,
    crossSessionCarryOverIdleHours: 4,
    crossSessionCarryOverCooldownHours: 12
  };
  const retrievalPolicyForTest = {
    defaultMaxResults: 5,
    maxMaxResults: 8,
    lexicalCandidateLimit: 60,
    vectorCandidateLimit: 240,
    knowledgeFetchWindowRadius: 1,
    chatFetchWindowRadius: 2,
    fetchMaxChars: 6000,
    helperEnabled: true,
    helperCandidateLimit: 6,
    helperMaxOutputTokens: 220,
    embeddingSearchEnabled: true
  };

  const parsed = service.parseUpdateInput({
    displayName: "Starter",
    description: "Trial plan",
    status: "active",
    defaultOnRegistration: true,
    trialEnabled: true,
    trialDurationDays: 7,
    metadata: {
      commercialTag: "trial",
      notes: null
    },
    entitlements: {
      toolClasses: {
        costDrivingTools: false,
        utilityTools: true,
        costDrivingQuotaGoverned: true,
        utilityQuotaGoverned: true
      },
      channelsAndSurfaces: {
        webChat: true,
        telegram: true,
        whatsapp: false,
        max: false
      },
      mediaClasses: {
        image: false,
        audio: false,
        video: false,
        file: false
      }
    },
    quotaLimits: {
      tokenBudgetLimit: 1000,
      knowledgeStorageBytesLimit: 4096
    },
    skillPolicy: {
      maxEnabledSkills: 2
    },
    contextPolicy,
    primaryModelKey: null,
    imageGenerateModelKey: "gpt-image-2",
    imageGenerateFallbackModelKey: "gpt-image-1.5",
    imageEditModelKey: "gpt-image-2",
    imageEditFallbackModelKey: "gpt-image-1.5",
    videoGenerateModelKey: "sora-2-pro",
    videoGenerateFallbackModelKey: "sora-2",
    runtimeTierDefault: "free_shared_restricted",
    toolActivations: [
      {
        toolCode: "memory_get",
        active: true,
        dailyCallLimit: null
      }
    ]
  });

  assert.equal(parsed.toolActivations?.[0]?.toolCode, "memory_get");
  assert.equal(parsed.imageGenerateFallbackModelKey, "gpt-image-1.5");
  assert.equal(parsed.imageEditFallbackModelKey, "gpt-image-1.5");
  assert.equal(parsed.videoGenerateModelKey, "sora-2-pro");
  assert.equal(parsed.videoGenerateFallbackModelKey, "sora-2");
  assert.equal(parsed.contextPolicy.preset, "balanced");

  const writeInput = (
    service as unknown as {
      toWriteInput(input: typeof parsed): { billingProviderHints: unknown };
    }
  ).toWriteInput(parsed);
  assert.equal(
    (writeInput.billingProviderHints as Record<string, unknown>).imageGenerateFallbackModelKey,
    "gpt-image-1.5"
  );
  assert.equal(
    (writeInput.billingProviderHints as Record<string, unknown>).imageEditFallbackModelKey,
    "gpt-image-1.5"
  );
  assert.equal(
    (writeInput.billingProviderHints as Record<string, unknown>).videoGenerateModelKey,
    "sora-2-pro"
  );
  assert.equal(
    (writeInput.billingProviderHints as Record<string, unknown>).videoGenerateFallbackModelKey,
    "sora-2"
  );
  assert.deepEqual((writeInput.billingProviderHints as Record<string, unknown>).quotaAccounting, {
    tokenBudgetLimit: 1000,
    knowledgeStorageBytesLimit: 4096
  });
  assert.deepEqual((writeInput.billingProviderHints as Record<string, unknown>).skillPolicy, {
    maxEnabledSkills: 2
  });
  assert.deepEqual((writeInput.billingProviderHints as Record<string, unknown>).contextPolicy, {
    schema: "persai.planContextHydration.v1",
    ...contextPolicy
  });

  const state = (
    service as unknown as {
      toAdminPlanState(plan: AssistantPlanCatalog): {
        imageGenerateFallbackModelKey: string | null;
        imageEditFallbackModelKey: string | null;
        videoGenerateModelKey: string | null;
        videoGenerateFallbackModelKey: string | null;
        contextPolicy: { preset: string };
        quotaLimits: { knowledgeStorageBytesLimit: number | null };
        skillPolicy: { maxEnabledSkills: number | null };
      };
    }
  ).toAdminPlanState({
    id: "plan-1",
    code: "starter",
    displayName: "Starter",
    description: "Trial plan",
    status: "active",
    billingProviderHints: writeInput.billingProviderHints,
    entitlementModel: null,
    toolActivations: [],
    isDefaultFirstRegistrationPlan: true,
    isTrialPlan: true,
    trialDurationDays: 7,
    createdAt: new Date("2026-04-14T12:00:00.000Z"),
    updatedAt: new Date("2026-04-14T12:00:00.000Z")
  });
  assert.equal(state.imageGenerateFallbackModelKey, "gpt-image-1.5");
  assert.equal(state.imageEditFallbackModelKey, "gpt-image-1.5");
  assert.equal(state.videoGenerateModelKey, "sora-2-pro");
  assert.equal(state.videoGenerateFallbackModelKey, "sora-2");
  assert.equal(state.contextPolicy.preset, "balanced");
  assert.equal(state.quotaLimits.knowledgeStorageBytesLimit, 4096);
  assert.equal(state.skillPolicy.maxEnabledSkills, 2);

  const zeroSkillLimitParsed = service.parseUpdateInput({
    ...parsed,
    skillPolicy: {
      maxEnabledSkills: 0
    }
  });
  const zeroSkillLimitWriteInput = (
    service as unknown as {
      toWriteInput(input: typeof zeroSkillLimitParsed): { billingProviderHints: unknown };
    }
  ).toWriteInput(zeroSkillLimitParsed);
  assert.deepEqual(
    (zeroSkillLimitWriteInput.billingProviderHints as Record<string, unknown>).skillPolicy,
    {
      maxEnabledSkills: 0
    }
  );
  assert.equal(
    (
      service as unknown as {
        toAdminPlanState(plan: AssistantPlanCatalog): {
          skillPolicy: { maxEnabledSkills: number | null };
        };
      }
    ).toAdminPlanState({
      id: "plan-zero-skills",
      code: "zero-skills",
      displayName: "Zero Skills",
      description: null,
      status: "active",
      billingProviderHints: zeroSkillLimitWriteInput.billingProviderHints,
      entitlementModel: null,
      toolActivations: [],
      isDefaultFirstRegistrationPlan: false,
      isTrialPlan: false,
      trialDurationDays: null,
      createdAt: new Date("2026-04-14T12:00:00.000Z"),
      updatedAt: new Date("2026-04-14T12:00:00.000Z")
    }).skillPolicy.maxEnabledSkills,
    0
  );
  const normalizedState = (
    service as unknown as {
      toAdminPlanState(plan: AssistantPlanCatalog): {
        toolActivations: Array<{ toolCode: string; displayName: string }>;
      };
    }
  ).toAdminPlanState({
    id: "plan-2",
    code: "knowledge",
    displayName: "Knowledge",
    description: null,
    status: "active",
    billingProviderHints: null,
    entitlementModel: null,
    toolActivations: [
      {
        toolCode: "memory_search",
        displayName: "Memory Search",
        toolClass: "utility",
        policyClass: "plan_managed",
        activationStatus: "active",
        dailyCallLimit: null
      },
      {
        toolCode: "memory_get",
        displayName: "Memory Get",
        toolClass: "utility",
        policyClass: "plan_managed",
        activationStatus: "active",
        dailyCallLimit: null
      }
    ],
    isDefaultFirstRegistrationPlan: false,
    isTrialPlan: false,
    trialDurationDays: null,
    createdAt: new Date("2026-04-14T12:00:00.000Z"),
    updatedAt: new Date("2026-04-14T12:00:00.000Z")
  });
  assert.deepEqual(
    normalizedState.toolActivations.map((tool) => [tool.toolCode, tool.displayName]),
    [
      ["memory_search", "Knowledge Search"],
      ["memory_get", "Knowledge Fetch"]
    ]
  );

  const parsedWithSummaryBudget = service.parseUpdateInput({
    displayName: "Starter",
    description: "Trial plan",
    status: "active",
    defaultOnRegistration: true,
    trialEnabled: true,
    trialDurationDays: 7,
    metadata: {
      commercialTag: "trial",
      notes: null
    },
    entitlements: {
      toolClasses: {
        costDrivingTools: false,
        utilityTools: true,
        costDrivingQuotaGoverned: true,
        utilityQuotaGoverned: true
      },
      channelsAndSurfaces: {
        webChat: true,
        telegram: true,
        whatsapp: false,
        max: false
      },
      mediaClasses: {
        image: false,
        audio: false,
        video: false,
        file: false
      }
    },
    quotaLimits: {
      tokenBudgetLimit: 1000,
      knowledgeStorageBytesLimit: 4096
    },
    contextPolicy: {
      ...contextPolicy,
      sharedCompactionSummaryBudgetTokens: 1200
    },
    primaryModelKey: null,
    imageGenerateFallbackModelKey: null,
    imageEditFallbackModelKey: null,
    videoGenerateModelKey: null,
    videoGenerateFallbackModelKey: null,
    runtimeTierDefault: "free_shared_restricted"
  });
  assert.equal(parsedWithSummaryBudget.contextPolicy.sharedCompactionSummaryBudgetTokens, 1200);
  const writeInputWithSummaryBudget = (
    service as unknown as {
      toWriteInput(input: typeof parsedWithSummaryBudget): { billingProviderHints: unknown };
    }
  ).toWriteInput(parsedWithSummaryBudget);
  assert.deepEqual(
    (writeInputWithSummaryBudget.billingProviderHints as Record<string, unknown>).contextPolicy,
    {
      schema: "persai.planContextHydration.v1",
      ...contextPolicy,
      sharedCompactionSummaryBudgetTokens: 1200
    }
  );
  assert.equal(
    (
      writeInput as {
        toolActivationOverrides: Array<{
          toolCode: string;
          active: boolean;
          dailyCallLimit: number | null;
        }>;
      }
    ).toolActivationOverrides.some(
      (activation) =>
        activation.toolCode === "files" &&
        activation.active === true &&
        activation.dailyCallLimit === null
    ),
    true
  );
  assert.equal(
    (
      writeInput as {
        toolActivationOverrides: Array<{
          toolCode: string;
          active: boolean;
          dailyCallLimit: number | null;
        }>;
      }
    ).toolActivationOverrides.some(
      (activation) =>
        activation.toolCode === "memory_get" &&
        activation.active === true &&
        activation.dailyCallLimit === null
    ),
    true
  );

  let updatedWriteInput: Record<string, unknown> | null = null;
  const partialUpdateService = createService({
    planCatalogRepository: {
      async findByCode(code: string) {
        assert.equal(code, "starter");
        return {
          id: "plan-existing",
          code: "starter",
          displayName: "Starter",
          description: "Existing starter plan",
          status: "active",
          billingProviderHints: {
            schema: "persai.billingHints.v1",
            providerAgnostic: true,
            notes: "keep me",
            contextPolicy: {
              schema: "persai.planContextHydration.v1",
              ...contextPolicy
            },
            retrievalPolicy: {
              ...retrievalPolicyForTest
            },
            sandboxPolicy: {
              schema: "persai.planSandboxPolicy.v1",
              enabled: true,
              maxSingleFileWriteBytes: 4096,
              maxWorkspaceBytesPerJob: 8192,
              maxPersistedArtifactsPerJob: 4,
              maxFileCountPerJob: 32,
              maxDirectoryCountPerJob: 16,
              maxProcessRuntimeMs: 15000,
              maxCpuMsPerJob: 15000,
              maxMemoryBytesPerJob: 268435456,
              maxConcurrentProcesses: 4,
              maxStdoutBytes: 131072,
              maxStderrBytes: 131072,
              networkAccessEnabled: false,
              artifactMimeAllowlist: ["text/plain"],
              webMaxOutboundBytes: 26214400,
              telegramMaxOutboundBytes: 52428800,
              sandboxJobsPerDay: null,
              maxArtifactSendCountPerTurn: 4
            }
          },
          entitlementModel: {
            schemaVersion: 1,
            capabilities: [],
            toolClasses: [
              { key: "cost_driving", allowed: false, quotaGoverned: true },
              { key: "utility", allowed: true, quotaGoverned: true }
            ],
            channelsAndSurfaces: [
              { key: "web_chat", allowed: true },
              { key: "telegram", allowed: true },
              { key: "whatsapp", allowed: false },
              { key: "max", allowed: false }
            ],
            mediaClasses: [
              { key: "image", allowed: false },
              { key: "audio", allowed: false },
              { key: "video", allowed: false },
              { key: "file", allowed: false }
            ],
            limitsPermissions: []
          },
          toolActivations: [
            {
              toolCode: "files",
              displayName: "Files",
              toolClass: "utility",
              policyClass: "plan_managed",
              activationStatus: "active",
              dailyCallLimit: 12
            },
            {
              toolCode: "shell",
              displayName: "Shell",
              toolClass: "cost_driving",
              policyClass: "plan_managed",
              activationStatus: "inactive",
              dailyCallLimit: null
            }
          ],
          isDefaultFirstRegistrationPlan: false,
          isTrialPlan: false,
          trialDurationDays: null,
          createdAt: new Date("2026-04-14T12:00:00.000Z"),
          updatedAt: new Date("2026-04-14T12:00:00.000Z")
        } satisfies AssistantPlanCatalog;
      },
      async updateByCode(code: string, input: Record<string, unknown>) {
        assert.equal(code, "starter");
        updatedWriteInput = input;
        return {
          id: "plan-existing",
          code: "starter",
          displayName: "Starter patched",
          description: "Existing starter plan",
          status: "active",
          billingProviderHints: (input as { billingProviderHints: Record<string, unknown> | null })
            .billingProviderHints,
          entitlementModel: null,
          toolActivations: [],
          isDefaultFirstRegistrationPlan: false,
          isTrialPlan: false,
          trialDurationDays: null,
          createdAt: new Date("2026-04-14T12:00:00.000Z"),
          updatedAt: new Date("2026-04-14T12:00:00.000Z")
        } satisfies AssistantPlanCatalog;
      }
    },
    appendAssistantAuditEventService: {
      async execute() {
        return undefined;
      }
    },
    adminAuthorizationService: {
      async assertCanPerformDangerousAdminAction() {
        return {
          workspaceId: "ws-1",
          roles: ["business_admin"],
          hasLegacyOwnerFallback: false
        };
      }
    },
    bumpConfigGenerationService: {
      async execute() {
        return undefined;
      }
    },
    resolvePlatformRuntimeProviderSettingsService: {
      async execute() {
        return {
          availableModelsByProvider: {
            openai: [],
            anthropic: []
          },
          availableModelCatalogByProvider: {
            openai: { chat: [], image: [], video: [] },
            anthropic: { chat: [], image: [], video: [] }
          }
        };
      }
    }
  });
  await partialUpdateService.updatePlan(
    "admin-user",
    "starter",
    {
      displayName: "Starter patched",
      metadata: {
        notes: "patched notes"
      }
    },
    "step-up"
  );
  assert.equal(updatedWriteInput?.displayName, "Starter patched");
  assert.equal(
    (
      updatedWriteInput?.billingProviderHints as {
        notes?: string | null;
        sandboxPolicy?: { enabled?: boolean };
        retrievalPolicy?: { defaultMaxResults?: number };
      }
    ).notes,
    "patched notes"
  );
  assert.equal(
    (
      updatedWriteInput?.billingProviderHints as {
        sandboxPolicy?: { enabled?: boolean };
      }
    ).sandboxPolicy?.enabled,
    true
  );
  assert.equal(
    (
      updatedWriteInput?.billingProviderHints as {
        retrievalPolicy?: { defaultMaxResults?: number };
      }
    ).retrievalPolicy?.defaultMaxResults,
    retrievalPolicyForTest.defaultMaxResults
  );
  assert.equal(
    (
      updatedWriteInput as {
        toolActivationOverrides?: Array<{
          toolCode: string;
          active: boolean;
          dailyCallLimit: number | null;
        }>;
      }
    ).toolActivationOverrides?.some(
      (activation) =>
        activation.toolCode === "files" &&
        activation.active === true &&
        activation.dailyCallLimit === 12
    ),
    true
  );

  assert.throws(
    () =>
      service.parseUpdateInput({
        displayName: "Starter",
        description: "Trial plan",
        status: "active",
        defaultOnRegistration: true,
        trialEnabled: true,
        trialDurationDays: 7,
        metadata: {
          commercialTag: "trial",
          notes: null
        },
        entitlements: {
          toolClasses: {
            costDrivingTools: false,
            utilityTools: true,
            costDrivingQuotaGoverned: true,
            utilityQuotaGoverned: true
          },
          channelsAndSurfaces: {
            webChat: true,
            telegram: true,
            whatsapp: false,
            max: false
          },
          mediaClasses: {
            image: false,
            audio: false,
            video: false,
            file: false
          }
        },
        quotaLimits: {
          tokenBudgetLimit: 1000
        },
        contextPolicy: {
          ...contextPolicy,
          sharedCompactionSummaryBudgetTokens: 25000
        },
        primaryModelKey: null,
        runtimeTierDefault: "free_shared_restricted"
      }),
    (error) =>
      error instanceof BadRequestException &&
      error.message.includes("sharedCompactionSummaryBudgetTokens")
  );

  assert.throws(
    () =>
      service.parseUpdateInput({
        displayName: "Starter",
        description: "Trial plan",
        status: "active",
        defaultOnRegistration: true,
        trialEnabled: true,
        trialDurationDays: 7,
        metadata: {
          commercialTag: "trial",
          notes: null
        },
        entitlements: {
          toolClasses: {
            costDrivingTools: false,
            utilityTools: true,
            costDrivingQuotaGoverned: true,
            utilityQuotaGoverned: true
          },
          channelsAndSurfaces: {
            webChat: true,
            telegram: true,
            whatsapp: false,
            max: false
          },
          mediaClasses: {
            image: false,
            audio: false,
            video: false,
            file: false
          }
        },
        quotaLimits: {
          tokenBudgetLimit: 1000
        },
        contextPolicy,
        primaryModelKey: null,
        videoGenerateModelKey: 42,
        runtimeTierDefault: "free_shared_restricted"
      }),
    (error) =>
      error instanceof BadRequestException && error.message.includes("videoGenerateModelKey")
  );

  assert.throws(
    () =>
      service.parseUpdateInput({
        displayName: "Starter",
        description: "Trial plan",
        status: "active",
        defaultOnRegistration: true,
        trialEnabled: true,
        trialDurationDays: 7,
        metadata: {
          commercialTag: "trial",
          notes: null
        },
        entitlements: {
          toolClasses: {
            costDrivingTools: false,
            utilityTools: true,
            costDrivingQuotaGoverned: true,
            utilityQuotaGoverned: true
          },
          channelsAndSurfaces: {
            webChat: true,
            telegram: true,
            whatsapp: false,
            max: false
          },
          mediaClasses: {
            image: false,
            audio: false,
            video: false,
            file: false
          }
        },
        quotaLimits: {
          tokenBudgetLimit: 1000
        },
        contextPolicy,
        primaryModelKey: null,
        runtimeTierDefault: "free_shared_restricted",
        toolActivations: [
          {
            toolCode: "cron",
            active: true,
            dailyCallLimit: null
          }
        ]
      }),
    (error) =>
      error instanceof BadRequestException && error.message.includes('"cron" is not plan-managed')
  );

  assert.throws(
    () =>
      service.parseUpdateInput({
        displayName: "Starter",
        description: "Trial plan",
        status: "active",
        defaultOnRegistration: true,
        trialEnabled: true,
        trialDurationDays: 7,
        metadata: {
          commercialTag: "trial",
          notes: null
        },
        entitlements: {
          toolClasses: {
            costDrivingTools: false,
            utilityTools: true,
            costDrivingQuotaGoverned: true,
            utilityQuotaGoverned: true
          },
          channelsAndSurfaces: {
            webChat: true,
            telegram: true,
            whatsapp: false,
            max: false
          },
          mediaClasses: {
            image: false,
            audio: false,
            video: false,
            file: false
          }
        },
        quotaLimits: {
          tokenBudgetLimit: 1000
        },
        contextPolicy,
        primaryModelKey: null,
        runtimeTierDefault: "free_shared_restricted",
        toolActivations: [
          {
            toolCode: "persai_workspace_attach",
            active: false,
            dailyCallLimit: null
          }
        ]
      }),
    (error) =>
      error instanceof BadRequestException &&
      error.message.includes('"persai_workspace_attach" is not plan-managed')
  );

  let deletedCode: string | null = null;
  let bumped = 0;
  let auditedCode: string | null = null;
  const deleteService = createService({
    planCatalogRepository: {
      async getDeleteImpactByCode(code: string) {
        return code === "legacy"
          ? {
              isDefaultRegistrationPlan: false,
              workspaceSubscriptionCount: 0,
              assistantOverrideCount: 0,
              assistantFallbackCount: 0
            }
          : null;
      },
      async deleteByCode(code: string) {
        deletedCode = code;
        return true;
      }
    },
    appendAssistantAuditEventService: {
      async execute(input: { details?: { code?: string } }) {
        auditedCode = input.details?.code ?? null;
      }
    },
    adminAuthorizationService: {
      async assertCanPerformDangerousAdminAction() {
        return {
          workspaceId: "ws-1",
          roles: ["business_admin"],
          hasLegacyOwnerFallback: false
        };
      }
    },
    bumpConfigGenerationService: {
      async execute() {
        bumped += 1;
      }
    }
  });
  await deleteService.deletePlan("admin-user", "legacy", "step-up");
  assert.equal(deletedCode, "legacy");
  assert.equal(bumped, 1);
  assert.equal(auditedCode, "legacy");

  const blockedDeleteService = createService({
    planCatalogRepository: {
      async getDeleteImpactByCode() {
        return {
          isDefaultRegistrationPlan: false,
          workspaceSubscriptionCount: 1,
          assistantOverrideCount: 0,
          assistantFallbackCount: 2
        };
      }
    },
    adminAuthorizationService: {
      async assertCanPerformDangerousAdminAction() {
        return {
          workspaceId: "ws-1",
          roles: ["business_admin"],
          hasLegacyOwnerFallback: false
        };
      }
    }
  });
  await assert.rejects(
    () => blockedDeleteService.deletePlan("admin-user", "starter", "step-up"),
    (error) =>
      error instanceof ConflictException &&
      error.message.includes("workspace subscription") &&
      error.message.includes("assistant fallback binding")
  );

  // ADR-074 Slice L1 — admin can override per-tool perTurnCap and per-mode
  // tool-loop limits. Both parsed-input shape and on-disk billingProviderHints
  // shape are part of the contract that the runtime bundle compile pipeline
  // and admin UI both depend on, so we lock them down here.
  const parsedWithToolBudgets = service.parseUpdateInput({
    displayName: "Starter",
    description: "Trial plan",
    status: "active",
    defaultOnRegistration: true,
    trialEnabled: true,
    trialDurationDays: 7,
    metadata: {
      commercialTag: "trial",
      notes: null
    },
    entitlements: {
      toolClasses: {
        costDrivingTools: false,
        utilityTools: true,
        costDrivingQuotaGoverned: true,
        utilityQuotaGoverned: true
      },
      channelsAndSurfaces: {
        webChat: true,
        telegram: true,
        whatsapp: false,
        max: false
      },
      mediaClasses: {
        image: false,
        audio: false,
        video: false,
        file: false
      }
    },
    quotaLimits: {
      tokenBudgetLimit: 1000
    },
    contextPolicy,
    primaryModelKey: null,
    runtimeTierDefault: "free_shared_restricted",
    toolActivations: [
      {
        toolCode: "web_fetch",
        active: true,
        dailyCallLimit: 10,
        perTurnCap: 7
      }
    ],
    toolBudgets: {
      loopLimitByMode: { normal: 3, premium: null, reasoning: 9 }
    }
  });
  assert.equal(
    parsedWithToolBudgets.toolActivations?.[0]?.perTurnCap,
    7,
    "perTurnCap survives parseUpdateInput"
  );
  assert.deepEqual(parsedWithToolBudgets.toolBudgets, {
    loopLimitByMode: { normal: 3, premium: null, reasoning: 9 }
  });

  const writeInputWithToolBudgets = (
    service as unknown as {
      toWriteInput(input: typeof parsedWithToolBudgets): {
        billingProviderHints: Record<string, unknown>;
        toolActivationOverrides: Array<{
          toolCode: string;
          active: boolean;
          dailyCallLimit: number | null;
          perTurnCap: number | null;
        }>;
      };
    }
  ).toWriteInput(parsedWithToolBudgets);
  const webFetchOverride = writeInputWithToolBudgets.toolActivationOverrides.find(
    (entry) => entry.toolCode === "web_fetch"
  );
  assert.ok(webFetchOverride, "web_fetch override is emitted");
  assert.equal(webFetchOverride.perTurnCap, 7);
  assert.equal(webFetchOverride.dailyCallLimit, 10);
  assert.deepEqual(writeInputWithToolBudgets.billingProviderHints.toolBudgets, {
    schema: "persai.toolBudgets.v1",
    loopLimitByMode: { normal: 3, premium: null, reasoning: 9 }
  });

  // When all loop limits are null we deliberately omit the toolBudgets key
  // so the runtime bundle stays minimal (runtime treats absence and all-null
  // identically).
  const parsedNoBudgets = service.parseUpdateInput({
    displayName: "Starter",
    description: "Trial plan",
    status: "active",
    defaultOnRegistration: true,
    trialEnabled: true,
    trialDurationDays: 7,
    metadata: { commercialTag: "trial", notes: null },
    entitlements: {
      toolClasses: {
        costDrivingTools: false,
        utilityTools: true,
        costDrivingQuotaGoverned: true,
        utilityQuotaGoverned: true
      },
      channelsAndSurfaces: { webChat: true, telegram: true, whatsapp: false, max: false },
      mediaClasses: { image: false, audio: false, video: false, file: false }
    },
    quotaLimits: { tokenBudgetLimit: 1000 },
    contextPolicy,
    primaryModelKey: null,
    runtimeTierDefault: "free_shared_restricted"
  });
  const writeInputNoBudgets = (
    service as unknown as {
      toWriteInput(input: typeof parsedNoBudgets): {
        billingProviderHints: Record<string, unknown>;
      };
    }
  ).toWriteInput(parsedNoBudgets);
  assert.equal(
    "toolBudgets" in writeInputNoBudgets.billingProviderHints,
    false,
    "billingProviderHints.toolBudgets is omitted when there is no override"
  );

  // Strict parser rejects non-positive perTurnCap on a tool activation.
  assert.throws(
    () =>
      service.parseUpdateInput({
        displayName: "Starter",
        description: "Trial plan",
        status: "active",
        defaultOnRegistration: true,
        trialEnabled: true,
        trialDurationDays: 7,
        metadata: { commercialTag: "trial", notes: null },
        entitlements: {
          toolClasses: {
            costDrivingTools: false,
            utilityTools: true,
            costDrivingQuotaGoverned: true,
            utilityQuotaGoverned: true
          },
          channelsAndSurfaces: { webChat: true, telegram: true, whatsapp: false, max: false },
          mediaClasses: { image: false, audio: false, video: false, file: false }
        },
        quotaLimits: { tokenBudgetLimit: 1000 },
        contextPolicy,
        primaryModelKey: null,
        runtimeTierDefault: "free_shared_restricted",
        toolActivations: [
          {
            toolCode: "web_fetch",
            active: true,
            dailyCallLimit: null,
            perTurnCap: 0
          }
        ]
      }),
    (error) => error instanceof BadRequestException && /perTurnCap/i.test(error.message)
  );

  // Strict parser rejects non-positive loop limit.
  assert.throws(
    () =>
      service.parseUpdateInput({
        displayName: "Starter",
        description: "Trial plan",
        status: "active",
        defaultOnRegistration: true,
        trialEnabled: true,
        trialDurationDays: 7,
        metadata: { commercialTag: "trial", notes: null },
        entitlements: {
          toolClasses: {
            costDrivingTools: false,
            utilityTools: true,
            costDrivingQuotaGoverned: true,
            utilityQuotaGoverned: true
          },
          channelsAndSurfaces: { webChat: true, telegram: true, whatsapp: false, max: false },
          mediaClasses: { image: false, audio: false, video: false, file: false }
        },
        quotaLimits: { tokenBudgetLimit: 1000 },
        contextPolicy,
        primaryModelKey: null,
        runtimeTierDefault: "free_shared_restricted",
        toolBudgets: {
          loopLimitByMode: { normal: -1, premium: null, reasoning: null }
        }
      }),
    (error) => error instanceof BadRequestException && /loopLimitByMode\.normal/.test(error.message)
  );

  // Round-trip from on-disk billingHints back to AdminPlanState includes the
  // resolved toolBudgets and the per-tool perTurnCap.
  const stateWithToolBudgets = (
    service as unknown as {
      toAdminPlanState(plan: AssistantPlanCatalog): {
        toolBudgets: { loopLimitByMode: Record<string, number | null> };
        toolActivations: Array<{ toolCode: string; perTurnCap: number | null }>;
      };
    }
  ).toAdminPlanState({
    id: "plan-3",
    code: "starter",
    displayName: "Starter",
    description: "Trial plan",
    status: "active",
    billingProviderHints: {
      toolBudgets: {
        schema: "persai.toolBudgets.v1",
        loopLimitByMode: { normal: 3, premium: null, reasoning: 9 }
      }
    },
    entitlementModel: null,
    toolActivations: [
      {
        toolCode: "web_fetch",
        displayName: "Web Fetch",
        toolClass: "cost_driving",
        policyClass: "plan_managed",
        activationStatus: "active",
        dailyCallLimit: 10,
        perTurnCap: 7
      }
    ],
    isDefaultFirstRegistrationPlan: false,
    isTrialPlan: false,
    trialDurationDays: null,
    createdAt: new Date("2026-04-14T12:00:00.000Z"),
    updatedAt: new Date("2026-04-14T12:00:00.000Z")
  });
  assert.deepEqual(stateWithToolBudgets.toolBudgets.loopLimitByMode, {
    normal: 3,
    premium: null,
    reasoning: 9
  });
  const webFetchState = stateWithToolBudgets.toolActivations.find(
    (entry) => entry.toolCode === "web_fetch"
  );
  assert.ok(webFetchState, "web_fetch activation is surfaced");
  assert.equal(webFetchState.perTurnCap, 7);
}

void run();
