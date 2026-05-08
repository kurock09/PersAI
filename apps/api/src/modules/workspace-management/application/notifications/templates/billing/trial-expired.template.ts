import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import { buildHtml, buildPlainText, copy, resolvedLocale } from "./billing-template-helpers";

const SUBJECTS: Record<"ru" | "en", string> = {
  en: "Your PersAI trial has ended",
  ru: "Пробный период PersAI завершён"
};

const HEADINGS: Record<"ru" | "en", string> = {
  en: "Trial ended",
  ru: "Пробный период завершён"
};

const BODY_LINES: Record<"ru" | "en", (plan: string) => string[]> = {
  en: (plan) => [
    `Your PersAI trial for <strong>${plan}</strong> has ended.`,
    "Your workspace has been moved to the free fallback plan.",
    "To restore paid access, choose a paid plan at any time."
  ],
  ru: (plan) => [
    `Ваш пробный период PersAI для тарифа <strong>${plan}</strong> завершён.`,
    "Рабочее пространство переведено на бесплатный план.",
    "Чтобы восстановить доступ к платным функциям, выберите платный тариф."
  ]
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  const c = copy(l);
  const bodyLines = BODY_LINES[l](facts.planDisplayName);
  const rows = [{ label: c.planLabel, value: facts.planDisplayName }];
  const html = buildHtml({ locale: l, title: SUBJECTS[l], heading: HEADINGS[l], bodyLines, rows });
  const plainText = buildPlainText({ locale: l, heading: HEADINGS[l], bodyLines, rows });
  return { subject: SUBJECTS[l], html, plainText };
}
