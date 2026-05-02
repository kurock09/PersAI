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
  const normalizedText = stripDeliveredAttachmentMarkdownLinks({
    assistantText: input.assistantText.trim(),
    deliveredAttachmentFilenames: input.deliveredAttachmentFilenames ?? []
  });
  if (normalizedText.length === 0) {
    return normalizedText;
  }
  if (input.attemptedArtifactCount <= 0 || input.deliveredAttachmentCount > 0) {
    return normalizedText;
  }
  const correction = buildUndeliveredAttachmentCorrection(normalizedText, input.locale);
  return normalizedText.includes(correction)
    ? normalizedText
    : `${normalizedText}\n\n${correction}`;
}
