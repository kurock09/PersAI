import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import { resolvedLocale } from "./billing-template-helpers";

const SHORT_COPY: Record<"ru" | "en", (plan: string) => string> = {
  en: (plan) =>
    `🔔 PersAI grace period for ${plan} expired. Your workspace moved to the free plan. Restore payment to reactivate.`,
  ru: (plan) =>
    `🔔 Льготный период PersAI (${plan}) истёк. Рабочее пространство переведено на бесплатный план. Восстановите оплату для реактивации.`
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  return { subject: "", html: "", plainText: SHORT_COPY[l](facts.planDisplayName) };
}
