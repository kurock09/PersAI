import assert from "node:assert/strict";
import type { AssistantRuntimeBundleToolCredentialRef } from "@persai/runtime-bundle";
import { selectMediaModelForRequest } from "../src/modules/turns/media-model-routing";

function createCredential(input?: {
  modelKey?: string;
  fallbacks?: AssistantRuntimeBundleToolCredentialRef[];
}): AssistantRuntimeBundleToolCredentialRef {
  return {
    refKey: "persai:persai-runtime:tool/image_generate/api-key",
    secretRef: {
      source: "persai",
      provider: "persai-runtime",
      id: "tool/image_generate/api-key"
    },
    configured: true,
    providerId: "openai",
    ...(input?.modelKey ? { modelKey: input.modelKey } : {}),
    ...(input?.fallbacks ? { fallbacks: input.fallbacks } : {})
  };
}

export async function runMediaModelRoutingTest(): Promise<void> {
  const fallback = createCredential({ modelKey: "gpt-image-1.5" });
  const selected = selectMediaModelForRequest({
    toolCode: "image_generate",
    credential: createCredential({
      modelKey: "gpt-image-2",
      fallbacks: [fallback]
    }),
    background: "transparent"
  });
  assert.equal("reason" in selected, false);
  if ("reason" in selected) {
    throw new Error("Expected fallback selection.");
  }
  assert.equal(selected.model, "gpt-image-1.5");
  assert.equal(selected.usedFallback, true);
  assert.match(selected.warning ?? "", /switched from gpt-image-2 to gpt-image-1.5/i);

  const skipped = selectMediaModelForRequest({
    toolCode: "image_edit",
    credential: createCredential({ modelKey: "gpt-image-2" }),
    background: "transparent"
  });
  assert.equal("reason" in skipped, true);
  if (!("reason" in skipped)) {
    throw new Error("Expected unsupported transparent-background routing result.");
  }
  assert.equal(skipped.reason, "transparent_background_unsupported_for_model");
  assert.match(skipped.warning, /no compatible fallback model is configured/i);

  const untouchedVideo = selectMediaModelForRequest({
    toolCode: "video_generate",
    credential: createCredential({ modelKey: "sora-2-pro" })
  });
  assert.equal("reason" in untouchedVideo, false);
  if ("reason" in untouchedVideo) {
    throw new Error("Expected direct video model selection.");
  }
  assert.equal(untouchedVideo.model, "sora-2-pro");
  assert.equal(untouchedVideo.usedFallback, false);
}
