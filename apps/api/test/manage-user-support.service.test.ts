import assert from "node:assert/strict";
import test from "node:test";
import { ManageUserSupportService } from "../src/modules/workspace-management/application/support/manage-user-support.service";
import { formatSupportTicketShortId } from "../src/modules/workspace-management/application/support/support.types";

test("formatSupportTicketShortId returns stable short code", () => {
  const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  assert.equal(formatSupportTicketShortId(id), "A1B2C3D4");
});

test("parseCreateInput rejects short body", () => {
  const service = new ManageUserSupportService({} as never, {} as never);
  assert.throws(
    () => service.parseCreateInput({ body: "hi", assistantId: "x" }),
    /at least 3 characters/
  );
});

test("parseCreateInput accepts valid payload", () => {
  const service = new ManageUserSupportService({} as never, {} as never);
  const parsed = service.parseCreateInput({
    body: "Need help with billing",
    subject: " Billing "
  });
  assert.equal(parsed.body, "Need help with billing");
  assert.equal(parsed.subject, "Billing");
});
