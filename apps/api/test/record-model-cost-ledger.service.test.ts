import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RecordModelCostLedgerService } from "../src/modules/workspace-management/application/record-model-cost-ledger.service";
import type { ResolvePlatformRuntimeProviderSettingsService } from "../src/modules/workspace-management/application/resolve-platform-runtime-provider-settings.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

describe("RecordModelCostLedgerService", () => {
  test("records replay-safe ordinary-chat costs for router and main-reply entries", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    let createManySkipDuplicates: boolean | undefined;
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: {
          data: Array<Record<string, unknown>>;
          skipDuplicates?: boolean;
        }) => {
          createManySkipDuplicates = input.skipDuplicates;
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: {
          openai: ["gpt-5-mini"],
          anthropic: []
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5-mini",
                capabilities: ["chat"],
                active: false,
                billingMode: "token_metered",
                effectiveFrom: "2026-01-01T00:00:00.000Z",
                effectiveTo: "2026-05-01T00:00:00.000Z",
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 2,
                    cachedInputPer1M: 1,
                    outputPer1M: 8
                  }
                }
              },
              {
                model: "gpt-5-mini",
                capabilities: ["chat"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: "2026-05-01T00:00:00.000Z",
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 50,
                    cachedInputPer1M: 25,
                    outputPer1M: 100
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-5-mini",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );

    const writtenCount = await service.recordChatMainReplyEvents({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "web",
      purpose: "chat_main_reply",
      source: "web_chat_turn_sync",
      occurredAt: "2026-04-15T12:00:00.000Z",
      sourceEventId: "assistant-msg-1",
      requestCorrelationId: "trace-1",
      usageAccounting: {
        inputTokens: 160,
        cachedInputTokens: 20,
        outputTokens: 40,
        totalTokens: 200,
        entries: [
          {
            stepType: "turn_routing",
            modelRole: "system_tool",
            providerKey: "openai",
            modelKey: "gpt-5-mini",
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 2,
            totalTokens: 12
          },
          {
            stepType: "main_turn",
            modelRole: "normal_reply",
            providerKey: "openai",
            modelKey: "gpt-5-mini",
            inputTokens: 120,
            cachedInputTokens: 20,
            outputTokens: 40,
            totalTokens: 160
          }
        ]
      }
    });

    assert.equal(writtenCount, 2);
    assert.equal(createdRows.length, 2);
    assert.deepEqual(
      createdRows.map((row) => ({
        provider: row.provider,
        model: row.model,
        purpose: row.purpose,
        surface: row.surface,
        source: row.source,
        sourceEventId: row.sourceEventId,
        requestCorrelationId: row.requestCorrelationId,
        actualCostMicros: row.actualCostMicros,
        stepType: (row.rawUsage as { stepType?: string } | undefined)?.stepType,
        effectiveTo: (row.priceCatalogSnapshot as { effectiveTo?: string } | undefined)?.effectiveTo
      })),
      [
        {
          provider: "openai",
          model: "gpt-5-mini",
          purpose: "router",
          surface: "web",
          source: "web_chat_turn_sync",
          sourceEventId: "assistant-msg-1",
          requestCorrelationId: "trace-1",
          actualCostMicros: BigInt(36),
          stepType: "turn_routing",
          effectiveTo: "2026-05-01T00:00:00.000Z"
        },
        {
          provider: "openai",
          model: "gpt-5-mini",
          purpose: "chat_main_reply",
          surface: "web",
          source: "web_chat_turn_sync",
          sourceEventId: "assistant-msg-1",
          requestCorrelationId: "trace-1",
          actualCostMicros: BigInt(540),
          stepType: "main_turn",
          effectiveTo: "2026-05-01T00:00:00.000Z"
        }
      ]
    );
    assert.match(String(createdRows[0]?.priceCatalogVersion ?? ""), /^[0-9a-f]{64}$/);
    assert.match(String(createdRows[1]?.priceCatalogVersion ?? ""), /^[0-9a-f]{64}$/);
    assert.equal(createManySkipDuplicates, true);
    assert.match(String(createdRows[0]?.id ?? ""), /^[0-9a-f-]{36}$/);
    assert.match(String(createdRows[1]?.id ?? ""), /^[0-9a-f-]{36}$/);
  });

  test("does not write a ledger row when no catalog row covers the event timestamp", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: { data: Array<Record<string, unknown>> }) => {
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: {
          openai: ["gpt-5-mini"],
          anthropic: []
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5-mini",
                capabilities: ["chat"],
                active: false,
                billingMode: "token_metered",
                effectiveFrom: "2026-01-01T00:00:00.000Z",
                effectiveTo: "2026-02-01T00:00:00.000Z",
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 2,
                    cachedInputPer1M: 1,
                    outputPer1M: 8
                  }
                }
              },
              {
                model: "gpt-5-mini",
                capabilities: ["chat"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: "2026-05-01T00:00:00.000Z",
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 50,
                    cachedInputPer1M: 25,
                    outputPer1M: 100
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-5-mini",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );

    const writtenCount = await service.recordChatMainReplyEvents({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "web",
      purpose: "chat_main_reply",
      source: "web_chat_turn_sync",
      occurredAt: "2026-04-15T12:00:00.000Z",
      sourceEventId: "assistant-msg-1",
      requestCorrelationId: "trace-1",
      usageAccounting: {
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 40,
        totalTokens: 160,
        entries: [
          {
            stepType: "main_turn",
            modelRole: "normal_reply",
            providerKey: "openai",
            modelKey: "gpt-5-mini",
            inputTokens: 120,
            cachedInputTokens: 20,
            outputTokens: 40,
            totalTokens: 160
          }
        ]
      }
    });

    assert.equal(writtenCount, 0);
    assert.equal(createdRows.length, 0);
  });

  test("uses deterministic entry ids so retrying the same logical priced calls can skip duplicates", async () => {
    const insertedRows = new Map<string, Record<string, unknown>>();
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: {
          data: Array<Record<string, unknown>>;
          skipDuplicates?: boolean;
        }) => {
          let insertedCount = 0;
          for (const row of input.data) {
            const id = String(row.id ?? "");
            if (insertedRows.has(id)) {
              continue;
            }
            insertedRows.set(id, row);
            insertedCount += 1;
          }
          return { count: insertedCount };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: {
          openai: ["gpt-5-mini"],
          anthropic: []
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5-mini",
                capabilities: ["chat"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: "2026-05-01T00:00:00.000Z",
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 50,
                    cachedInputPer1M: 25,
                    outputPer1M: 100
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-5-mini",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const input = {
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "telegram" as const,
      purpose: "chat_main_reply" as const,
      source: "telegram_turn_sync",
      occurredAt: "2026-05-20T20:00:00.000Z",
      sourceEventId: "assistant-msg-1",
      requestCorrelationId: "trace-1",
      usageAccounting: {
        inputTokens: 132,
        cachedInputTokens: 20,
        outputTokens: 42,
        totalTokens: 174,
        entries: [
          {
            stepType: "turn_routing",
            modelRole: "system_tool" as const,
            providerKey: "openai",
            modelKey: "gpt-5-mini",
            inputTokens: 12,
            cachedInputTokens: 0,
            outputTokens: 2,
            totalTokens: 14
          },
          {
            stepType: "main_turn",
            modelRole: "normal_reply" as const,
            providerKey: "openai",
            modelKey: "gpt-5-mini",
            inputTokens: 120,
            cachedInputTokens: 20,
            outputTokens: 40,
            totalTokens: 160
          }
        ]
      }
    };

    const firstCount = await service.recordChatMainReplyEvents(input);
    const secondCount = await service.recordChatMainReplyEvents(input);

    assert.equal(firstCount, 2);
    assert.equal(secondCount, 0);
    assert.equal(insertedRows.size, 2);
  });

  test("records replay-safe background-task evaluator costs from persisted run usage", async () => {
    const insertedRows = new Map<string, Record<string, unknown>>();
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: {
          data: Array<Record<string, unknown>>;
          skipDuplicates?: boolean;
        }) => {
          let insertedCount = 0;
          for (const row of input.data) {
            const id = String(row.id ?? "");
            if (insertedRows.has(id)) {
              continue;
            }
            insertedRows.set(id, row);
            insertedCount += 1;
          }
          return { count: insertedCount };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: {
          openai: ["gpt-5-mini"],
          anthropic: []
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5-mini",
                capabilities: ["chat"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: "2026-05-01T00:00:00.000Z",
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 50,
                    cachedInputPer1M: 25,
                    outputPer1M: 100
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-5-mini",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const input = {
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      occurredAt: "2026-05-20T22:15:00.000Z",
      sourceEventId: "task-run-1",
      requestCorrelationId: "task-1",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5-mini",
        inputTokens: 150,
        cachedInputTokens: 20,
        outputTokens: 30,
        totalTokens: 180
      }
    };

    const firstCount = await service.recordBackgroundTaskEvaluationEvent(input);
    const secondCount = await service.recordBackgroundTaskEvaluationEvent(input);

    assert.equal(firstCount, 1);
    assert.equal(secondCount, 0);
    assert.equal(insertedRows.size, 1);
    const row = insertedRows.get([...insertedRows.keys()][0] ?? "");
    assert.ok(row);
    assert.deepEqual(
      {
        provider: row?.provider,
        model: row?.model,
        purpose: row?.purpose,
        surface: row?.surface,
        source: row?.source,
        sourceEventId: row?.sourceEventId,
        requestCorrelationId: row?.requestCorrelationId,
        actualCostMicros: row?.actualCostMicros,
        modelRole: (row?.rawUsage as { modelRole?: string } | undefined)?.modelRole,
        stepType: (row?.rawUsage as { stepType?: string } | undefined)?.stepType
      },
      {
        provider: "openai",
        model: "gpt-5-mini",
        purpose: "background_task",
        surface: "background",
        source: "background_task_evaluation",
        sourceEventId: "task-run-1",
        requestCorrelationId: "task-1",
        actualCostMicros: BigInt(10_000),
        modelRole: "system_tool",
        stepType: "background_task_evaluation"
      }
    );
  });

  test("records replay-safe image generation cost from persisted billing facts", async () => {
    const insertedRows = new Map<string, Record<string, unknown>>();
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: {
          data: Array<Record<string, unknown>>;
          skipDuplicates?: boolean;
        }) => {
          let inserted = 0;
          for (const row of input.data) {
            const id = String(row.id ?? "");
            if (id.length === 0 || insertedRows.has(id)) {
              continue;
            }
            insertedRows.set(id, row);
            inserted += 1;
          }
          return { count: inserted };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: { openai: ["gpt-image-1"], anthropic: [] },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-image-1",
                capabilities: ["image"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 10,
                    cachedInputPer1M: 2.5,
                    outputPer1M: 40
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-image-1",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const billingFacts = {
      providerKey: "openai",
      modelKey: "gpt-image-1",
      capability: "image",
      occurredAt: "2026-05-05T09:05:00.000Z",
      metering: {
        meteringKind: "token_metered",
        inputTokens: 1_000,
        cachedInputTokens: 0,
        outputTokens: 2_000,
        totalTokens: 3_000,
        dimensions: { operation: "generate" }
      }
    };

    const firstCount = await service.recordPersistedBillingFactsEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "web",
      source: "media_job_completion",
      sourceEventId: "media_job:job-1",
      billingFacts
    });
    const secondCount = await service.recordPersistedBillingFactsEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "web",
      source: "media_job_completion",
      sourceEventId: "media_job:job-1",
      billingFacts
    });

    assert.equal(firstCount, 1);
    assert.equal(secondCount, 0);
    assert.equal(insertedRows.size, 1);
    const row = insertedRows.get([...insertedRows.keys()][0] ?? "");
    assert.ok(row);
    assert.deepEqual(
      {
        provider: row?.provider,
        model: row?.model,
        capability: row?.capability,
        purpose: row?.purpose,
        surface: row?.surface,
        source: row?.source,
        sourceEventId: row?.sourceEventId,
        actualCostMicros: row?.actualCostMicros,
        billingMode: row?.billingMode
      },
      {
        provider: "openai",
        model: "gpt-image-1",
        capability: "image",
        purpose: "image_generation",
        surface: "web",
        source: "media_job_completion",
        sourceEventId: "media_job:job-1",
        actualCostMicros: BigInt(90_000),
        billingMode: "token_metered"
      }
    );
  });

  test("records video cost from persisted time-metered billing facts", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: { data: Array<Record<string, unknown>> }) => {
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: { openai: ["sora-2"], anthropic: [] },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "sora-2",
                capabilities: ["video"],
                active: true,
                billingMode: "time_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  timePricing: {
                    unit: "second",
                    pricePerUnit: 10
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "sora-2",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const writtenCount = await service.recordPersistedBillingFactsEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "web",
      source: "media_job_completion",
      sourceEventId: "media_job:job-video-1",
      billingFacts: {
        providerKey: "openai",
        modelKey: "sora-2",
        capability: "video",
        occurredAt: "2026-05-05T09:10:00.000Z",
        metering: {
          meteringKind: "time_metered",
          durationMs: 8_000,
          durationSeconds: 8
        }
      }
    });

    assert.equal(writtenCount, 1);
    assert.deepEqual(
      {
        purpose: createdRows[0]?.purpose,
        actualCostMicros: createdRows[0]?.actualCostMicros,
        billingMode: createdRows[0]?.billingMode
      },
      {
        purpose: "video_generation",
        actualCostMicros: BigInt(80),
        billingMode: "time_metered"
      }
    );
  });

  test("records STT cost from persisted time-metered billing facts", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: { data: Array<Record<string, unknown>> }) => {
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: { openai: ["gpt-4o-mini-transcribe"], anthropic: [] },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-4o-mini-transcribe",
                capabilities: ["speech_to_text"],
                active: true,
                billingMode: "time_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  timePricing: {
                    unit: "minute",
                    pricePerUnit: 60
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const writtenCount = await service.recordPersistedBillingFactsEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "web",
      source: "attachment_stt_ingest",
      sourceEventId: "attachment:att-1",
      billingFacts: {
        providerKey: "openai",
        modelKey: "gpt-4o-mini-transcribe",
        capability: "speech_to_text",
        occurredAt: "2026-05-05T09:00:00.000Z",
        metering: {
          meteringKind: "time_metered",
          durationMs: 90_000,
          durationSeconds: 90
        }
      }
    });

    assert.equal(writtenCount, 1);
    assert.deepEqual(
      {
        purpose: createdRows[0]?.purpose,
        actualCostMicros: createdRows[0]?.actualCostMicros,
        billingMode: createdRows[0]?.billingMode
      },
      {
        purpose: "stt",
        actualCostMicros: BigInt(90),
        billingMode: "time_metered"
      }
    );
  });

  test("records retrieval-helper costs from persisted helper usage", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: { data: Array<Record<string, unknown>> }) => {
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: { openai: ["gpt-5-mini"], anthropic: [] },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5-mini",
                capabilities: ["chat"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 50,
                    cachedInputPer1M: 25,
                    outputPer1M: 100
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-5-mini",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const writtenCount = await service.recordRetrievalHelperEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      occurredAt: "2026-05-20T20:00:00.000Z",
      sourceEventId: "knowledge_retrieval_event:ret-1",
      providerKey: "openai",
      modelKey: "gpt-5-mini",
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120
    });

    assert.equal(writtenCount, 1);
    assert.equal(createdRows[0]?.purpose, "retrieval_helper");
    assert.equal(createdRows[0]?.source, "knowledge_retrieval_helper");
  });

  test("records upload micro-description helper usage as tool_helper", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: { data: Array<Record<string, unknown>> }) => {
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: { openai: ["gpt-5-mini"], anthropic: [] },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5-mini",
                capabilities: ["chat"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 50,
                    cachedInputPer1M: 25,
                    outputPer1M: 100
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-5-mini",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const writtenCount = await service.recordToolHelperEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      occurredAt: "2026-05-22T20:00:00.000Z",
      sourceEventId: "upload_micro_description_job:job-1",
      source: "upload_micro_description",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5-mini",
        inputTokens: 48,
        cachedInputTokens: 0,
        outputTokens: 12,
        totalTokens: 60
      }
    });

    assert.equal(writtenCount, 1);
    assert.equal(createdRows[0]?.purpose, "tool_helper");
    assert.equal(createdRows[0]?.source, "upload_micro_description");
    assert.equal(createdRows[0]?.surface, "background");
    assert.equal(createdRows[0]?.sourceEventId, "upload_micro_description_job:job-1");
  });

  test("records async completion framing usage as chat_helper", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: { data: Array<Record<string, unknown>> }) => {
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: { openai: ["gpt-5-mini"], anthropic: [] },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5-mini",
                capabilities: ["chat"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 50,
                    cachedInputPer1M: 25,
                    outputPer1M: 100
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-5-mini",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const writtenCount = await service.recordCompletionFramingUsageEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "web",
      occurredAt: "2026-05-20T20:00:00.000Z",
      sourceEventId: "media_job:job-1",
      source: "media_job_completion_framing",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-5-mini",
        inputTokens: 80,
        cachedInputTokens: 0,
        outputTokens: 16,
        totalTokens: 96
      }
    });

    assert.equal(writtenCount, 1);
    assert.equal(createdRows[0]?.purpose, "chat_helper");
    assert.equal(createdRows[0]?.source, "media_job_completion_framing");
  });

  test("records knowledge indexing embedding usage as knowledge_embedding", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: { data: Array<Record<string, unknown>> }) => {
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: { openai: ["text-embedding-3-small"], anthropic: [] },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "text-embedding-3-small",
                capabilities: ["chat"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 0.02,
                    cachedInputPer1M: 0.01,
                    outputPer1M: 0
                  }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "text-embedding-3-small",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const writtenCount = await service.recordKnowledgeIndexingEmbeddingEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      occurredAt: "2026-05-20T20:00:00.000Z",
      sourceEventId: "knowledge_indexing_job:job-1",
      providerKey: "openai",
      modelKey: "text-embedding-3-small",
      inputTokens: 512,
      totalTokens: 512
    });

    assert.equal(writtenCount, 1);
    assert.equal(createdRows[0]?.purpose, "knowledge_embedding");
    assert.equal(createdRows[0]?.source, "knowledge_indexing_embedding");
    assert.equal(createdRows[0]?.surface, "background");
  });

  test("records tool-path billing facts from Admin Tools economics catalog", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: {
          data: Array<Record<string, unknown>>;
          skipDuplicates?: boolean;
        }) => {
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: { openai: [], anthropic: [] },
        availableModelCatalogByProvider: { openai: { models: [] }, anthropic: { models: [] } },
        primary: {
          provider: "openai",
          model: "gpt-5-mini",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: [
          {
            pathKey: "web_search:tavily",
            toolCode: "web_search",
            providerId: "tavily",
            active: true,
            billingMode: "fixed_operation",
            effectiveFrom: null,
            effectiveTo: null,
            displayLabel: null,
            notes: null,
            providerPriceMetadata: {
              currency: "USD",
              fixedOperationPricing: {
                unitLabel: "search call",
                pricePerOperation: 8
              }
            }
          }
        ]
      })
    };

    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const writtenCount = await service.recordToolPathBillingFactsEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "web",
      source: "native_tool_web_search",
      sourceEventId: "tool_invocation:inv-1",
      billingFacts: {
        providerKey: "tavily",
        modelKey: "web_search:tavily",
        capability: "web_search",
        occurredAt: "2026-05-20T20:00:00.000Z",
        metering: {
          meteringKind: "operation_metered",
          operationCount: 1,
          dimensions: { providerId: "tavily" }
        }
      }
    });

    assert.equal(writtenCount, 1);
    assert.equal(createdRows[0]?.purpose, "web_search");
    assert.equal(createdRows[0]?.capability, "web_search");
    assert.equal(createdRows[0]?.model, "web_search:tavily");
    assert.equal(createdRows[0]?.billingMode, "fixed_operation");
    assert.equal(createdRows[0]?.actualCostMicros, 8n);
  });

  test("records document generation usage with purpose document_generation (token_metered chat model)", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: {
          data: Array<Record<string, unknown>>;
          skipDuplicates?: boolean;
        }) => {
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai", "anthropic"],
        availableModelsByProvider: { openai: ["gpt-4.1-mini"], anthropic: [] },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-4.1-mini",
                capabilities: ["chat"],
                active: true,
                billingMode: "token_metered",
                effectiveFrom: "2026-01-01T00:00:00.000Z",
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: { inputPer1M: 100, cachedInputPer1M: 50, outputPer1M: 400 }
                }
              }
            ]
          },
          anthropic: { models: [] }
        },
        primary: {
          provider: "openai",
          model: "gpt-4.1-mini",
          credentialRef: {
            refKey: "env:openai:OPENAI_API_KEY",
            secretRef: { source: "env", provider: "openai", id: "OPENAI_API_KEY" },
            updatedAt: null
          }
        },
        fallback: null,
        notes: []
      })
    } as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({
        schema: "persai.toolPathPricingCatalog.v1" as const,
        rows: []
      })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const writtenCount = await service.recordDocumentGenerationUsageEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "background",
      source: "document_job_generation",
      sourceEventId: "document_render_job:job-doc-1:generation",
      occurredAt: "2026-05-30T12:00:00.000Z",
      usage: {
        providerKey: "openai",
        modelKey: "gpt-4.1-mini",
        inputTokens: 3000,
        cachedInputTokens: 0,
        outputTokens: 1500,
        totalTokens: 4500
      }
    });

    assert.equal(writtenCount, 1, "must write exactly one ledger row");
    assert.equal(createdRows[0]?.purpose, "document_generation");
    assert.equal(createdRows[0]?.source, "document_job_generation");
    assert.equal(createdRows[0]?.capability, "chat");
    assert.equal(createdRows[0]?.billingMode, "token_metered");
    assert.equal(createdRows[0]?.workspaceId, "workspace-1");
    assert.equal(createdRows[0]?.assistantId, "assistant-1");
    assert.equal(
      (createdRows[0]?.sourceEventId as string | undefined)?.includes("generation"),
      true,
      "sourceEventId must contain 'generation'"
    );
  });

  test("skips document_generation ledger row when usage is null", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const prisma = {
      modelCostLedgerEvent: {
        createMany: async (input: {
          data: Array<Record<string, unknown>>;
          skipDuplicates?: boolean;
        }) => {
          createdRows.push(...input.data);
          return { count: input.data.length };
        }
      }
    } as unknown as WorkspaceManagementPrismaService;

    const settingsResolver = {
      execute: async () => ({
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        derivedFrom: {
          policyEnvelopeSchema: "persai.runtimeProviderProfile.v1",
          secretRefsSchema: "persai.runtimeProviderCredentialRefs.v1"
        },
        allowedProviders: ["openai"],
        availableModelsByProvider: { openai: [] },
        availableModelCatalogByProvider: { openai: { models: [] }, anthropic: { models: [] } },
        primary: null,
        fallback: null,
        notes: []
      })
    } as unknown as ResolvePlatformRuntimeProviderSettingsService;

    const toolPathCatalogResolver = {
      execute: async () => ({ schema: "persai.toolPathPricingCatalog.v1" as const, rows: [] })
    };
    const service = new RecordModelCostLedgerService(
      prisma,
      settingsResolver,
      toolPathCatalogResolver as never
    );
    const writtenCount = await service.recordDocumentGenerationUsageEvent({
      workspaceId: "workspace-1",
      assistantId: "assistant-1",
      userId: "user-1",
      surface: "background",
      source: "document_job_generation",
      sourceEventId: "document_render_job:job-null-1:generation",
      occurredAt: "2026-05-30T12:00:00.000Z",
      usage: null
    });

    assert.equal(writtenCount, 0, "must write zero rows when usage is null");
    assert.equal(createdRows.length, 0);
  });
});
