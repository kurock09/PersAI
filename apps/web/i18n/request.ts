import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

const SUPPORTED_LOCALES = ["en", "ru"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get("persai-locale")?.value;
  if (cookie && isSupportedLocale(cookie)) return cookie;

  const headerStore = await headers();
  const accept = headerStore.get("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const lang = part.trim().split(";")[0]?.split("-")[0]?.toLowerCase() ?? "";
    if (isSupportedLocale(lang)) return lang;
  }

  return "en";
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
