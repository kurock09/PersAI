import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import {
  buildHtml,
  buildPlainText,
  copy,
  formatDate,
  resolvedLocale
} from "./billing-template-helpers";

const SUBJECTS: Record<"ru" | "en", string> = {
  en: "PersAI workspace moved to fallback plan",
  ru: "Рабочее пространство PersAI переведено на базовый план"
};

const HEADINGS: Record<"ru" | "en", string> = {
  en: "Grace period expired",
  ru: "Льготный период истёк"
};

const BODY_LINES: Record<"ru" | "en", (plan: string) => string[]> = {
  en: (plan) => [
    `The grace period for your <strong>${plan}</strong> subscription has expired.`,
    "Your workspace has been moved to the free fallback plan.",
    "To restore paid access, update your payment and reactivate your subscription at any time."
  ],
  ru: (plan) => [
    `Льготный период для подписки <strong>${plan}</strong> истёк.`,
    "Рабочее пространство переведено на бесплатный план.",
    "Чтобы восстановить платный доступ, обновите платёж и переактивируйте подписку."
  ]
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  const c = copy(l);
  const graceDate = formatDate(facts.graceEndsAt, l);
  const bodyLines = BODY_LINES[l](facts.planDisplayName);
  const rows = [
    { label: c.planLabel, value: facts.planDisplayName },
    { label: c.graceLabel, value: graceDate }
  ];
  const html = buildHtml({ locale: l, title: SUBJECTS[l], heading: HEADINGS[l], bodyLines, rows });
  const plainText = buildPlainText({ locale: l, heading: HEADINGS[l], bodyLines, rows });
  return { subject: SUBJECTS[l], html, plainText };
}
