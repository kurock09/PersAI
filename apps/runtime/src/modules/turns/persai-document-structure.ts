import { randomUUID } from "node:crypto";

export const PERSAI_DOCUMENT_STRUCTURE_VERSION = 1;
export const PERSAI_DOCUMENT_STYLE_VERSION = 1;
export const LARGE_DOCUMENT_STRUCTURE_THRESHOLD_BYTES = 20_000;

export type PersaiDocumentEditStrategy = "fast_small" | "structured_large";
export type PersaiDocumentInternalOperation = "style_only" | "content_patch" | "section_rewrite";

export type PersaiDocumentStructureBlock = {
  id: string;
  type: "heading" | "paragraph";
  html: string;
};

export type PersaiDocumentStructureSection = {
  id: string;
  heading: string | null;
  blocks: PersaiDocumentStructureBlock[];
};

export type PersaiDocumentStructureSnapshot = {
  version: typeof PERSAI_DOCUMENT_STRUCTURE_VERSION;
  renderModel: "persai_document_structure_v1";
  sections: PersaiDocumentStructureSection[];
};

export type PersaiDocumentStyleProfile = {
  version: typeof PERSAI_DOCUMENT_STYLE_VERSION;
  renderModel: "persai_document_style_v1";
  typography: {
    bodyFontFamily: string;
    bodyFontSizePt: number;
    headingFontFamily: string;
    lineHeight: number;
  };
  layout: {
    pageMarginMm: number;
    paragraphSpacingEm: number;
    sectionSpacingEm: number;
  };
  colors: {
    heading: string;
    body: string;
    accent: string;
  };
};

export function createDefaultStyleProfile(): PersaiDocumentStyleProfile {
  return {
    version: PERSAI_DOCUMENT_STYLE_VERSION,
    renderModel: "persai_document_style_v1",
    typography: {
      bodyFontFamily: "Georgia, 'Times New Roman', serif",
      bodyFontSizePt: 11,
      headingFontFamily: "Georgia, 'Times New Roman', serif",
      lineHeight: 1.45
    },
    layout: {
      pageMarginMm: 20,
      paragraphSpacingEm: 0.55,
      sectionSpacingEm: 1.1
    },
    colors: {
      heading: "#111111",
      body: "#222222",
      accent: "#444444"
    }
  };
}

/** Richer presentation defaults for transferMode=transform (full source text, styled layout). */
export function createTransformStyleProfile(): PersaiDocumentStyleProfile {
  return {
    version: PERSAI_DOCUMENT_STYLE_VERSION,
    renderModel: "persai_document_style_v1",
    typography: {
      bodyFontFamily: "'Segoe UI', Calibri, Arial, sans-serif",
      bodyFontSizePt: 11,
      headingFontFamily: "'Segoe UI', Calibri, Arial, sans-serif",
      lineHeight: 1.5
    },
    layout: {
      pageMarginMm: 18,
      paragraphSpacingEm: 0.65,
      sectionSpacingEm: 1.25
    },
    colors: {
      heading: "#1a365d",
      body: "#1f2937",
      accent: "#2563eb"
    }
  };
}

export function resolveEditStrategyForCreate(input: {
  totalInlinedSourceBytes: number;
  persistedEditStrategy?: PersaiDocumentEditStrategy | null;
}): PersaiDocumentEditStrategy {
  if (input.persistedEditStrategy === "structured_large") {
    return "structured_large";
  }
  return input.totalInlinedSourceBytes > LARGE_DOCUMENT_STRUCTURE_THRESHOLD_BYTES
    ? "structured_large"
    : "fast_small";
}

export function shouldUseStructuredDocumentPath(input: {
  editStrategy: PersaiDocumentEditStrategy | null | undefined;
  structureJson: unknown;
}): boolean {
  if (input.editStrategy === "structured_large") {
    return true;
  }
  return isPersaiDocumentStructureSnapshot(input.structureJson);
}

export function isPersaiDocumentStructureSnapshot(
  value: unknown
): value is PersaiDocumentStructureSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    row.version === PERSAI_DOCUMENT_STRUCTURE_VERSION &&
    row.renderModel === "persai_document_structure_v1" &&
    Array.isArray(row.sections) &&
    row.sections.length > 0
  );
}

export function isPersaiDocumentStyleProfile(value: unknown): value is PersaiDocumentStyleProfile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    row.version === PERSAI_DOCUMENT_STYLE_VERSION && row.renderModel === "persai_document_style_v1"
  );
}

export function parsePersaiDocumentStructureSnapshot(
  value: unknown
): PersaiDocumentStructureSnapshot | null {
  return isPersaiDocumentStructureSnapshot(value) ? value : null;
}

export function parsePersaiDocumentStyleProfile(value: unknown): PersaiDocumentStyleProfile | null {
  if (isPersaiDocumentStyleProfile(value)) {
    return value;
  }
  return null;
}

export function buildStructureFromExtractedText(text: string): PersaiDocumentStructureSnapshot {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  const sections: PersaiDocumentStructureSection[] = [];
  let currentSection: PersaiDocumentStructureSection | null = null;

  const pushSection = (): void => {
    if (currentSection !== null && currentSection.blocks.length > 0) {
      sections.push(currentSection);
    }
    currentSection = null;
  };

  for (const block of blocks.length > 0 ? blocks : [normalized]) {
    if (looksLikeStandaloneHeading(block)) {
      pushSection();
      currentSection = {
        id: `sec_${randomUUID()}`,
        heading: block,
        blocks: [
          {
            id: `blk_${randomUUID()}`,
            type: "heading",
            html: escapeHtml(block)
          }
        ]
      };
      continue;
    }
    if (currentSection === null) {
      currentSection = {
        id: `sec_${randomUUID()}`,
        heading: null,
        blocks: []
      };
    }
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    const html = lines.map((line) => escapeHtml(line)).join("<br>");
    currentSection.blocks.push({
      id: `blk_${randomUUID()}`,
      type: "paragraph",
      html
    });
  }
  pushSection();

  if (sections.length === 0) {
    sections.push({
      id: `sec_${randomUUID()}`,
      heading: null,
      blocks: [
        {
          id: `blk_${randomUUID()}`,
          type: "paragraph",
          html: escapeHtml(normalized)
        }
      ]
    });
  }

  return {
    version: PERSAI_DOCUMENT_STRUCTURE_VERSION,
    renderModel: "persai_document_structure_v1",
    sections
  };
}

export function buildStructureFromRenderedHtml(html: string): PersaiDocumentStructureSnapshot {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const bodyInner = bodyMatch?.[1] ?? html;
  const sectionMatches = bodyInner.match(/<section\b[^>]*>[\s\S]*?<\/section>/gi);
  if (sectionMatches !== null && sectionMatches.length > 0) {
    const sections = sectionMatches.map((sectionHtml) =>
      htmlSectionToStructureSection(sectionHtml)
    );
    return {
      version: PERSAI_DOCUMENT_STRUCTURE_VERSION,
      renderModel: "persai_document_structure_v1",
      sections: sections.filter((section) => section.blocks.length > 0)
    };
  }

  const plainText = stripHtmlToPlainText(bodyInner);
  if (plainText.trim().length > 0) {
    return buildStructureFromExtractedText(plainText);
  }

  return {
    version: PERSAI_DOCUMENT_STRUCTURE_VERSION,
    renderModel: "persai_document_structure_v1",
    sections: [
      {
        id: `sec_${randomUUID()}`,
        heading: null,
        blocks: [
          {
            id: `blk_${randomUUID()}`,
            type: "paragraph",
            html: bodyInner.trim()
          }
        ]
      }
    ]
  };
}

function htmlSectionToStructureSection(sectionHtml: string): PersaiDocumentStructureSection {
  const idMatch = /\bid=["']([^"']+)["']/i.exec(sectionHtml);
  const sectionId =
    idMatch?.[1] !== undefined && idMatch[1].length > 0 ? idMatch[1] : `sec_${randomUUID()}`;
  const headingMatch = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(sectionHtml);
  const heading =
    headingMatch !== null && headingMatch[1] !== undefined
      ? stripHtmlToPlainText(headingMatch[1]).trim() || null
      : null;
  const blockMatches = sectionHtml.match(/<(p|h[1-6]|li|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
  const blocks: PersaiDocumentStructureBlock[] = blockMatches.map((blockHtml) => {
    const tag = /^<(\w+)/i.exec(blockHtml)?.[1]?.toLowerCase() ?? "p";
    return {
      id: `blk_${randomUUID()}`,
      type: tag.startsWith("h") ? "heading" : "paragraph",
      html: blockHtml.replace(/^<[^>]+>|<\/[^>]+>$/gi, "").trim()
    };
  });
  if (blocks.length === 0) {
    const inner = sectionHtml.replace(/<\/?section[^>]*>/gi, "").trim();
    if (inner.length > 0) {
      blocks.push({
        id: `blk_${randomUUID()}`,
        type: "paragraph",
        html: inner
      });
    }
  }
  return { id: sectionId, heading, blocks };
}

export function mergeStyleProfile(
  base: PersaiDocumentStyleProfile,
  patch: Record<string, unknown>
): PersaiDocumentStyleProfile {
  const merged = structuredClone(base) as PersaiDocumentStyleProfile & Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof merged[key] === "object" &&
      merged[key] !== null &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = {
        ...(merged[key] as Record<string, unknown>),
        ...(value as Record<string, unknown>)
      };
      continue;
    }
    merged[key] = value;
  }
  return merged as PersaiDocumentStyleProfile;
}

export function renderStructureToHtml(
  structure: PersaiDocumentStructureSnapshot,
  style: PersaiDocumentStyleProfile
): string {
  const styleBlock = [
    `body { font-family: ${style.typography.bodyFontFamily}; font-size: ${String(style.typography.bodyFontSizePt)}pt; line-height: ${String(style.typography.lineHeight)}; color: ${style.colors.body}; margin: ${String(style.layout.pageMarginMm)}mm; }`,
    `h1, h2, h3 { font-family: ${style.typography.headingFontFamily}; color: ${style.colors.heading}; }`,
    `section { margin-bottom: ${String(style.layout.sectionSpacingEm)}em; }`,
    `p { margin: 0 0 ${String(style.layout.paragraphSpacingEm)}em 0; }`
  ].join("\n");
  const sectionsHtml = structure.sections
    .map((section) => {
      const headingHtml =
        section.heading !== null && section.heading.length > 0
          ? `<h2>${escapeHtml(section.heading)}</h2>`
          : "";
      const normalizedSectionHeading = normalizeHeadingText(section.heading);
      const blocksHtml = section.blocks
        .filter((block, index) => {
          if (index !== 0 || block.type !== "heading" || normalizedSectionHeading === null) {
            return true;
          }
          return (
            normalizeHeadingText(stripHtmlToPlainText(block.html)) !== normalizedSectionHeading
          );
        })
        .map((block) => {
          if (block.type === "heading") {
            return `<h3 data-block-id="${escapeAttribute(block.id)}">${block.html}</h3>`;
          }
          return `<p data-block-id="${escapeAttribute(block.id)}">${block.html}</p>`;
        })
        .join("\n");
      return `<section id="${escapeAttribute(section.id)}">${headingHtml}${blocksHtml}</section>`;
    })
    .join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${styleBlock}</style></head><body><article>${sectionsHtml}</article></body></html>`;
}

export function extractStructurePlainText(structure: PersaiDocumentStructureSnapshot): string {
  return structure.sections
    .flatMap((section) =>
      section.blocks.map((block) => stripHtmlToPlainText(block.html).replace(/\s+/g, " ").trim())
    )
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export function applySectionPatches(
  structure: PersaiDocumentStructureSnapshot,
  patches: Array<{
    sectionId: string;
    blocks?: PersaiDocumentStructureBlock[];
    heading?: string | null;
  }>
): PersaiDocumentStructureSnapshot {
  const next = structuredClone(structure);
  for (const patch of patches) {
    const section = next.sections.find((entry) => entry.id === patch.sectionId);
    if (section === undefined) {
      continue;
    }
    if (patch.heading !== undefined) {
      section.heading = patch.heading;
    }
    if (patch.blocks !== undefined) {
      section.blocks = patch.blocks;
    }
  }
  return next;
}

function looksLikeStandaloneHeading(block: string): boolean {
  if (block.includes("\n") || block.length > 120) {
    return false;
  }
  if (/^\d+([.)]|\.)\s/.test(block)) {
    return false;
  }
  if (/[.!?;:]$/.test(block)) {
    return false;
  }
  return block === block.toUpperCase();
}

function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeHeadingText(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
  return normalized.length === 0 ? null : normalized;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
