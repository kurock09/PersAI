import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import { resolvedLocale } from "./billing-template-helpers";

const SHORT_COPY: Record<"ru" | "en", (plan: string) => string> = {
  en: (plan) => `✅ PersAI payment received. Your ${plan} access is active.`,
  ru: (plan) => `✅ Оплата PersAI получена. Доступ по тарифу ${plan} активен.`
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  return { subject: "", html: "", plainText: SHORT_COPY[l](facts.planDisplayName) };
}
