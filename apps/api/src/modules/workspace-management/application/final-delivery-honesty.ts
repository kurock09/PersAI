function containsCyrillic(text: string): boolean {
  return /[\u0400-\u04FF]/.test(text);
}

function buildUndeliveredAttachmentCorrection(text: string, locale?: string | null): string {
  if (locale?.toLowerCase().startsWith("ru") || containsCyrillic(text)) {
    return "Поправка: файл не был реально доставлен в этот чат в рамках этого ответа.";
  }
  return "Correction: no file was actually delivered in this reply.";
}

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
      .map((filename) => normalizeFilename(filename))
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

export function applyFinalDeliveryHonestyCorrection(input: {
  assistantText: string;
  attemptedArtifactCount: number;
  deliveredAttachmentCount: number;
  deliveredAttachmentFilenames?: string[];
  locale?: string | null;
}): string {
  const deliveredNormalizedText = stripDeliveredAttachmentMarkdownLinks({
    assistantText: input.assistantText.trim(),
    deliveredAttachmentFilenames: input.deliveredAttachmentFilenames ?? []
  });
  const { assistantText: normalizedText, strippedLocalFileLink } =
    stripUndeliveredLocalFileMarkdownLinks({
      assistantText: deliveredNormalizedText
    });
  if (normalizedText.length === 0) {
    return normalizedText;
  }
  if (
    input.deliveredAttachmentCount > 0 ||
    (input.attemptedArtifactCount <= 0 && strippedLocalFileLink === false)
  ) {
    return normalizedText;
  }
  const correction = buildUndeliveredAttachmentCorrection(normalizedText, input.locale);
  return normalizedText.includes(correction)
    ? normalizedText
    : `${normalizedText}\n\n${correction}`;
}
