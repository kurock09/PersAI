import assert from "node:assert/strict";
import type { ProviderGatewayAudioTranscriptionResult } from "@persai/runtime-contract";
import { RuntimeMediaTranscriptionService } from "../src/modules/media/runtime-media-transcription.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";

class FakeProviderGatewayClientService {
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
      text: "hello from runtime media",
      respondedAt: "2026-04-12T00:00:01.000Z"
    };
  }
}

export async function runRuntimeMediaTranscriptionServiceTest(): Promise<void> {
  const client = new FakeProviderGatewayClientService();
  const service = new RuntimeMediaTranscriptionService(
    client as unknown as ProviderGatewayClientService
  );

  const result = await service.transcribeAudio({
    buffer: Buffer.from("voice-data"),
    mimeType: "audio/mpeg",
    filename: "voice.mp3"
  });
  assert.equal(result.text, "hello from runtime media");
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]?.filename, "voice.mp3");

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
        buffer: Buffer.from("bad"),
        mimeType: "application/pdf",
        filename: "bad.pdf"
      }),
    /audio MIME types/
  );
}
