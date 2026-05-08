import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import { resolvedLocale } from "./billing-template-helpers";

const SHORT_COPY: Record<"ru" | "en", (plan: string) => string> = {
  en: (plan) =>
    `🔔 Your PersAI trial (${plan}) has ended. Your workspace moved to the free plan. Upgrade any time to restore paid features.`,
  ru: (plan) =>
    `🔔 Пробный период PersAI (${plan}) завершён. Рабочее пространство переведено на бесплатный план. Можно обновить тариф в любое время.`
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  return { subject: "", html: "", plainText: SHORT_COPY[l](facts.planDisplayName) };
}
