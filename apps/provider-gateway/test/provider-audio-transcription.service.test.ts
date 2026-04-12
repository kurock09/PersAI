import assert from "node:assert/strict";
import type { ProviderGatewayAudioTranscriptionResult } from "@persai/runtime-contract";
import type { ProviderWarmupSnapshot } from "../src/modules/providers/provider-client.types";
import { ProviderAudioTranscriptionService } from "../src/modules/providers/provider-audio-transcription.service";
import type { ProviderWarmupService } from "../src/modules/providers/provider-warmup.service";
import type { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";

function createWarmupSnapshot(): ProviderWarmupSnapshot {
  return {
    schema: "persai.providerGatewayWarmup.v1",
    warmOnBoot: false,
    runs: 1,
    failures: 0,
    lastAttemptedAt: null,
    lastCompletedAt: null,
    lastDurationMs: null,
    providers: [
      {
        provider: "openai",
        configured: true,
        state: "ready",
        catalogModels: ["gpt-5.4"],
        catalogSource: "control_plane_apply",
        warmedAt: "2026-04-12T00:00:00.000Z",
        error: null
      },
      {
        provider: "anthropic",
        configured: true,
        state: "ready",
        catalogModels: ["claude-sonnet-4-5"],
        catalogSource: "control_plane_apply",
        warmedAt: "2026-04-12T00:00:00.000Z",
        error: null
      }
    ]
  };
}

class FakeProviderWarmupService {
  snapshot = createWarmupSnapshot();

  getSnapshot(): ProviderWarmupSnapshot {
    return this.snapshot;
  }
}

class FakeOpenAIProviderClient {
  calls: Array<{ buffer: Buffer; mimeType: string; filename: string | null }> = [];

  async transcribeAudio(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string | null;
  }): Promise<ProviderGatewayAudioTranscriptionResult> {
    this.calls.push(input);
    return {
      provider: "openai",
      model: "gpt-4o-mini-transcribe",
      text: "hello from audio",
      respondedAt: "2026-04-12T00:00:01.000Z"
    };
  }
}

export async function runProviderAudioTranscriptionServiceTest(): Promise<void> {
  const warmupService = new FakeProviderWarmupService();
  const openaiClient = new FakeOpenAIProviderClient();
  const service = new ProviderAudioTranscriptionService(
    warmupService as unknown as ProviderWarmupService,
    openaiClient as unknown as OpenAIProviderClient
  );

  const result = await service.transcribeAudio({
    buffer: Buffer.from("voice-data"),
    mimeType: "audio/mpeg",
    filename: "voice.mp3"
  });
  assert.equal(result.text, "hello from audio");
  assert.equal(openaiClient.calls.length, 1);
  assert.equal(openaiClient.calls[0]?.mimeType, "audio/mpeg");

  await assert.rejects(
    () =>
      service.transcribeAudio({
        buffer: Buffer.from(""),
        mimeType: "audio/mpeg",
        filename: "empty.mp3"
      }),
    /must not be empty/
  );

  await assert.rejects(
    () =>
      service.transcribeAudio({
        buffer: Buffer.from("not-audio"),
        mimeType: "application/pdf",
        filename: "bad.pdf"
      }),
    /audio MIME types/
  );

  warmupService.snapshot.providers[0] = {
    ...warmupService.snapshot.providers[0]!,
    state: "failed",
    error: "warmup failed"
  };
  await assert.rejects(
    () =>
      service.transcribeAudio({
        buffer: Buffer.from("voice-data"),
        mimeType: "audio/mpeg",
        filename: "voice.mp3"
      }),
    /not ready/
  );
}
