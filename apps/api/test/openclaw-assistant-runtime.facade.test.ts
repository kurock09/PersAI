import assert from "node:assert/strict";
import { OpenClawAssistantRuntimeFacade } from "../src/modules/workspace-management/application/openclaw-assistant-runtime.facade";
import type {
  OpenClawRuntimeApplyInput,
  OpenClawRuntimeBridge,
  OpenClawRuntimeSetupPreviewTurnInput
} from "../src/modules/workspace-management/application/assistant-runtime-adapter.types";

async function run(): Promise<void> {
  let applied: OpenClawRuntimeApplyInput | null = null;
  let previewed: OpenClawRuntimeSetupPreviewTurnInput | null = null;

  const bridge = {
    applyMaterializedSpec: async (input: OpenClawRuntimeApplyInput) => {
      applied = input;
    },
    previewSetupTurn: async (input: OpenClawRuntimeSetupPreviewTurnInput) => {
      previewed = input;
      return {
        assistantMessage: "preview",
        respondedAt: "2026-04-10T12:00:00.000Z",
        media: []
      };
    }
  } as Pick<OpenClawRuntimeBridge, "applyMaterializedSpec" | "previewSetupTurn"> as OpenClawRuntimeBridge;

  const facade = new OpenClawAssistantRuntimeFacade(bridge);

  await facade.applyMaterializedSpec({
    assistantId: "assistant-1",
    publishedVersionId: "pub-1",
    runtimeTier: "paid_shared_restricted",
    runtimeBundle: { schema: "persai.runtime.bundle.v1" },
    legacyBridge: {
      contentHash: "hash-1",
      bootstrap: { bootstrap: true },
      workspace: { workspace: true }
    },
    reapply: true
  });

  assert.deepEqual(applied, {
    assistantId: "assistant-1",
    publishedVersionId: "pub-1",
    runtimeTier: "paid_shared_restricted",
    contentHash: "hash-1",
    openclawBootstrap: { bootstrap: true },
    openclawWorkspace: { workspace: true },
    reapply: true
  });

  const preview = await facade.previewSetupTurn({
    assistantId: "assistant-1",
    runtimeTier: "free_shared_restricted",
    userMessage: "hello",
    runtimeBundle: { schema: "persai.runtime.bundle.v1" },
    legacyBridge: {
      bootstrap: { preview: true },
      workspace: { temp: true }
    },
    userTimezone: "UTC",
    currentTimeIso: "2026-04-10T12:00:00.000Z"
  });

  assert.deepEqual(preview, {
    assistantMessage: "preview",
    respondedAt: "2026-04-10T12:00:00.000Z",
    media: []
  });
  assert.deepEqual(previewed, {
    assistantId: "assistant-1",
    runtimeTier: "free_shared_restricted",
    userMessage: "hello",
    openclawBootstrap: { preview: true },
    openclawWorkspace: { temp: true },
    userTimezone: "UTC",
    currentTimeIso: "2026-04-10T12:00:00.000Z"
  });
}

void run();
