import assert from "node:assert/strict";
import { normalizeLocaleInput, resolvePreferredLocale } from "../src/locale";

function run(): void {
  assert.equal(normalizeLocaleInput("ru-RU"), "ru");
  assert.equal(normalizeLocaleInput("en-US"), "en");
  assert.equal(normalizeLocaleInput("fr"), null);

  assert.equal(resolvePreferredLocale({ preferredLocale: "ru", workspaceLocale: "en" }), "ru");
  assert.equal(resolvePreferredLocale({ preferredLocale: null, workspaceLocale: "ru-RU" }), "ru");
  assert.equal(resolvePreferredLocale({ preferredLocale: null, workspaceLocale: null }), "en");
}

run();
