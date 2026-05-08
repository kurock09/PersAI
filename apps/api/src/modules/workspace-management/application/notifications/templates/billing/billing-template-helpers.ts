/**
 * Shared HTML/text helpers for billing lifecycle email templates.
 * Keeps each template file focused on its own content.
 * ADR-088 §10 — inline HTML (MJML compilation is a future improvement).
 */

const COPY = {
  en: {
    greeting: "Hi,",
    footer:
      "You are receiving this email because you have an active PersAI account.\nTo unsubscribe from these transactional notifications, use the Unsubscribe link in your email client.",
    planLabel: "Plan",
    periodLabel: "Period ends",
    graceLabel: "Grace ends",
    trialLabel: "Trial ends",
    amountLabel: "Amount",
    notAvailable: "—"
  },
  ru: {
    greeting: "Здравствуйте,",
    footer:
      "Это письмо отправлено, потому что у вас есть активный аккаунт PersAI.\nЧтобы отписаться от транзакционных уведомлений, воспользуйтесь ссылкой «Отписаться» в вашем почтовом клиенте.",
    planLabel: "Тариф",
    periodLabel: "Период до",
    graceLabel: "Льготный период до",
    trialLabel: "Пробный период до",
    amountLabel: "Сумма",
    notAvailable: "—"
  }
};

export function resolvedLocale(locale: string): "ru" | "en" {
  return locale === "en" ? "en" : "ru";
}

export function copy(locale: string): (typeof COPY)["en"] {
  return COPY[resolvedLocale(locale)];
}

export function formatDate(isoString: string | null | undefined, locale: string): string {
  if (!isoString) return COPY[resolvedLocale(locale)].notAvailable;
  try {
    return new Date(isoString).toLocaleDateString(locale === "en" ? "en-US" : "ru-RU", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch {
    return isoString;
  }
}

export function buildHtml(params: {
  locale: string;
  title: string;
  heading: string;
  bodyLines: string[];
  rows: Array<{ label: string; value: string }>;
}): string {
  const { locale, title, heading, bodyLines, rows } = params;
  const c = copy(locale);
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td style="color:#888;font-size:13px;padding:4px 0">${r.label}</td>` +
        `<td style="text-align:right;font-size:13px;color:#1a1a1a;padding:4px 0">${r.value}</td></tr>`
    )
    .join("\n");
  const bodyHtml = bodyLines.map((l) => `<p style="color:#555;margin:8px 0">${l}</p>`).join("\n");
  return `<!DOCTYPE html>
<html lang="${resolvedLocale(locale)}">
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:sans-serif;background:#f8f8f8;padding:32px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px">
    <h2 style="color:#1a1a1a;margin-bottom:8px">${heading}</h2>
    <p style="color:#555;margin-bottom:16px">${c.greeting}</p>
    ${bodyHtml}
    ${
      rows.length > 0
        ? `<table style="width:100%;border-top:1px solid #eee;margin-top:24px;padding-top:16px">
      ${rowsHtml}
    </table>`
        : ""
    }
    <p style="color:#888;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
      ${c.footer.replace(/\n/g, "<br>")}
    </p>
  </div>
</body>
</html>`;
}

export function buildPlainText(params: {
  locale: string;
  heading: string;
  bodyLines: string[];
  rows: Array<{ label: string; value: string }>;
}): string {
  const { locale, heading, bodyLines, rows } = params;
  const c = copy(locale);
  const lines: string[] = [heading, "", c.greeting, ""];
  lines.push(...bodyLines, "");
  if (rows.length > 0) {
    for (const r of rows) {
      lines.push(`${r.label}: ${r.value}`);
    }
    lines.push("");
  }
  lines.push("---", c.footer);
  return lines.join("\n");
}
