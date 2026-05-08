import type { BillingLifecycleFactPayload } from "./billing-lifecycle-fact-payload";
import { formatDate, resolvedLocale } from "./billing-template-helpers";

const SHORT_COPY: Record<"ru" | "en", (plan: string, date: string) => string> = {
  en: (plan, date) =>
    `⏳ Your PersAI trial (${plan}) ends ${date}. Choose a paid plan to keep all features.`,
  ru: (plan, date) =>
    `⏳ Пробный период PersAI (${plan}) заканчивается ${date}. Выберите платный тариф для сохранения доступа.`
};

export default function render(
  facts: BillingLifecycleFactPayload,
  locale: "ru" | "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(locale ?? facts.locale);
  const date = formatDate(facts.trialEndsAt ?? facts.periodEndsAt, l);
  return { subject: "", html: "", plainText: SHORT_COPY[l](facts.planDisplayName, date) };
}
