import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import {
  buildHtml,
  buildPlainText,
  copy,
  formatDate,
  resolvedLocale
} from "./billing-template-helpers";

const SUBJECTS: Record<"ru" | "en", string> = {
  en: "Your PersAI trial ends soon",
  ru: "Пробный период PersAI скоро завершится"
};

const HEADINGS: Record<"ru" | "en", string> = {
  en: "Trial ending soon",
  ru: "Пробный период заканчивается"
};

const BODY_LINES: Record<"ru" | "en", (plan: string, date: string) => string[]> = {
  en: (plan, date) => [
    `Your PersAI trial for <strong>${plan}</strong> ends on ${date}.`,
    "To keep all paid features active after the trial, choose a paid plan before it expires.",
    "If you take no action, your workspace will be moved to the free fallback plan."
  ],
  ru: (plan, date) => [
    `Ваш пробный период PersAI для тарифа <strong>${plan}</strong> завершится ${date}.`,
    "Чтобы сохранить доступ к платным функциям после окончания пробного периода, выберите платный тариф.",
    "Если ничего не предпринять, рабочее пространство будет переведено на бесплатный план."
  ]
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  const c = copy(l);
  const relevantDate = facts.trialEndsAt ?? facts.periodEndsAt;
  const dateStr = formatDate(relevantDate, l);
  const bodyLines = BODY_LINES[l](facts.planDisplayName, dateStr);

  const rows = [
    { label: c.planLabel, value: facts.planDisplayName },
    { label: c.trialLabel, value: dateStr }
  ];

  const html = buildHtml({ locale: l, title: SUBJECTS[l], heading: HEADINGS[l], bodyLines, rows });
  const plainText = buildPlainText({ locale: l, heading: HEADINGS[l], bodyLines, rows });

  return { subject: SUBJECTS[l], html, plainText };
}
