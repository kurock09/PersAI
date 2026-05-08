import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import {
  buildHtml,
  buildPlainText,
  copy,
  formatDate,
  resolvedLocale
} from "./billing-template-helpers";

const SUBJECTS: Record<"ru" | "en", string> = {
  en: "PersAI payment renewal failed",
  ru: "Ошибка продления подписки PersAI"
};

const HEADINGS: Record<"ru" | "en", string> = {
  en: "Payment renewal failed",
  ru: "Не удалось продлить подписку"
};

const BODY_LINES: Record<"ru" | "en", (plan: string, graceDate: string) => string[]> = {
  en: (plan, graceDate) => [
    `The automatic renewal payment for your <strong>${plan}</strong> subscription failed.`,
    `Your paid access remains active during the grace period until ${graceDate}.`,
    "Please update your payment method to avoid being moved to the free fallback plan."
  ],
  ru: (plan, graceDate) => [
    `Не удалось провести платёж для автоматического продления подписки <strong>${plan}</strong>.`,
    `Платный доступ сохраняется в течение льготного периода до ${graceDate}.`,
    "Пожалуйста, обновите платёжный метод, чтобы избежать перевода на бесплатный план."
  ]
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  const c = copy(l);
  const graceDate = formatDate(facts.graceEndsAt, l);
  const bodyLines = BODY_LINES[l](facts.planDisplayName, graceDate);
  const rows = [
    { label: c.planLabel, value: facts.planDisplayName },
    { label: c.graceLabel, value: graceDate }
  ];
  const html = buildHtml({ locale: l, title: SUBJECTS[l], heading: HEADINGS[l], bodyLines, rows });
  const plainText = buildPlainText({ locale: l, heading: HEADINGS[l], bodyLines, rows });
  return { subject: SUBJECTS[l], html, plainText };
}
