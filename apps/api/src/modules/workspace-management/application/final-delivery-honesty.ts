function containsCyrillic(text: string): boolean {
  return /[\u0400-\u04FF]/.test(text);
}

function buildUndeliveredAttachmentCorrection(text: string, locale?: string | null): string {
  if (locale?.toLowerCase().startsWith("ru") || containsCyrillic(text)) {
    return "Поправка: файл не был реально доставлен в этот чат в рамках этого ответа.";
  }
  return "Correction: no file was actually delivered in this reply.";
}

function buildUndeliveredMediaCorrection(text: string, locale?: string | null): string {
  if (locale?.toLowerCase().startsWith("ru") || containsCyrillic(text)) {
    return "Поправка: изображение или другое медиа не было реально доставлено в этот чат в рамках этого ответа.";
  }
  return "Correction: no image or other media was actually delivered in this reply.";
}

function buildDeliveredAttachmentFallback(locale?: string | null): string {
  return locale?.toLowerCase().startsWith("ru") ? "Файл отправлен." : "File sent.";
}

type UndeliveredClaimKind = "file" | "media";

const POSITIVE_MEDIA_DELIVERY_CLAIM_PATTERNS = [
  /\b(?:your|the)\s+(?:image|photo|picture|video|clip|render|edit)\s+(?:is|was)\s+ready\b/i,
  /\bhere(?:'s| is)\s+(?:your|the)\s+(?:image|photo|picture|video|clip|render|edit)\b/i,
  /\b(?:i|we)\s+(?:generated|created|edited|made|rendered|prepared|attached|sent|uploaded)\s+(?:your|the|an?\s+)?(?:image|photo|picture|video|clip|render|edit)\b/i,
  /(?:^|[\s,.:;!?-])вот\s+(?:готов[ао]е?\s+)?(?:фото|изображение|картинк[ауыеи]?|видео)(?:$|[\s,.:;!?-])/i,
  /(?:^|[\s,.:;!?-])(?:фото|изображение|картинк[ауыеи]?|видео)\s+готов[ао](?:$|[\s,.:;!?-])/i,
  /(?<!не\s)(?:^|[\s,.:;!?-])(?:сделал|сделала|сгенерировал|сгенерировала|создал|создала|отредактировал|отредактировала|прикрепил|прикрепила|отправил|отправила)\s+(?:вам\s+|тебе\s+)?(?:фото|изображение|картинку|видео)(?:$|[\s,.:;!?-])/i
];

const POSITIVE_FILE_DELIVERY_CLAIM_PATTERNS = [
  /\b(?:file|document|attachment)\s+(?:is|was)\s+ready\b/i,
  /\bhere(?:'s| is)\s+(?:your|the)\s+(?:file|document|attachment)\b/i,
  /\b(?:i|we)\s+(?:attached|sent|uploaded|delivered)\s+(?:your|the|an?\s+)?(?:file|document|attachment)\b/i,
  /(?:^|[\s,.:;!?-])вот\s+(?:готов[ао]й?\s+)?(?:файл|документ)(?:$|[\s,.:;!?-])/i,
  /(?:^|[\s,.:;!?-])(?:файл|документ)\s+готов(?:$|[\s,.:;!?-])/i,
  /(?<!не\s)(?:^|[\s,.:;!?-])(?:прикрепил|прикрепила|отправил|отправила)\s+(?:вам\s+|тебе\s+)?(?:файл|документ|вложение)(?:$|[\s,.:;!?-])/i
];

function normalizeFilename(value: string): string {
  const trimmed = value.trim();
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
  const basename = withoutQuery.split(/[\\/]/).pop() ?? withoutQuery;
  try {
    return decodeURIComponent(basename).toLowerCase();
  } catch {
    return basename.toLowerCase();
  }
}

function normalizeFilenameStem(value: string): string | null {
  const normalized = normalizeFilename(value);
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot <= 0) {
    return null;
  }
  return normalized.slice(0, lastDot);
}

function isDeliveredFileLink(
  linkText: string,
  href: string,
  deliveredFilenames: Set<string>
): boolean {
  return (
    deliveredFilenames.has(normalizeFilename(linkText)) ||
    deliveredFilenames.has(normalizeFilename(href))
  );
}

function isStandaloneDeliveredFileLine(lineWithoutLinks: string): boolean {
  const normalized = lineWithoutLinks
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length === 0) {
    return true;
  }
  return normalized.length <= 32;
}

function isSafeDeliveredLinkHref(href: string): boolean {
  const normalized = href.trim().toLowerCase();
  return (
    normalized.startsWith("https://") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("tel:") ||
    normalized.startsWith("/api/assistant-file/")
  );
}

function looksLikeFileReference(value: string): boolean {
  const normalized = normalizeFilename(value);
  return /\.[a-z0-9]{1,12}$/i.test(normalized);
}

function stripUndeliveredLocalFileMarkdownLinks(input: { assistantText: string }): {
  assistantText: string;
  strippedLocalFileLink: boolean;
} {
  const markdownLinkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let strippedLocalFileLink = false;
  const assistantText = input.assistantText.replace(
    markdownLinkPattern,
    (match, linkText, href) => {
      if (typeof linkText !== "string" || typeof href !== "string") {
        return match;
      }
      if (isSafeDeliveredLinkHref(href)) {
        return match;
      }
      if (!looksLikeFileReference(linkText) && !looksLikeFileReference(href)) {
        return match;
      }
      strippedLocalFileLink = true;
      const plainText = linkText.trim().length > 0 ? linkText.trim() : normalizeFilename(href);
      return plainText.length > 0 ? plainText : match;
    }
  );
  return { assistantText, strippedLocalFileLink };
}

function stripDeliveredAttachmentMarkdownLinks(input: {
  assistantText: string;
  deliveredAttachmentFilenames: string[];
}): string {
  const deliveredFilenames = new Set(
    input.deliveredAttachmentFilenames
      .flatMap((filename) => {
        const normalized = normalizeFilename(filename);
        const stem = normalizeFilenameStem(filename);
        return stem === null ? [normalized] : [normalized, stem];
      })
      .filter((filename) => filename.length > 0)
  );
  if (deliveredFilenames.size === 0) {
    return input.assistantText;
  }

  const markdownLinkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  return input.assistantText
    .split("\n")
    .map((line) => {
      let matchedDeliveredFile = false;
      const withoutDeliveredFileLinks = line.replace(
        markdownLinkPattern,
        (match, linkText, href) => {
          if (
            typeof linkText === "string" &&
            typeof href === "string" &&
            isDeliveredFileLink(linkText, href, deliveredFilenames)
          ) {
            matchedDeliveredFile = true;
            return "";
          }
          return match;
        }
      );
      if (matchedDeliveredFile && isStandaloneDeliveredFileLine(withoutDeliveredFileLinks)) {
        return "";
      }
      return matchedDeliveredFile
        ? line.replace(markdownLinkPattern, (match, linkText, href) =>
            typeof linkText === "string" &&
            typeof href === "string" &&
            isDeliveredFileLink(linkText, href, deliveredFilenames)
              ? linkText
              : match
          )
        : line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTechnicalAttachmentSummary(input: { assistantText: string }): {
  assistantText: string;
  strippedTechnicalAttachmentSummary: boolean;
} {
  let strippedTechnicalAttachmentSummary = false;
  const assistantText = input.assistantText
    .split("\n")
    .filter((line) => {
      const normalized = line.trim();
      if (
        /^Assistant sent (?:an? )?attachments?:\s+.+$/i.test(normalized) ||
        /^\[?Working files from user attachments:.*$/i.test(normalized)
      ) {
        strippedTechnicalAttachmentSummary = true;
        return false;
      }
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { assistantText, strippedTechnicalAttachmentSummary };
}

function detectUndeliveredClaimKind(input: {
  assistantText: string;
  strippedTechnicalAttachmentSummary: boolean;
  strippedLocalFileLink: boolean;
  attemptedArtifactCount: number;
}): UndeliveredClaimKind | null {
  const normalized = input.assistantText.replace(/\s+/g, " ").trim();
  if (normalized.length > 0) {
    if (POSITIVE_MEDIA_DELIVERY_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return "media";
    }
    if (POSITIVE_FILE_DELIVERY_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return "file";
    }
  }
  if (input.strippedLocalFileLink || input.strippedTechnicalAttachmentSummary) {
    return "file";
  }
  return input.attemptedArtifactCount > 0 ? "file" : null;
}

function buildUndeliveredCorrection(
  kind: UndeliveredClaimKind,
  text: string,
  locale?: string | null
): string {
  return kind === "media"
    ? buildUndeliveredMediaCorrection(text, locale)
    : buildUndeliveredAttachmentCorrection(text, locale);
}

export function applyFinalDeliveryHonestyCorrection(input: {
  assistantText: string;
  attemptedArtifactCount: number;
  deliveredAttachmentCount: number;
  deliveredAttachmentFilenames?: string[];
  locale?: string | null;
}): string {
  const { assistantText: withoutTechnicalSummary, strippedTechnicalAttachmentSummary } =
    stripTechnicalAttachmentSummary({
      assistantText: input.assistantText.trim()
    });
  const deliveredNormalizedText = stripDeliveredAttachmentMarkdownLinks({
    assistantText: withoutTechnicalSummary,
    deliveredAttachmentFilenames: input.deliveredAttachmentFilenames ?? []
  });
  const { assistantText: normalizedText, strippedLocalFileLink } =
    stripUndeliveredLocalFileMarkdownLinks({
      assistantText: deliveredNormalizedText
    });
  const undeliveredClaimKind = detectUndeliveredClaimKind({
    assistantText: normalizedText.length > 0 ? normalizedText : input.assistantText,
    strippedTechnicalAttachmentSummary,
    strippedLocalFileLink,
    attemptedArtifactCount: input.attemptedArtifactCount
  });
  if (normalizedText.length === 0) {
    return input.deliveredAttachmentCount > 0
      ? buildDeliveredAttachmentFallback(input.locale)
      : undeliveredClaimKind === null
        ? normalizedText
        : buildUndeliveredCorrection(undeliveredClaimKind, input.assistantText, input.locale);
  }
  if (input.deliveredAttachmentCount > 0 || undeliveredClaimKind === null) {
    return normalizedText;
  }
  const correction = buildUndeliveredCorrection(undeliveredClaimKind, normalizedText, input.locale);
  return normalizedText.includes(correction)
    ? normalizedText
    : `${normalizedText}\n\n${correction}`;
}
