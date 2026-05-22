import assert from "node:assert/strict";
import test from "node:test";
import { ManageUserSupportService } from "../src/modules/workspace-management/application/support/manage-user-support.service";
import { formatSupportTicketShortId } from "../src/modules/workspace-management/application/support/support.types";

test("formatSupportTicketShortId returns stable short code", () => {
  const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  assert.equal(formatSupportTicketShortId(id), "A1B2C3D4");
});

function createService() {
  return new ManageUserSupportService({} as never, {} as never, {} as never);
}

test("parseCreateInput allows empty body when validated elsewhere", () => {
  const service = createService();
  const parsed = service.parseCreateInput({ body: "  " });
  assert.equal(parsed.body, "");
});

test("parseCreateMultipart rejects short body without attachment", () => {
  const service = createService();
  assert.throws(
    () =>
      service.parseCreateMultipart({
        body: { assistantId: "asst-1", body: "hi" }
      }),
    /at least 3 characters/
  );
});

test("parseCreateMultipart accepts attachment-only payload", () => {
  const service = createService();
  const parsed = service.parseCreateMultipart({
    body: { assistantId: "asst-1", body: "" },
    file: { buffer: Buffer.from("x"), mimetype: "image/png", originalname: "shot.png" }
  });
  assert.equal(parsed.assistantId, "asst-1");
  assert.equal(parsed.body, "");
  assert.ok(parsed.file);
});

test("parseCreateInput accepts valid payload", () => {
  const service = createService();
  const parsed = service.parseCreateInput({
    body: "Need help with billing",
    subject: " Billing "
  });
  assert.equal(parsed.body, "Need help with billing");
  assert.equal(parsed.subject, "Billing");
});
