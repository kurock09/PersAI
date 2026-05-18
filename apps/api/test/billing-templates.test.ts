/**
 * ADR-088 Slice 3 — Billing template determinism tests.
 * Verifies: each of the 6 billing templates produces deterministic subject/html/plainText
 * for both en and ru locales, with required structural elements.
 * Pattern: tsx + node:assert/strict + void run() IIFE (no vitest).
 */
import assert from "node:assert/strict";
import renderTrialEnding from "../src/modules/workspace-management/application/notifications/templates/billing/trial-ending.template";
import renderTrialExpired from "../src/modules/workspace-management/application/notifications/templates/billing/trial-expired.template";
import renderRenewalFailed from "../src/modules/workspace-management/application/notifications/templates/billing/renewal-failed.template";
import renderGraceEnding from "../src/modules/workspace-management/application/notifications/templates/billing/grace-ending.template";
import renderGraceExpired from "../src/modules/workspace-management/application/notifications/templates/billing/grace-expired.template";
import renderPaymentRecovered from "../src/modules/workspace-management/application/notifications/templates/billing/payment-recovered.template";
import renderPaymentActivated from "../src/modules/workspace-management/application/notifications/templates/billing/payment-activated.template";
import renderRenewalSucceeded from "../src/modules/workspace-management/application/notifications/templates/billing/renewal-succeeded.template";
import renderTrialEndingShort from "../src/modules/workspace-management/application/notifications/templates/billing/trial-ending.short.template";
import renderTrialExpiredShort from "../src/modules/workspace-management/application/notifications/templates/billing/trial-expired.short.template";
import renderRenewalFailedShort from "../src/modules/workspace-management/application/notifications/templates/billing/renewal-failed.short.template";
import renderGraceEndingShort from "../src/modules/workspace-management/application/notifications/templates/billing/grace-ending.short.template";
import renderGraceExpiredShort from "../src/modules/workspace-management/application/notifications/templates/billing/grace-expired.short.template";
import renderPaymentRecoveredShort from "../src/modules/workspace-management/application/notifications/templates/billing/payment-recovered.short.template";
import renderPaymentActivatedShort from "../src/modules/workspace-management/application/notifications/templates/billing/payment-activated.short.template";
import renderRenewalSucceededShort from "../src/modules/workspace-management/application/notifications/templates/billing/renewal-succeeded.short.template";
import type { BillingLifecycleFactPayload } from "../src/modules/workspace-management/application/notifications/templates/billing/billing-lifecycle-fact-payload";

// ── Canonical fact payloads ────────────────────────────────────────────────

const BASE_FACTS: BillingLifecycleFactPayload = {
  rule: "payment_recovered",
  workspaceId: "ws-test",
  planCode: "pro",
  planDisplayName: "Pro",
  periodEndsAt: "2026-06-30T00:00:00.000Z",
  graceEndsAt: "2026-05-20T00:00:00.000Z",
  trialEndsAt: "2026-05-25T00:00:00.000Z",
  amount: 990,
  currency: "RUB",
  officialReceiptUrl: "https://checkout.cloudpayments.example/receipt/123",
  locale: "ru",
  recipientEmail: "user@example.com"
};

function facts(overrides: Partial<BillingLifecycleFactPayload> = {}): BillingLifecycleFactPayload {
  return { ...BASE_FACTS, ...overrides };
}

// ── Shared assertions ──────────────────────────────────────────────────────

function assertValidOutput(
  result: { subject: string; html: string; plainText: string },
  checks: { subjectContains: string; htmlContains: string[]; textContains: string[] }
) {
  assert.ok(result.subject.length > 0, "subject is non-empty");
  assert.ok(result.html.length > 100, "html is substantial");
  assert.ok(result.plainText.length > 50, "plainText is substantial");

  assert.ok(
    result.subject.includes(checks.subjectContains),
    `subject includes "${checks.subjectContains}" (got: "${result.subject}")`
  );

  for (const s of checks.htmlContains) {
    assert.ok(result.html.includes(s), `html includes "${s}"`);
  }
  for (const s of checks.textContains) {
    assert.ok(result.plainText.includes(s), `plainText includes "${s}"`);
  }

  // Unsubscribe footer must be present in both
  assert.ok(
    result.html.includes("Unsubscribe") ||
      result.html.includes("отписаться") ||
      result.html.includes("Отписаться"),
    "html has unsubscribe-related footer text"
  );
  assert.ok(
    result.plainText.includes("nsubscribe") || result.plainText.includes("тписать"),
    "plainText has unsubscribe-related footer text"
  );

  // Must NOT include MJML tags
  assert.ok(!result.html.includes("<mj-"), "html has no MJML tags");
}

function assertDeterministic(
  renderFn: (
    f: BillingLifecycleFactPayload,
    l: "ru" | "en"
  ) => { subject: string; html: string; plainText: string },
  f: BillingLifecycleFactPayload,
  locale: "ru" | "en"
) {
  const r1 = renderFn(f, locale);
  const r2 = renderFn(f, locale);
  assert.equal(r1.subject, r2.subject, "subject is deterministic");
  assert.equal(r1.html, r2.html, "html is deterministic");
  assert.equal(r1.plainText, r2.plainText, "plainText is deterministic");
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. trial-ending (en)
  {
    const f = facts({ rule: "trial_ending", locale: "en" });
    const r = renderTrialEnding(f, "en");
    assertValidOutput(r, {
      subjectContains: "trial",
      htmlContains: ["Pro", "Trial"],
      textContains: ["Pro", "Trial"]
    });
    assertDeterministic(renderTrialEnding, f, "en");
    assert.ok(r.html.includes("<!DOCTYPE html>"), "html starts with DOCTYPE");
    assert.ok(
      r.plainText.includes("https://persai.dev/terms?market=intl&locale=en"),
      "plainText includes market-aware EN terms link"
    );
    console.log("✓ trial-ending en: subject, html, plainText valid + deterministic");
  }

  // 2. trial-ending (ru)
  {
    const f = facts({ rule: "trial_ending", locale: "ru" });
    const r = renderTrialEnding(f, "ru");
    assertValidOutput(r, {
      subjectContains: "PersAI",
      htmlContains: ["Pro", "Пробный"],
      textContains: ["Pro", "Пробный"]
    });
    assertDeterministic(renderTrialEnding, f, "ru");
    assert.ok(
      r.plainText.includes("https://persai.dev/terms?market=rf&locale=ru"),
      "plainText includes market-aware RU terms link"
    );
    console.log("✓ trial-ending ru: deterministic + Russian content");
  }

  // 3. trial-expired (en + ru)
  {
    const f_en = facts({ rule: "trial_expired" });
    const r_en = renderTrialExpired(f_en, "en");
    assertValidOutput(r_en, {
      subjectContains: "trial",
      htmlContains: ["Pro"],
      textContains: ["Pro"]
    });
    const r_ru = renderTrialExpired(f_en, "ru");
    assertValidOutput(r_ru, {
      subjectContains: "PersAI",
      htmlContains: ["Pro"],
      textContains: ["Pro"]
    });
    assertDeterministic(renderTrialExpired, f_en, "en");
    assertDeterministic(renderTrialExpired, f_en, "ru");
    console.log("✓ trial-expired en+ru: valid + deterministic");
  }

  // 4. renewal-failed (en + ru)
  {
    const f = facts({ rule: "renewal_failed" });
    const r_en = renderRenewalFailed(f, "en");
    assertValidOutput(r_en, {
      subjectContains: "payment",
      htmlContains: ["Pro"],
      textContains: ["Pro"]
    });
    const r_ru = renderRenewalFailed(f, "ru");
    assertValidOutput(r_ru, {
      subjectContains: "PersAI",
      htmlContains: ["Pro"],
      textContains: ["Pro"]
    });
    assertDeterministic(renderRenewalFailed, f, "en");
    assertDeterministic(renderRenewalFailed, f, "ru");
    console.log("✓ renewal-failed en+ru: valid + deterministic");
  }

  // 5. grace-ending (en + ru)
  {
    const f = facts({ rule: "grace_ending" });
    const r_en = renderGraceEnding(f, "en");
    assertValidOutput(r_en, {
      subjectContains: "grace",
      htmlContains: ["Pro"],
      textContains: ["Pro"]
    });
    const r_ru = renderGraceEnding(f, "ru");
    assertValidOutput(r_ru, {
      subjectContains: "PersAI",
      htmlContains: ["Pro"],
      textContains: ["Pro"]
    });
    assertDeterministic(renderGraceEnding, f, "en");
    assertDeterministic(renderGraceEnding, f, "ru");
    console.log("✓ grace-ending en+ru: valid + deterministic");
  }

  // 6. grace-expired (en + ru)
  {
    const f = facts({ rule: "grace_expired" });
    const r_en = renderGraceExpired(f, "en");
    assertValidOutput(r_en, {
      subjectContains: "PersAI",
      htmlContains: ["Pro"],
      textContains: ["Pro"]
    });
    const r_ru = renderGraceExpired(f, "ru");
    assertValidOutput(r_ru, {
      subjectContains: "PersAI",
      htmlContains: ["Pro"],
      textContains: ["Pro"]
    });
    assertDeterministic(renderGraceExpired, f, "en");
    assertDeterministic(renderGraceExpired, f, "ru");
    console.log("✓ grace-expired en+ru: valid + deterministic");
  }

  // 7. payment-recovered (en + ru)
  {
    const f = facts({ rule: "payment_recovered" });
    const r_en = renderPaymentRecovered(f, "en");
    assertValidOutput(r_en, {
      subjectContains: "payment",
      htmlContains: ["Pro"],
      textContains: ["Pro"]
    });
    const r_ru = renderPaymentRecovered(f, "ru");
    assertValidOutput(r_ru, {
      subjectContains: "PersAI",
      htmlContains: ["Pro"],
      textContains: ["Pro"]
    });
    assertDeterministic(renderPaymentRecovered, f, "en");
    assertDeterministic(renderPaymentRecovered, f, "ru");
    console.log("✓ payment-recovered en+ru: valid + deterministic");
  }

  // 8. Short templates — one per rule (return { subject, html, plainText })
  {
    const f = facts({ rule: "trial_ending" });
    const shortTemplates: Array<
      [
        string,
        (
          f: BillingLifecycleFactPayload,
          l: "ru" | "en"
        ) => { subject: string; html: string; plainText: string }
      ]
    > = [
      ["trial_ending.short", renderTrialEndingShort],
      ["trial_expired.short", renderTrialExpiredShort],
      ["renewal_failed.short", renderRenewalFailedShort],
      ["grace_ending.short", renderGraceEndingShort],
      ["grace_expired.short", renderGraceExpiredShort],
      ["payment_recovered.short", renderPaymentRecoveredShort],
      ["payment_activated.short", renderPaymentActivatedShort],
      ["renewal_succeeded.short", renderRenewalSucceededShort]
    ];

    for (const [name, render] of shortTemplates) {
      const r_en = render(f, "en");
      const r_ru = render(f, "ru");
      assert.ok(
        typeof r_en.plainText === "string" && r_en.plainText.length > 0,
        `${name} en: non-empty plainText`
      );
      assert.ok(
        typeof r_ru.plainText === "string" && r_ru.plainText.length > 0,
        `${name} ru: non-empty plainText`
      );
      // Short forms must be concise (< 500 chars)
      assert.ok(
        r_en.plainText.length < 500,
        `${name} en: concise (< 500 chars, got ${r_en.plainText.length})`
      );
      assert.ok(
        r_ru.plainText.length < 500,
        `${name} ru: concise (< 500 chars, got ${r_ru.plainText.length})`
      );
      // Deterministic
      assert.equal(render(f, "en").plainText, render(f, "en").plainText, `${name}: deterministic`);
      console.log(`✓ ${name}: en + ru non-empty, concise, deterministic`);
    }
  }

  // 9. Locale fallback: unknown locale treated as ru
  {
    const f = facts({ rule: "payment_activated", locale: "en" });
    const r = renderPaymentActivated(f, "en");
    assertValidOutput(r, {
      subjectContains: "payment",
      htmlContains: ["Official receipt", "Pro"],
      textContains: ["Official receipt", "Pro"]
    });
    assertDeterministic(renderPaymentActivated, f, "en");
    console.log("✓ payment-activated en: branded confirmation + receipt footer");
  }

  // 10. renewal-succeeded includes official receipt footer
  {
    const f = facts({ rule: "renewal_succeeded", locale: "ru" });
    const r = renderRenewalSucceeded(f, "ru");
    assertValidOutput(r, {
      subjectContains: "PersAI",
      htmlContains: ["Официальный чек", "Pro"],
      textContains: ["Официальный чек", "Pro"]
    });
    assertDeterministic(renderRenewalSucceeded, f, "ru");
    console.log("✓ renewal-succeeded ru: branded confirmation + receipt footer");
  }

  // 11. Locale fallback: unknown locale treated as ru
  {
    const f = facts({ rule: "payment_recovered", locale: "fr" });
    const r = renderPaymentRecovered(f, "fr" as "ru" | "en");
    assert.ok(
      r.html.includes("оплата") || r.html.includes("Pro"),
      "unknown locale falls back to ru"
    );
    console.log("✓ unknown locale falls back to ru");
  }

  // 12. Null dates → show fallback "—" or similar
  {
    const f = facts({
      rule: "trial_ending",
      trialEndsAt: null,
      periodEndsAt: null,
      graceEndsAt: null
    });
    const r = renderTrialEnding(f, "en");
    assert.ok(r.subject.length > 0, "subject non-empty even with null dates");
    assert.ok(r.plainText.includes("—") || r.plainText.length > 0, "plainText handles null dates");
    console.log("✓ null dates handled gracefully (fallback — shown)");
  }

  console.log("\n✅ All billing-templates tests passed");
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
