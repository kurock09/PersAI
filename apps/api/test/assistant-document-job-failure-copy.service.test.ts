import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildAssistantDocumentJobFailureMessage,
  buildAssistantDocumentJobPreparingMessage,
  inferAssistantDocumentJobFailureLocale
} from "../src/modules/workspace-management/application/assistant-document-job-failure-copy.service";

describe("inferAssistantDocumentJobFailureLocale", () => {
  test("prefers explicit ru preferred locale", () => {
    const locale = inferAssistantDocumentJobFailureLocale({
      preferredLocale: "ru-RU",
      sourceText: "make me a pdf please"
    });
    assert.equal(locale, "ru");
  });

  test("prefers explicit en preferred locale", () => {
    const locale = inferAssistantDocumentJobFailureLocale({
      preferredLocale: "en-US",
      sourceText: "сделай pdf"
    });
    assert.equal(locale, "en");
  });

  test("falls back to ru when source text contains cyrillic", () => {
    const locale = inferAssistantDocumentJobFailureLocale({
      preferredLocale: null,
      sourceText: "сделай мне pdf"
    });
    assert.equal(locale, "ru");
  });

  test("falls back to en when no preferred locale and no cyrillic", () => {
    const locale = inferAssistantDocumentJobFailureLocale({
      preferredLocale: null,
      sourceText: "make me a pdf"
    });
    assert.equal(locale, "en");
  });
});

describe("buildAssistantDocumentJobFailureMessage", () => {
  test("returns a calm ru fallback when the failure looks ordinary", () => {
    const message = buildAssistantDocumentJobFailureMessage({
      code: "document_artifacts_missing",
      message: "Worker completed without artifacts.",
      locale: "ru"
    });
    assert.match(message, /Не смог завершить/);
    assert.match(message, /попробуйте/i);
  });

  test("returns an English fallback for en locale", () => {
    const message = buildAssistantDocumentJobFailureMessage({
      code: "document_artifacts_missing",
      message: "Worker completed without artifacts.",
      locale: "en"
    });
    assert.match(message, /I couldn't finish/);
    assert.match(message, /try again/i);
  });

  test("uses a policy-aware ru message when the failure looks like a provider safety block", () => {
    const message = buildAssistantDocumentJobFailureMessage({
      code: "document_provider_failed",
      message: "Provider returned policy violation: content_blocked.",
      locale: "ru"
    });
    assert.match(message, /политикой безопасности/);
    assert.match(message, /переформулиров/i);
  });

  test("uses a policy-aware en message when the failure looks like a provider safety block", () => {
    const message = buildAssistantDocumentJobFailureMessage({
      code: "moderation_blocked",
      message: "NSFW content detected.",
      locale: "en"
    });
    assert.match(message, /safety policy/);
    assert.match(message, /rephrase/i);
  });
});

describe("buildAssistantDocumentJobPreparingMessage", () => {
  test("localizes the temporary document delivery placeholder", () => {
    assert.equal(buildAssistantDocumentJobPreparingMessage("ru"), "Готовлю документ...");
    assert.equal(buildAssistantDocumentJobPreparingMessage("en"), "Preparing your document...");
  });
});
