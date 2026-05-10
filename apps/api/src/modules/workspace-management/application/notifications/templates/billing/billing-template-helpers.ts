/**
 * Shared HTML/text helpers for billing lifecycle email templates.
 *
 * Design: PersAI light premium — warm sand background, cream card, no heavy
 * shadows, clean vertical rhythm, system font stack.
 * All email layout is inline-style table-based for cross-client compatibility.
 *
 * Footer links point to persai.dev (production). The env var PERSAI_WEB_BASE_URL
 * is not read here because billing email helpers run inside the template renderer
 * without direct env access; persai.dev is the canonical public origin (GitOps
 * values-dev.yaml sets PERSAI_WEB_BASE_URL=https://persai.dev).
 *
 * ADR-088 §10.
 */

const SITE = "https://persai.dev";

const COPY = {
  en: {
    greeting: "Hi,",
    footerThanks: "Thank you for choosing PersAI.",
    footerSupportText: "For any questions, reach us at",
    footerCabinet: "Manage your subscription",
    footerReceiptLabel: "Official receipt",
    footerReceiptHelp:
      "This email is a PersAI payment confirmation. The official fiscal receipt is issued by the payment provider or cash-register service.",
    footerUnsubscribe:
      "You receive this because you have an active PersAI account. To unsubscribe from billing notifications, use the Unsubscribe option in your email client.",
    linkPricing: "Pricing",
    linkTerms: "Terms",
    linkPrivacy: "Privacy",
    linkContacts: "Contacts",
    linkRequisites: "Legal",
    planLabel: "Plan",
    periodLabel: "Period ends",
    graceLabel: "Grace ends",
    trialLabel: "Trial ends",
    amountLabel: "Amount",
    notAvailable: "—"
  },
  ru: {
    greeting: "Здравствуйте,",
    footerThanks: "Спасибо, что выбрали PersAI.",
    footerSupportText: "По любым вопросам:",
    footerCabinet: "Управление подпиской",
    footerReceiptLabel: "Официальный чек",
    footerReceiptHelp:
      "Это письмо — подтверждение оплаты от PersAI. Официальный фискальный чек формирует платёжный провайдер или кассовый контур.",
    footerUnsubscribe:
      "Вы получаете это письмо, потому что у вас есть активный аккаунт PersAI. Чтобы отписаться от уведомлений, воспользуйтесь кнопкой «Отписаться» в вашем почтовом клиенте.",
    linkPricing: "Тарифы",
    linkTerms: "Условия",
    linkPrivacy: "Конфиденциальность",
    linkContacts: "Контакты",
    linkRequisites: "Реквизиты",
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

// ── HTML builder ──────────────────────────────────────────────────────────────

export function buildHtml(params: {
  locale: string;
  title: string;
  heading: string;
  bodyLines: string[];
  rows: Array<{ label: string; value: string }>;
  officialReceiptUrl?: string | null;
}): string {
  const { locale, title, heading, bodyLines, rows, officialReceiptUrl = null } = params;
  const lang = resolvedLocale(locale);
  const c = copy(lang);

  // Body paragraphs
  const bodyHtml = bodyLines
    .map((l) => `<p style="margin:0 0 12px;font-size:15px;color:#49443f;line-height:1.65">${l}</p>`)
    .join("\n              ");

  // Fact rows table (plan, date, amount, etc.)
  const rowsSection =
    rows.length > 0
      ? `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
            style="border-top:1px solid #ede7de;margin-top:20px;padding-top:0">
            <tr><td style="padding-top:16px">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                ${rows
                  .map(
                    (r) =>
                      `<tr>` +
                      `<td style="padding:5px 0;font-size:13px;color:#8a837c;width:50%">${r.label}</td>` +
                      `<td style="padding:5px 0;font-size:13px;color:#1a1714;font-weight:500;text-align:right">${r.value}</td>` +
                      `</tr>`
                  )
                  .join("\n                ")}
              </table>
            </td></tr>
          </table>`
      : "";

  // Footer link row
  const footerLinks = [
    { href: `${SITE}/#pricing`, label: c.linkPricing },
    { href: `${SITE}/terms`, label: c.linkTerms },
    { href: `${SITE}/privacy`, label: c.linkPrivacy },
    { href: `${SITE}/contacts`, label: c.linkContacts },
    { href: `${SITE}/requisites`, label: c.linkRequisites }
  ]
    .map(
      (lnk) =>
        `<a href="${lnk.href}" style="color:#8a837c;text-decoration:none;font-size:12px">${lnk.label}</a>`
    )
    .join("&ensp;&middot;&ensp;");

  const receiptBlock =
    officialReceiptUrl !== null
      ? `<p style="margin:0 0 12px;font-size:12px;line-height:1.7;color:#6d665f">${c.footerReceiptHelp} <a href="${officialReceiptUrl}" style="color:#4a6fa5;text-decoration:none">${c.footerReceiptLabel}</a></p>`
      : `<p style="margin:0 0 12px;font-size:12px;line-height:1.7;color:#6d665f">${c.footerReceiptHelp}</p>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f3ede6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">

  <!-- Hidden preheader text (shown in inbox preview) -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:transparent;max-width:0">${heading}</div>

  <!-- Outer wrapper -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
    style="background:#f3ede6">
    <tr>
      <td align="center" style="padding:40px 20px">

        <!-- Card -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
          style="max-width:560px;background:#fefbf7;border:1px solid #e8dfd4;border-radius:12px">

          <!-- Brand header -->
          <tr>
            <td style="padding:22px 32px 18px;border-bottom:1px solid #ede7de">
              <span style="font-size:14px;font-weight:700;letter-spacing:0.3px;color:#1a1714">PersAI</span>
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="padding:32px 32px 28px">
              <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;line-height:1.3;letter-spacing:-0.3px;color:#1a1714">${heading}</h1>
              <p style="margin:0 0 16px;font-size:15px;color:#49443f;line-height:1.65">${c.greeting}</p>
              ${bodyHtml}
              ${rowsSection}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #ede7de;background:#faf5ef;border-radius:0 0 12px 12px">
              <p style="margin:0 0 6px;font-size:13px;font-weight:500;color:#49443f;line-height:1.6">${c.footerThanks}</p>
              <p style="margin:0 0 12px;font-size:13px;color:#8a837c;line-height:1.6">${c.footerSupportText}&nbsp;<a href="mailto:support@persai.dev" style="color:#4a6fa5;text-decoration:none">support@persai.dev</a></p>
              <p style="margin:0 0 12px;font-size:13px">
                <a href="${SITE}/app" style="color:#4a6fa5;text-decoration:none">${c.footerCabinet}&nbsp;&rarr;&nbsp;persai.dev/app</a>
              </p>
              ${receiptBlock}
              <p style="margin:0 0 12px;font-size:12px;line-height:1.9">
                ${footerLinks}
              </p>
              <p style="margin:0;font-size:11px;color:#c5bdb5;line-height:1.6">${c.footerUnsubscribe}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Plain-text builder ────────────────────────────────────────────────────────

export function buildPlainText(params: {
  locale: string;
  heading: string;
  bodyLines: string[];
  rows: Array<{ label: string; value: string }>;
  officialReceiptUrl?: string | null;
}): string {
  const { locale, heading, bodyLines, rows, officialReceiptUrl = null } = params;
  const lang = resolvedLocale(locale);
  const c = copy(lang);
  const divider = "─".repeat(44);

  const lines: string[] = ["PersAI", "", heading, "", c.greeting, ""];

  // Strip inline HTML tags from body lines (e.g. <strong>)
  for (const l of bodyLines) {
    lines.push(l.replace(/<[^>]+>/g, ""));
  }
  lines.push("");

  if (rows.length > 0) {
    lines.push(divider);
    for (const r of rows) {
      lines.push(`${r.label}: ${r.value}`);
    }
    lines.push(divider);
    lines.push("");
  }

  lines.push(c.footerThanks);
  lines.push("");
  lines.push(`${c.footerSupportText} support@persai.dev`);
  lines.push(`${c.footerCabinet}: ${SITE}/app`);
  lines.push(c.footerReceiptHelp);
  if (officialReceiptUrl !== null) {
    lines.push(`${c.footerReceiptLabel}: ${officialReceiptUrl}`);
  }
  lines.push("");
  lines.push(
    [
      `${c.linkPricing}: ${SITE}/#pricing`,
      `${c.linkTerms}: ${SITE}/terms`,
      `${c.linkPrivacy}: ${SITE}/privacy`,
      `${c.linkContacts}: ${SITE}/contacts`,
      `${c.linkRequisites}: ${SITE}/requisites`
    ].join("  |  ")
  );
  lines.push("");
  lines.push(c.footerUnsubscribe);

  return lines.join("\n");
}
