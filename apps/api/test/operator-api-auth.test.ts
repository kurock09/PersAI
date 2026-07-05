import test from "node:test";
import assert from "node:assert/strict";
import {
  isOperatorApiAuthConfigured,
  verifyOperatorApiToken
} from "../src/modules/identity-access/application/operator-api-auth";

void test("isOperatorApiAuthConfigured requires token and actor identity", () => {
  assert.equal(
    isOperatorApiAuthConfigured({
      PERSAI_OPERATOR_TOKEN: "secret",
      PERSAI_OPERATOR_ACTOR_USER_ID: "user-1",
      PERSAI_OPERATOR_ACTOR_EMAIL: undefined
    }),
    true
  );
  assert.equal(
    isOperatorApiAuthConfigured({
      PERSAI_OPERATOR_TOKEN: "secret",
      PERSAI_OPERATOR_ACTOR_USER_ID: undefined,
      PERSAI_OPERATOR_ACTOR_EMAIL: "kurock09@gmail.com"
    }),
    true
  );
  assert.equal(
    isOperatorApiAuthConfigured({
      PERSAI_OPERATOR_TOKEN: undefined,
      PERSAI_OPERATOR_ACTOR_USER_ID: "user-1",
      PERSAI_OPERATOR_ACTOR_EMAIL: undefined
    }),
    false
  );
  assert.equal(
    isOperatorApiAuthConfigured({
      PERSAI_OPERATOR_TOKEN: "secret",
      PERSAI_OPERATOR_ACTOR_USER_ID: undefined,
      PERSAI_OPERATOR_ACTOR_EMAIL: undefined
    }),
    false
  );
});

void test("verifyOperatorApiToken uses timing-safe equality", () => {
  assert.equal(verifyOperatorApiToken("alpha-token", "alpha-token"), true);
  assert.equal(verifyOperatorApiToken("alpha-token", "beta-token"), false);
  assert.equal(verifyOperatorApiToken("short", "longer-token"), false);
});
