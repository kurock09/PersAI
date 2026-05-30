import {
  buildHtml,
  buildPlainText,
  escapeHtmlForEmail,
  resolvedLocale
} from "../billing/billing-template-helpers";

type SupportReplyFacts = {
  locale?: string;
  ticketShortId?: string;
  replyBody?: string;
};

const SUBJECTS: Record<"ru" | "en", (shortId: string) => string> = {
  en: (shortId) => `PersAI support reply · #${shortId}`,
  ru: (shortId) => `Ответ поддержки PersAI · #${shortId}`
};

const HEADINGS: Record<"ru" | "en", string> = {
  en: "Support replied to your request",
  ru: "Поддержка ответила на ваше обращение"
};

const BODY_LINES: Record<"ru" | "en", (shortId: string) => string[]> = {
  en: (shortId) => [
    `We replied to your support request <strong>#${shortId}</strong>.`,
    "You can also read this answer in <strong>PersAI assistant settings</strong> under <strong>Support</strong>."
  ],
  ru: (shortId) => [
    `Мы ответили на ваше обращение <strong>#${shortId}</strong>.`,
    "Полный ответ также доступен в <strong>настройках ассистента</strong> в разделе <strong>«Поддержка»</strong>."
  ]
};

const TICKET_LABEL: Record<"ru" | "en", string> = {
  en: "Ticket",
  ru: "Обращение"
};

const REPLY_LABEL: Record<"ru" | "en", string> = {
  en: "Reply",
  ru: "Ответ"
};

export default function renderSupportReplyTemplate(
  facts: SupportReplyFacts,
  locale: "en" | "ru" = "en"
): { subject: string; html: string; plainText: string } {
  const l = resolvedLocale(typeof facts.locale === "string" ? facts.locale : locale);
  const shortId =
    typeof facts.ticketShortId === "string" && facts.ticketShortId.trim().length > 0
      ? facts.ticketShortId.trim()
      : "SUPPORT";
  const replyBody =
    typeof facts.replyBody === "string" && facts.replyBody.trim().length > 0
      ? facts.replyBody.trim()
      : "";

  const subject = SUBJECTS[l](shortId);
  const heading = HEADINGS[l];
  const bodyLines = BODY_LINES[l](shortId);
  const stackedRows = [
    { label: TICKET_LABEL[l], value: `#${shortId}`, kind: "short" as const },
    ...(replyBody.length > 0
      ? [{ label: REPLY_LABEL[l], value: escapeHtmlForEmail(replyBody), kind: "long" as const }]
      : [])
  ];

  const html = buildHtml({
    locale: l,
    title: subject,
    heading,
    bodyLines,
    stackedRows,
    officialReceiptUrl: null,
    footerVariant: "support"
  });

  const plainText = buildPlainText({
    locale: l,
    heading,
    bodyLines: bodyLines.map((line) => line.replace(/<[^>]+>/g, "")),
    rows: [
      { label: TICKET_LABEL[l], value: `#${shortId}` },
      ...(replyBody.length > 0 ? [{ label: REPLY_LABEL[l], value: replyBody }] : [])
    ],
    officialReceiptUrl: null,
    footerVariant: "support"
  });

  return { subject, html, plainText };
}
