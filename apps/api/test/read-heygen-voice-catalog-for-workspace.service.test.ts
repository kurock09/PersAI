/**
 * ADR-109 Slice 9 — focused unit tests for ReadHeygenVoiceCatalogForWorkspaceService.
 *
 * Coverage:
 *  1. Happy path with non-empty cache → returns provider + voices array
 *  2. Null cache (no HeyGen credential / empty) → returns null
 *  3. Empty voices array in catalog → returns null
 *  4. Entry shape includes previewAudioUrl when present, null when absent
 */

import assert from "node:assert/strict";
import { ReadHeygenVoiceCatalogForWorkspaceService } from "../src/modules/workspace-management/application/heygen/read-heygen-voice-catalog-for-workspace.service";
import type { RuntimeVideoVoiceCatalogEntry } from "@persai/runtime-contract";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

function makeVoiceCatalogService(entries: RuntimeVideoVoiceCatalogEntry[]) {
  return {
    async getApprovedVoiceCatalogEntries() {
      return entries;
    },
    async getFullVoiceCatalogEntries() {
      return entries;
    }
  };
}

async function run(): Promise<void> {
  // Test 1: Happy path with non-empty cache
  {
    const svc = new ReadHeygenVoiceCatalogForWorkspaceService(
      makeVoiceCatalogService([
        {
          voiceKey: "amy",
          providerVoiceId: "en-US-Amy",
          displayName: "Amy",
          locale: "en-US",
          gender: "female",
          description: "en-US | news",
          styleTags: ["news"],
          previewAudioUrl: "https://cdn.heygen.com/preview/amy.mp3",
          source: "elevenlabs",
          qualityTags: ["professional"],
          qualityRank: 188,
          previewAvailable: true,
          localeControl: false,
          pauseSupport: true
        },
        {
          voiceKey: "boris",
          providerVoiceId: "ru-RU-Boris",
          displayName: "Boris",
          locale: "ru-RU",
          gender: "male",
          description: "ru-RU",
          styleTags: [],
          previewAudioUrl: null
        }
      ]) as never
    );
    const result = await svc.getVoiceCatalogForWorkspace(WORKSPACE_ID);
    assert.ok(result !== null, "Result must not be null for non-empty catalog");
    assert.equal(result.provider, "heygen");
    assert.equal(result.voices.length, 2);
    assert.equal(result.voices[0]!.voiceId, "en-US-Amy");
    assert.equal(result.voices[0]!.name, "Amy");
    assert.equal(result.voices[0]!.language, "en-US");
    assert.equal(result.voices[0]!.gender, "female");
    assert.equal(result.voices[0]!.previewAudioUrl, "https://cdn.heygen.com/preview/amy.mp3");
    assert.equal(result.voices[0]!.source, "elevenlabs");
    assert.deepEqual(result.voices[0]!.qualityTags, ["professional"]);
    assert.equal(result.voices[0]!.qualityRank, 188);
    assert.equal(result.voices[0]!.previewAvailable, true);
    assert.equal(result.voices[0]!.pauseSupport, true);
    console.log("✓ Test 1: happy path non-empty cache");
  }

  // Test 2: Null catalog (no HeyGen credential / empty)
  {
    const svc = new ReadHeygenVoiceCatalogForWorkspaceService(makeVoiceCatalogService([]) as never);
    const result = await svc.getVoiceCatalogForWorkspace(WORKSPACE_ID);
    assert.equal(result, null, "Result must be null when catalog is empty");
    console.log("✓ Test 2: empty catalog returns null");
  }

  // Test 3: Empty voices array → returns null
  {
    const svc = new ReadHeygenVoiceCatalogForWorkspaceService(makeVoiceCatalogService([]) as never);
    const result = await svc.getVoiceCatalogForWorkspace(WORKSPACE_ID);
    assert.equal(result, null, "Result must be null when entries are empty");
    console.log("✓ Test 3: empty voices array returns null");
  }

  // Test 4: Entry shape — previewAudioUrl present or null
  {
    const svc = new ReadHeygenVoiceCatalogForWorkspaceService(
      makeVoiceCatalogService([
        {
          voiceKey: "masha",
          providerVoiceId: "ru-RU-Masha",
          displayName: "Masha",
          locale: "ru-RU",
          gender: "female",
          description: null,
          styleTags: [],
          previewAudioUrl: "https://cdn.heygen.com/preview/masha.mp3"
        },
        {
          voiceKey: "unknown",
          providerVoiceId: "xx-XX-Unknown",
          displayName: "Unknown",
          locale: null,
          gender: "unknown",
          description: null,
          styleTags: [],
          previewAudioUrl: null
        }
      ]) as never
    );
    const result = await svc.getVoiceCatalogForWorkspace(WORKSPACE_ID);
    assert.ok(result !== null);
    const masha = result.voices.find((v) => v.voiceId === "ru-RU-Masha");
    assert.ok(masha !== undefined, "Masha voice must be present");
    assert.equal(
      masha.previewAudioUrl,
      "https://cdn.heygen.com/preview/masha.mp3",
      "previewAudioUrl must be present when set"
    );
    const unknown = result.voices.find((v) => v.voiceId === "xx-XX-Unknown");
    assert.ok(unknown !== undefined, "Unknown voice must be present");
    assert.equal(unknown.previewAudioUrl, null, "previewAudioUrl must be null when absent");
    assert.equal(unknown.language, null, "language must be null when locale is null");
    console.log("✓ Test 4: entry shape includes previewAudioUrl (present / null)");
  }

  console.log("\nread-heygen-voice-catalog-for-workspace.service: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
