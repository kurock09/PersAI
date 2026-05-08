import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import { formatDate, resolvedLocale } from "./billing-template-helpers";

const SHORT_COPY: Record<"ru" | "en", (plan: string, graceDate: string) => string> = {
  en: (plan, graceDate) =>
    `⚠️ PersAI renewal payment failed for ${plan}. Grace period until ${graceDate}. Please update your payment to avoid fallback.`,
  ru: (plan, graceDate) =>
    `⚠️ Не удалось продлить подписку PersAI (${plan}). Льготный период до ${graceDate}. Обновите платёжный метод, чтобы избежать перевода на бесплатный план.`
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  const graceDate = formatDate(facts.graceEndsAt, l);
  return { subject: "", html: "", plainText: SHORT_COPY[l](facts.planDisplayName, graceDate) };
}
