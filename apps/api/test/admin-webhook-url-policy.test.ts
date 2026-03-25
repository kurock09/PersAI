import assert from "node:assert/strict";
import { assertPublicWebhookUrl } from "../src/modules/workspace-management/application/admin-webhook-url-policy";

function run(): void {
  assert.doesNotThrow(() => {
    assertPublicWebhookUrl("https://hooks.example.com/persai/admin");
  });

  assert.throws(() => {
    assertPublicWebhookUrl("http://localhost:3000/hook");
  }, /public host/);

  assert.throws(() => {
    assertPublicWebhookUrl("https://10.0.0.5/hook");
  }, /public host/);

  assert.throws(() => {
    assertPublicWebhookUrl("https://ops.internal/hook");
  }, /public host/);

  assert.throws(() => {
    assertPublicWebhookUrl("https://user:pass@hooks.example.com/hook");
  }, /must not embed credentials/);
}

run();
