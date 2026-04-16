export interface ToolPromptMetadataState {
  providerAgnostic: boolean;
  requiredCredentialId: string | null;
  modelDescription: string | null;
  modelUsageGuidance: string | null;
  raw: Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function readToolPromptMetadataState(providerHints: unknown): ToolPromptMetadataState {
  const raw = asObject(providerHints) ?? {};
  return {
    providerAgnostic: raw.providerAgnostic === true,
    requiredCredentialId: readOptionalString(raw.requiredCredentialId),
    modelDescription: readOptionalString(raw.modelDescription),
    modelUsageGuidance: readOptionalString(raw.modelUsageGuidance),
    raw
  };
}

export function buildToolPromptMetadataState(params: {
  existingProviderHints: unknown;
  requiredCredentialId?: string | undefined;
  defaultModelDescription?: string | undefined;
  defaultModelUsageGuidance?: string | undefined;
}): Record<string, unknown> {
  const existing = readToolPromptMetadataState(params.existingProviderHints);

  return {
    ...existing.raw,
    schema: "persai.toolCatalogProviderHints.v3",
    providerAgnostic: params.requiredCredentialId === undefined,
    ...(params.requiredCredentialId === undefined
      ? {}
      : { requiredCredentialId: params.requiredCredentialId }),
    modelDescription: existing.modelDescription ?? params.defaultModelDescription?.trim() ?? null,
    modelUsageGuidance:
      existing.modelUsageGuidance ?? params.defaultModelUsageGuidance?.trim() ?? null
  };
}

export function patchToolPromptMetadataState(params: {
  existingProviderHints: unknown;
  modelDescription?: string | null | undefined;
  modelUsageGuidance?: string | null | undefined;
}): Record<string, unknown> {
  const existing = readToolPromptMetadataState(params.existingProviderHints);

  return {
    ...existing.raw,
    schema: "persai.toolCatalogProviderHints.v3",
    providerAgnostic: existing.providerAgnostic,
    ...(existing.requiredCredentialId === null
      ? {}
      : { requiredCredentialId: existing.requiredCredentialId }),
    modelDescription:
      params.modelDescription === undefined
        ? existing.modelDescription
        : params.modelDescription?.trim() || null,
    modelUsageGuidance:
      params.modelUsageGuidance === undefined
        ? existing.modelUsageGuidance
        : params.modelUsageGuidance?.trim() || null
  };
}
