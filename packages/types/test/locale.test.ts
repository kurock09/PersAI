import assert from "node:assert/strict";
import { normalizeLocaleInput, resolvePreferredLocale } from "../src/locale";
import { resolveLegalDocumentVersion, resolveLegalMarket } from "../src/legal-market";

function run(): void {
  assert.equal(normalizeLocaleInput("ru-RU"), "ru");
  assert.equal(normalizeLocaleInput("en-US"), "en");
  assert.equal(normalizeLocaleInput("fr"), null);

  assert.equal(resolvePreferredLocale({ preferredLocale: "ru", workspaceLocale: "en" }), "ru");
  assert.equal(resolvePreferredLocale({ preferredLocale: null, workspaceLocale: "ru-RU" }), "ru");
  assert.equal(resolvePreferredLocale({ preferredLocale: null, workspaceLocale: null }), "en");
  assert.equal(resolveLegalMarket("RU"), "rf");
  assert.equal(resolveLegalMarket("ru"), "rf");
  assert.equal(resolveLegalMarket("DE"), "intl");
  assert.equal(resolveLegalMarket(null), "intl");
  assert.equal(resolveLegalDocumentVersion("rf", "terms"), "rf:persai_tos_mvp_v1");
  assert.equal(resolveLegalDocumentVersion("intl", "privacy"), "intl:persai_privacy_mvp_v1");
}

run();
