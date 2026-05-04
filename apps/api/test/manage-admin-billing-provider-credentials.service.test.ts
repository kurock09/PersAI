import assert from "node:assert/strict";
import { ManageAdminBillingProviderCredentialsService } from "../src/modules/workspace-management/application/manage-admin-billing-provider-credentials.service";

async function run(): Promise<void> {
  const upserts: Array<{ providerKey: string; rawKey: string; updatedByUserId: string }> = [];
  const auditEvents: Array<Record<string, unknown>> = [];

  const service = new ManageAdminBillingProviderCredentialsService(
    {
      assertCanReadAdminSurface: async () => undefined,
      assertCanPerformDangerousAdminAction: async (_userId: string, action: string) => {
        assert.equal(action, "admin.billing_provider_credentials.update");
      }
    } as never,
    {
      assertEncryptionConfigured: () => undefined,
      loadKeyMetadataByKeys: async () => ({
        billing_cloudpayments__api_secret: {
          configured: true,
          lastFour: "cret",
          updatedAt: "2026-05-04T18:00:00.000Z"
        },
        billing_cloudpayments__public_terminal_id: {
          configured: true,
          lastFour: "0002",
          updatedAt: "2026-05-04T18:01:00.000Z"
        }
      }),
      upsertProviderKey: async (providerKey: string, rawKey: string, updatedByUserId: string) => {
        upserts.push({ providerKey, rawKey, updatedByUserId });
      }
    } as never,
    {
      execute: async (event: Record<string, unknown>) => {
        auditEvents.push(event);
      }
    } as never
  );

  const parsed = service.parseUpdateInput({
    providers: {
      cloudpayments: {
        apiSecret: "  cloudpayments-secret  ",
        publicTerminalId: "  test_api_00000000000000000000002  "
      }
    }
  });
  assert.deepEqual(parsed, {
    providers: {
      cloudpayments: {
        apiSecret: "cloudpayments-secret",
        publicTerminalId: "test_api_00000000000000000000002"
      }
    }
  });

  const state = await service.updateCredentials(
    "user-1",
    {
      providers: {
        cloudpayments: {
          apiSecret: "cloudpayments-secret",
          publicTerminalId: "test_api_00000000000000000000002"
        }
      }
    },
    "step-up-token"
  );

  assert.deepEqual(upserts, [
    {
      providerKey: "billing_cloudpayments__api_secret",
      rawKey: "cloudpayments-secret",
      updatedByUserId: "user-1"
    },
    {
      providerKey: "billing_cloudpayments__public_terminal_id",
      rawKey: "test_api_00000000000000000000002",
      updatedByUserId: "user-1"
    }
  ]);
  assert.equal(state.providers[0]?.providerKey, "cloudpayments");
  assert.equal(state.providers[0]?.apiSecret.configured, true);
  assert.equal(state.providers[0]?.publicTerminalId.configured, true);
  assert.equal(auditEvents[0]?.eventCode, "admin.billing_provider_credentials_updated");
}

void run();
