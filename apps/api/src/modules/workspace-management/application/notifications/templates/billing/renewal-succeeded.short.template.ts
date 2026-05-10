import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import { resolvedLocale } from "./billing-template-helpers";

const SHORT_COPY: Record<"ru" | "en", (plan: string) => string> = {
  en: (plan) => `✅ PersAI renewal successful. Your ${plan} subscription continues.`,
  ru: (plan) => `✅ Подписка PersAI ${plan} успешно продлена. Доступ продолжается.`
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  return { subject: "", html: "", plainText: SHORT_COPY[l](facts.planDisplayName) };
}
