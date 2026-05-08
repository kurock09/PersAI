import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import { formatDate, resolvedLocale } from "./billing-template-helpers";

const SHORT_COPY: Record<"ru" | "en", (plan: string, graceDate: string) => string> = {
  en: (plan, graceDate) =>
    `⚠️ PersAI grace period for ${plan} ends ${graceDate}. Update payment now to keep paid access.`,
  ru: (plan, graceDate) =>
    `⚠️ Льготный период PersAI (${plan}) заканчивается ${graceDate}. Обновите платёж, чтобы сохранить доступ.`
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  const graceDate = formatDate(facts.graceEndsAt, l);
  return { subject: "", html: "", plainText: SHORT_COPY[l](facts.planDisplayName, graceDate) };
}
