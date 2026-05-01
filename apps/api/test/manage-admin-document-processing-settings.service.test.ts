import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { ManageAdminDocumentProcessingSettingsService } from "../src/modules/workspace-management/application/manage-admin-document-processing-settings.service";

function createHarness() {
  const settingsRows = new Map<
    string,
    { documentProcessingPolicy: unknown; updatedByUserId: string | null }
  >();
  const secrets = new Map<string, { value: string; lastFour: string; updatedAt: Date }>();
  const auditEvents: unknown[] = [];
  let configGeneration = 0;

  const prisma = {
    platformRuntimeProviderSettings: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = settingsRows.get(where.id);
        return row === undefined ? null : row;
      },
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { id: string };
        create: { documentProcessingPolicy: unknown; updatedByUserId: string | null };
        update: { documentProcessingPolicy: unknown; updatedByUserId: string | null };
      }) => {
        const existing = settingsRows.get(where.id);
        const next = existing === undefined ? create : { ...existing, ...update };
        settingsRows.set(where.id, next);
        return next;
      }
    }
  };

  const service = new ManageAdminDocumentProcessingSettingsService(
    prisma as never,
    {
      assertCanReadAdminSurface: async () => ({ userId: "admin-1", workspaceId: "ws-1" }),
      assertCanPerformDangerousAdminAction: async () => ({ userId: "admin-1", workspaceId: "ws-1" })
    } as never,
    {
      assertEncryptionConfigured: () => undefined,
      loadKeyMetadataByKeys: async (keys: string[]) => {
        const result: Record<
          string,
          { configured: boolean; lastFour: string | null; updatedAt: string | null }
        > = {};
        for (const key of keys) {
          const secret = secrets.get(key);
          if (secret !== undefined) {
            result[key] = {
              configured: true,
              lastFour: secret.lastFour,
              updatedAt: secret.updatedAt.toISOString()
            };
          }
        }
        return result;
      },
      upsertProviderKey: async (providerKey: string, rawKey: string) => {
        secrets.set(providerKey, {
          value: rawKey,
          lastFour: rawKey.slice(-4),
          updatedAt: new Date("2026-05-01T12:00:00.000Z")
        });
      },
      resolveSecretValueByProviderKey: async (providerKey: string) =>
        secrets.get(providerKey)?.value ?? null
    } as never,
    {
      execute: async () => {
        configGeneration += 1;
        return configGeneration;
      }
    } as never,
    {
      execute: async (event: unknown) => {
        auditEvents.push(event);
      }
    } as never
  );

  return {
    service,
    settingsRows,
    secrets,
    auditEvents
  };
}

async function run(): Promise<void> {
  const harness = createHarness();
  const initial = await harness.service.getSettings("admin-1");

  assert.equal(initial.policy.defaultProvider, "mistral");
  assert.equal(initial.policy.highQualityFallbackProvider, "llamaparse");
  assert.equal(initial.policy.localFallbackEnabled, true);
  assert.equal(
    initial.providers.find((provider) => provider.providerKey === "local")?.configured,
    true
  );
  assert.equal(
    initial.providers.find((provider) => provider.providerKey === "mistral")?.configured,
    false
  );

  await assert.rejects(
    () =>
      harness.service.updateSettings(
        "admin-1",
        {
          policy: {
            defaultProvider: "mistral",
            highQualityFallbackProvider: "llamaparse",
            localFallbackEnabled: true,
            autoFallbackEnabled: true,
            needsReviewThreshold: 0.7
          },
          providerKeys: {}
        },
        "step-up"
      ),
    BadRequestException
  );

  const updated = await harness.service.updateSettings(
    "admin-1",
    {
      policy: {
        defaultProvider: "mistral",
        highQualityFallbackProvider: "llamaparse",
        localFallbackEnabled: true,
        autoFallbackEnabled: true,
        needsReviewThreshold: 0.7
      },
      providerKeys: {
        mistral: "mistral-secret-1234",
        llamaparse: "llamaparse-secret-5678"
      }
    },
    "step-up"
  );

  assert.equal(updated.configGeneration, 1);
  assert.equal(updated.settings.policy.needsReviewThreshold, 0.7);
  assert.equal(harness.secrets.get("document_processing_mistral")?.lastFour, "1234");
  assert.equal(harness.secrets.get("document_processing_llamaparse")?.lastFour, "5678");
  assert.equal(harness.settingsRows.get("global")?.updatedByUserId, "admin-1");
  assert.equal(
    updated.settings.providers.find((provider) => provider.providerKey === "mistral")?.configured,
    true
  );
  assert.equal(harness.auditEvents.length, 1);

  const localConnection = await harness.service.testConnection("admin-1", "local");
  assert.equal(localConnection.ok, true);

  const mistralConnection = await harness.service.testConnection("admin-1", "mistral");
  assert.equal(mistralConnection.ok, true);
  assert.match(mistralConnection.message, /decryptable/);
}

void run();
