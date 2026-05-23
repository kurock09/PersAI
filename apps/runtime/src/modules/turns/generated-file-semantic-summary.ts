const GENERATED_FILE_SEMANTIC_SUMMARY_MAX_CHARS = 140;

type GeneratedFileSemanticSummaryParams = {
  preferredText?: string | null;
  requestText?: string | null;
  requestedName?: string | null;
  allowWeakRequestFallback?: boolean;
};

function normalizeSummary(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, GENERATED_FILE_SEMANTIC_SUMMARY_MAX_CHARS);
  return normalized.length > 0 ? normalized : null;
}

function stripExtension(value: string): string {
  return value.replace(/\.[A-Za-z0-9]+$/u, "").trim();
}

function isWeakRequestedName(value: string): boolean {
  const normalized = stripExtension(value).toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  if (
    /^(file|document|image|photo|audio|video|recording|voice[-_ ]?note|upload|attachment|clip|untitled)$/u.test(
      normalized
    )
  ) {
    return true;
  }
  if (/^[0-9a-f-]{8,}$/u.test(normalized)) {
    return true;
  }
  if (/^(img|dsc|file|doc|scan|image|photo|video|audio)[_-]?\d+$/u.test(normalized)) {
    return true;
  }
  return false;
}

function isWeakRequestText(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized.length < 16) {
    return true;
  }
  if (
    /^(make|create|generate|edit|improve|enhance|fix|change|update|convert|translate|summarize|rewrite|revise)\b/u.test(
      normalized
    ) &&
    normalized.length < 40
  ) {
    return true;
  }
  if (
    /^(make|edit|improve|enhance|fix|change|update)\s+(it|this|that|image|photo|video|document|file)\b/u.test(
      normalized
    )
  ) {
    return true;
  }
  return false;
}

export function buildGeneratedFileSemanticSummary(
  input: GeneratedFileSemanticSummaryParams
): string | null {
  const preferred = normalizeSummary(input.preferredText);
  if (preferred !== null) {
    return preferred;
  }

  const requestedName = normalizeSummary(input.requestedName);
  const normalizedRequestedName =
    requestedName === null ? null : normalizeSummary(stripExtension(requestedName));
  if (normalizedRequestedName !== null && !isWeakRequestedName(normalizedRequestedName)) {
    return normalizedRequestedName;
  }

  const requestText = normalizeSummary(input.requestText);
  if (requestText === null) {
    return null;
  }
  if (!isWeakRequestText(requestText) || input.allowWeakRequestFallback === true) {
    return requestText;
  }
  return null;
}
