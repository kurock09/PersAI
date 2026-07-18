import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ADR-157 D2 — chat-model perception for completed image jobs must hydrate into
 * pendingFilePreviewBlocks (await mid-turn + notify continuation). This is a
 * source-wire regression guard so the path cannot silently disappear.
 */

function loadTurnExecutionSource(): string {
  return readFileSync(resolve(__dirname, "../src/modules/turns/turn-execution.service.ts"), "utf8");
}

function loadInternalApiSource(): string {
  return readFileSync(
    resolve(__dirname, "../src/modules/turns/persai-internal-api.client.service.ts"),
    "utf8"
  );
}

export async function runAdr157ImagePerceptionWireTest(): Promise<void> {
  const source = loadTurnExecutionSource();
  assert.match(
    source,
    /hydrateImagePerceptionBlocks\(/,
    "TurnExecutionService must own image perception hydration"
  );
  assert.match(
    source,
    /outcome\.pendingFilePreviewBlocks\s*=\s*perceptionBlocks/,
    "await mid-turn completed media must assign perception into the tool outcome"
  );
  assert.match(
    source,
    /turnState\.pendingFilePreviewBlocks\s*=\s*this\.mergePendingFilePreviewBlocks\([\s\S]*?perceptionBlocks/,
    "notify continuation must merge perception into turnState.pendingFilePreviewBlocks"
  );
  assert.match(
    source,
    /resolveAsyncJobPerceptionArtifacts\(/,
    "hydration must call the internal perception-artifacts API"
  );
  assert.match(
    source,
    /isMediaCompletionVisionEnabled\(/,
    "perception must remain plan-gated via mediaCompletionVisionEnabled"
  );

  const clientSource = loadInternalApiSource();
  assert.match(
    clientSource,
    /\/api\/v1\/internal\/runtime\/async-jobs\/v1\/perception-artifacts/,
    "PersaiInternalApiClientService must call the versioned perception-artifacts route"
  );
  assert.match(
    clientSource,
    /resolveAsyncJobPerceptionArtifacts\(/,
    "client helper resolveAsyncJobPerceptionArtifacts must remain for turn execution"
  );
}
