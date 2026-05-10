import assert from "node:assert/strict";
import { AdminSecurityController } from "../src/modules/workspace-management/interface/http/admin-security.controller";

async function run(): Promise<void> {
  const issuedActions: string[] = [];
  const auditEvents: Array<Record<string, unknown>> = [];
  const controller = new AdminSecurityController(
    {
      issueStepUpChallenge: async (_userId: string, action: string) => {
        issuedActions.push(action);
        return {
          context: {
            workspaceId: "ws-1",
            roles: ["business_admin"],
            hasLegacyOwnerFallback: false
          },
          challenge: {
            token: "step-up-token",
            expiresAt: "2026-04-17T21:00:00.000Z"
          }
        };
      }
    } as never,
    {
      execute: async (event: Record<string, unknown>) => {
        auditEvents.push(event);
      }
    } as never
  );

  const req = {
    requestId: "req-1",
    resolvedAppUser: { id: "user-1" }
  } as never;
  const response = await controller.createStepUpChallenge(req, { action: "admin.plan.delete" });

  assert.equal(issuedActions[0], "admin.plan.delete");
  assert.equal(response.challenge.action, "admin.plan.delete");
  assert.equal(response.challenge.token, "step-up-token");
  assert.equal(auditEvents[0]?.eventCode, "admin.step_up_challenge_issued");
  assert.equal((auditEvents[0]?.details as Record<string, unknown>).action, "admin.plan.delete");

  const documentProcessingResponse = await controller.createStepUpChallenge(req, {
    action: "admin.document_processing_settings.update"
  });

  assert.equal(issuedActions[1], "admin.document_processing_settings.update");
  assert.equal(
    documentProcessingResponse.challenge.action,
    "admin.document_processing_settings.update"
  );

  const billingLifecycleSettingsResponse = await controller.createStepUpChallenge(req, {
    action: "admin.billing_lifecycle_settings.update"
  });

  assert.equal(issuedActions[2], "admin.billing_lifecycle_settings.update");
  assert.equal(
    billingLifecycleSettingsResponse.challenge.action,
    "admin.billing_lifecycle_settings.update"
  );

  const billingCredentialsResponse = await controller.createStepUpChallenge(req, {
    action: "admin.billing_provider_credentials.update"
  });

  assert.equal(issuedActions[3], "admin.billing_provider_credentials.update");
  assert.equal(
    billingCredentialsResponse.challenge.action,
    "admin.billing_provider_credentials.update"
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
