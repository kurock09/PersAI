import test from "node:test";
import assert from "node:assert/strict";
import { loadPersaiAdminMcpConfig } from "../src/config.js";

void test("loadPersaiAdminMcpConfig requires actor email or user id", () => {
  assert.throws(
    () =>
      loadPersaiAdminMcpConfig({
        PERSAI_API_BASE_URL: "https://api.persai.dev",
        PERSAI_OPERATOR_TOKEN: "token"
      }),
    /PERSAI_OPERATOR_ACTOR/
  );

  const byEmail = loadPersaiAdminMcpConfig({
    PERSAI_API_BASE_URL: "https://api.persai.dev/",
    PERSAI_OPERATOR_TOKEN: "token",
    PERSAI_OPERATOR_ACTOR_EMAIL: "kurock09@gmail.com"
  });
  assert.equal(byEmail.apiBaseUrl, "https://api.persai.dev");
  assert.equal(byEmail.operatorActorEmail, "kurock09@gmail.com");
});
