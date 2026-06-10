import { Injectable } from "@nestjs/common";
import { PlatformRuntimeProviderSecretStoreService } from "../platform-runtime-provider-secret-store.service";

const ELEVENLABS_PROVIDER_KEY = "tool_tts_elevenlabs";
const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";

export type ElevenLabsLiveVoiceTransportProtocol = "webrtc" | "websocket";

export type ElevenLabsLiveVoiceCredentialResult =
  | {
      transportProtocol: "webrtc";
      conversationToken: string;
    }
  | {
      transportProtocol: "websocket";
      signedUrl: string;
    };

@Injectable()
export class ElevenlabsLiveVoiceClient {
  constructor(
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async issueCredential(input: {
    agentId: string;
    transportProtocol: ElevenLabsLiveVoiceTransportProtocol;
  }): Promise<ElevenLabsLiveVoiceCredentialResult> {
    const apiKey =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        ELEVENLABS_PROVIDER_KEY
      );
    if (apiKey === null || apiKey.trim().length === 0) {
      throw new Error("ElevenLabs live voice credential is not configured.");
    }

    const endpoint =
      input.transportProtocol === "webrtc"
        ? "/v1/convai/conversation/token"
        : "/v1/convai/conversation/get-signed-url";
    const url = new URL(`${ELEVENLABS_API_BASE_URL}${endpoint}`);
    url.searchParams.set("agent_id", input.agentId);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(
        `ElevenLabs live voice credential request failed with status ${String(response.status)}.`
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    if (input.transportProtocol === "webrtc") {
      const token = typeof payload.token === "string" ? payload.token.trim() : "";
      if (token.length === 0) {
        throw new Error("ElevenLabs live voice token response did not include a token.");
      }
      return {
        transportProtocol: "webrtc",
        conversationToken: token
      };
    }

    const signedUrl = typeof payload.signed_url === "string" ? payload.signed_url.trim() : "";
    if (signedUrl.length === 0) {
      throw new Error("ElevenLabs live voice signed URL response did not include signed_url.");
    }
    return {
      transportProtocol: "websocket",
      signedUrl
    };
  }
}
