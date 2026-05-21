import assert from "node:assert/strict";
import test from "node:test";
import { ManageAdminSupportService } from "../src/modules/workspace-management/application/support/manage-admin-support.service";

test("parseReplyInput rejects empty reply", () => {
  const service = new ManageAdminSupportService({} as never, {} as never, {} as never);
  assert.throws(() => service.parseReplyInput({ body: "  " }), /at least 3 characters/);
});

test("parseReplyInput trims body", () => {
  const service = new ManageAdminSupportService({} as never, {} as never, {} as never);
  assert.deepEqual(service.parseReplyInput({ body: "  Hello support  " }), {
    body: "Hello support"
  });
});
