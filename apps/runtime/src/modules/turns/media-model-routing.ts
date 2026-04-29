import type { AssistantRuntimeBundleToolCredentialRef } from "@persai/runtime-bundle";
import type { PersaiRuntimeImageBackground } from "@persai/runtime-contract";

type MediaModelCapabilityRequirement = {
  transparentBackground?: boolean;
};

export type ResolvedMediaModelSelection = {
  credential: AssistantRuntimeBundleToolCredentialRef;
  model: string | null;
  usedFallback: boolean;
  warning: string | null;
};

export type UnresolvedMediaModelSelection = {
  reason: "transparent_background_unsupported_for_model";
  warning: string;
};

export function selectMediaModelForRequest(params: {
  toolCode: "image_generate" | "image_edit" | "video_generate";
  credential: AssistantRuntimeBundleToolCredentialRef;
  background?: PersaiRuntimeImageBackground;
}): ResolvedMediaModelSelection | UnresolvedMediaModelSelection {
  const requires = {
    transparentBackground: params.background === "transparent"
  } satisfies MediaModelCapabilityRequirement;
  const candidates = [params.credential, ...(params.credential.fallbacks ?? [])];
  const seen = new Set<string>();

  for (const [index, candidate] of candidates.entries()) {
    if (candidate.configured !== true) {
      continue;
    }
    const model = normalizeModelKey(candidate.modelKey);
    const dedupeKey = `${candidate.refKey}:${model ?? ""}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    if (supportsMediaRequest(model, requires)) {
      const primaryModel = normalizeModelKey(params.credential.modelKey);
      const usedFallback = index > 0;
      return {
        credential: candidate,
        model,
        usedFallback,
        warning:
          usedFallback && primaryModel !== model
            ? `${params.toolCode} switched from ${primaryModel ?? "provider default"} to ${model ?? "provider default"} for this request.`
            : null
      };
    }
  }

  if (requires.transparentBackground) {
    const primaryModel = normalizeModelKey(params.credential.modelKey) ?? "provider default";
    return {
      reason: "transparent_background_unsupported_for_model",
      warning: `${params.toolCode} requested transparent background, but ${primaryModel} does not support it and no compatible fallback model is configured.`
    };
  }

  return {
    credential: params.credential,
    model: normalizeModelKey(params.credential.modelKey),
    usedFallback: false,
    warning: null
  };
}

function normalizeModelKey(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function supportsMediaRequest(
  model: string | null,
  requires: MediaModelCapabilityRequirement
): boolean {
  if (requires.transparentBackground && model === "gpt-image-2") {
    return false;
  }
  return true;
}
