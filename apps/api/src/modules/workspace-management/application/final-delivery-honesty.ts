function buildDeliveredAttachmentFallback(
  locale: string | null | undefined,
  kind: UndeliveredArtifactKind
): string {
  const ru = locale?.toLowerCase().startsWith("ru") ?? false;
  if (kind === "media") {
    return ru ? "Медиафайл отправлен." : "Media sent.";
  }
  return ru ? "Файл отправлен." : "File sent.";
}

export type UndeliveredArtifactKind = "file" | "media";

/**
 * Structurally classify the attempted artifacts as documents ("file") or
 * image/video/audio ("media") from their `type` field — used only to pick the
 * undelivered-notice wording. Never inspects the model's prose. Defaults to
 * "file" when no non-document type is present (or the list is empty).
 */
export function resolveUndeliveredArtifactKind(
  artifacts: ReadonlyArray<{ type?: string | null }>
): UndeliveredArtifactKind {
  return artifacts.some(
    (artifact) => typeof artifact.type === "string" && artifact.type !== "document"
  )
    ? "media"
    : "file";
}

/**
 * System-authored structural truth for a fully-undelivered attempt: the runtime
 * produced/attempted at least one artifact but zero reached the user. Driven only
 * by the counts (attempted > 0 && delivered === 0) and the structural artifact
 * kind, never by parsing the model's prose — so it stays honest without
 * re-introducing claim-detection heuristics.
 */
function buildUndeliveredAttachmentNotice(
  locale: string | null | undefined,
  kind: UndeliveredArtifactKind
): string {
  const ru = locale?.toLowerCase().startsWith("ru") ?? false;
  if (kind === "media") {
    return ru
      ? "Поправка: изображение или другой медиафайл не был реально доставлен в этот чат."
      : "Correction: no image or other media was actually delivered in this reply.";
  }
  return ru
    ? "Поправка: файл не был реально доставлен в этот чат."
    : "Correction: no file was actually delivered in this reply.";
}

/**
 * ADR-105 FIX B — system-authored structural truth for partial under-delivery.
 * Returns a locale-aware shortfall line when the provider produced fewer
 * artifacts than requested (1 ≤ produced < requested). Returns null otherwise
 * (full delivery, or zero produced — full-failure paths handle the latter).
 */
export function buildExternalMediaDownloadLines(input: {
  items: ReadonlyArray<{ url: string; filename: string | null }>;
  locale?: string | null;
}): string[] {
  const ru = input.locale?.toLowerCase().startsWith("ru") ?? false;
  return input.items.map((item) => {
    const label =
      typeof item.filename === "string" && item.filename.trim().length > 0
        ? item.filename.trim()
        : ru
          ? "видео"
          : "video";
    return ru
      ? `Файл слишком большой для отправки прямо в чат. Скачать: [${label}](${item.url})`
      : `The file is too large to send directly in chat. Download: [${label}](${item.url})`;
  });
}

export function buildPartialDeliveryShortfallLine(
  produced: number,
  requested: number,
  locale?: string | null
): string | null {
  if (produced <= 0 || produced >= requested) {
    return null;
  }
  return locale?.toLowerCase().startsWith("ru")
    ? `Запросили ${String(requested)}, готово ${String(produced)} — остальные не удалось создать.`
    : `Requested ${String(requested)}, delivered ${String(produced)} — the rest could not be generated.`;
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
} {
  const markdownLinkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
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
      const plainText = linkText.trim().length > 0 ? linkText.trim() : normalizeFilename(href);
      return plainText.length > 0 ? plainText : match;
    }
  );
  return { assistantText };
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
} {
  const assistantText = input.assistantText
    .split("\n")
    .filter((line) => {
      const normalized = line.trim();
      if (
        /^Assistant sent (?:an? )?attachments?:\s+.+$/i.test(normalized) ||
        /^\[?Working files from user attachments:.*$/i.test(normalized)
      ) {
        return false;
      }
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { assistantText };
}

export function applyFinalDeliveryHonestyCorrection(input: {
  assistantText: string;
  attemptedArtifactCount: number;
  deliveredAttachmentCount: number;
  deliveredAttachmentFilenames?: string[];
  attemptedArtifactKind?: UndeliveredArtifactKind;
  locale?: string | null;
}): string {
  const { assistantText: withoutTechnicalSummary } = stripTechnicalAttachmentSummary({
    assistantText: input.assistantText.trim()
  });
  const deliveredNormalizedText = stripDeliveredAttachmentMarkdownLinks({
    assistantText: withoutTechnicalSummary,
    deliveredAttachmentFilenames: input.deliveredAttachmentFilenames ?? []
  });
  const { assistantText: normalizedText } = stripUndeliveredLocalFileMarkdownLinks({
    assistantText: deliveredNormalizedText
  });
  if (input.attemptedArtifactCount > 0 && input.deliveredAttachmentCount === 0) {
    const notice = buildUndeliveredAttachmentNotice(
      input.locale,
      input.attemptedArtifactKind ?? "file"
    );
    return normalizedText.length === 0 ? notice : `${normalizedText}\n\n${notice}`;
  }
  if (normalizedText.length === 0) {
    return input.deliveredAttachmentCount > 0
      ? buildDeliveredAttachmentFallback(input.locale, input.attemptedArtifactKind ?? "file")
      : normalizedText;
  }
  return normalizedText;
}
