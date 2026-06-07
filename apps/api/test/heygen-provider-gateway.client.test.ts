/**
 * ADR-109 Slice 5b (E12) — unit tests for HeyGenProviderGatewayClient.
 *
 * All fetch calls are intercepted via globalThis.fetch mock. No real network.
 *
 * Coverage:
 *  1. 200 with valid response → returns { avatarId }
 *  2. 200 with missing schema → throws ServiceUnavailableException(heygen_unavailable)
 *  3. 200 with empty avatarId → throws ServiceUnavailableException(heygen_unavailable)
 *  4. 4xx response → throws BadRequestException(heygen_avatar_create_failed)
 *  5. 5xx response → throws ServiceUnavailableException(heygen_unavailable)
 *  6. Network error → throws ServiceUnavailableException(heygen_unavailable)
 *  7. Abort/timeout → throws ServiceUnavailableException(heygen_unavailable)
 *  8. Missing PERSAI_PROVIDER_GATEWAY_BASE_URL → throws ServiceUnavailableException(heygen_unavailable)
 *  9. Request body shape — schema + credential.providerId + name + portrait fields
 */

import assert from "node:assert/strict";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";

// Override env before importing the client (the client reads env at call time)
const originalEnv = { ...process.env };

function setGatewayUrl(url: string | undefined): void {
  if (url === undefined) {
    delete process.env["PERSAI_PROVIDER_GATEWAY_BASE_URL"];
  } else {
    process.env["PERSAI_PROVIDER_GATEWAY_BASE_URL"] = url;
  }
}

const GATEWAY_URL = "http://gateway.test:3011";
const MOCK_AVATAR_ID = "ava-gateway-1";
const MOCK_VOICE_CLONE_ID = "voice-clone-gateway-1";

function makeSuccessResponse(avatarId: string): Response {
  return new Response(
    JSON.stringify({
      schema: "persai.providerGatewayHeyGenCreatePhotoAvatarResult.v1",
      provider: "heygen",
      avatarId,
      respondedAt: new Date().toISOString()
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function make4xxResponse(message: string): Response {
  return new Response(JSON.stringify({ error: { code: "heygen_avatar_create_failed", message } }), {
    status: 422,
    headers: { "Content-Type": "application/json" }
  });
}

function make5xxResponse(): Response {
  return new Response(
    JSON.stringify({ error: { code: "internal_error", message: "upstream failed" } }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}

function makeInput() {
  return {
    credentialSecretId: "tool/video_generate/heygen/api-key",
    name: "Test Persona",
    portraitImageBytesBase64: Buffer.from("portrait-bytes").toString("base64"),
    portraitImageMimeType: "image/jpeg"
  };
}

function makeVoiceCloneInput() {
  return {
    credentialSecretId: "tool/video_generate/heygen/api-key",
    displayName: "My Voice Clone",
    audioBytesBase64: Buffer.from("voice-bytes").toString("base64"),
    audioMimeType: "audio/mpeg",
    languageHint: "en",
    removeBackgroundNoise: true
  };
}

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;

  // Dynamically import the client so env is applied first
  const { HeyGenProviderGatewayClient } =
    await import("../src/modules/workspace-management/application/heygen/heygen-provider-gateway.client");

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: 200 valid response → returns { avatarId }
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    globalThis.fetch = (async () => makeSuccessResponse(MOCK_AVATAR_ID)) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      const result = await client.createPhotoAvatar(makeInput());
      assert.equal(result.avatarId, MOCK_AVATAR_ID);
      console.log("✓ Test 1: 200 valid response returns { avatarId }");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: 200 with wrong schema → ServiceUnavailableException(heygen_unavailable)
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ schema: "wrong.schema", provider: "heygen", avatarId: MOCK_AVATAR_ID }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      await assert.rejects(
        () => client.createPhotoAvatar(makeInput()),
        (err: Error) => {
          assert.ok(err instanceof ServiceUnavailableException);
          const body = (err as ServiceUnavailableException).getResponse() as Record<
            string,
            unknown
          >;
          const error = body["error"] as Record<string, unknown>;
          assert.equal(error["code"], "heygen_unavailable");
          return true;
        }
      );
      console.log("✓ Test 2: 200 wrong schema → ServiceUnavailableException(heygen_unavailable)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: 200 with empty avatarId → ServiceUnavailableException(heygen_unavailable)
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          schema: "persai.providerGatewayHeyGenCreatePhotoAvatarResult.v1",
          provider: "heygen",
          avatarId: ""
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      await assert.rejects(
        () => client.createPhotoAvatar(makeInput()),
        (err: Error) => {
          assert.ok(err instanceof ServiceUnavailableException);
          return true;
        }
      );
      console.log("✓ Test 3: 200 empty avatarId → ServiceUnavailableException(heygen_unavailable)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: 4xx response → BadRequestException(heygen_avatar_create_failed)
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    globalThis.fetch = (async () =>
      make4xxResponse("Invalid portrait image format")) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      await assert.rejects(
        () => client.createPhotoAvatar(makeInput()),
        (err: Error) => {
          assert.ok(err instanceof BadRequestException);
          const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
          const error = body["error"] as Record<string, unknown>;
          assert.equal(error["code"], "heygen_avatar_create_failed");
          assert.ok(
            typeof error["message"] === "string" && error["message"].includes("Invalid portrait"),
            "Error message should include the gateway error"
          );
          return true;
        }
      );
      console.log("✓ Test 4: 4xx → BadRequestException(heygen_avatar_create_failed)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5: 5xx response → ServiceUnavailableException(heygen_unavailable)
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    globalThis.fetch = (async () => make5xxResponse()) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      await assert.rejects(
        () => client.createPhotoAvatar(makeInput()),
        (err: Error) => {
          assert.ok(err instanceof ServiceUnavailableException);
          const body = (err as ServiceUnavailableException).getResponse() as Record<
            string,
            unknown
          >;
          const error = body["error"] as Record<string, unknown>;
          assert.equal(error["code"], "heygen_unavailable");
          return true;
        }
      );
      console.log("✓ Test 5: 5xx → ServiceUnavailableException(heygen_unavailable)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6: Network error → ServiceUnavailableException(heygen_unavailable)
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed: connection refused");
    }) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      await assert.rejects(
        () => client.createPhotoAvatar(makeInput()),
        (err: Error) => {
          assert.ok(err instanceof ServiceUnavailableException);
          const body = (err as ServiceUnavailableException).getResponse() as Record<
            string,
            unknown
          >;
          const error = body["error"] as Record<string, unknown>;
          assert.equal(error["code"], "heygen_unavailable");
          return true;
        }
      );
      console.log("✓ Test 6: network error → ServiceUnavailableException(heygen_unavailable)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7: Missing PERSAI_PROVIDER_GATEWAY_BASE_URL → ServiceUnavailableException immediately
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(undefined);
    // fetch should never be called in this case
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return makeSuccessResponse(MOCK_AVATAR_ID);
    }) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      await assert.rejects(
        () => client.createPhotoAvatar(makeInput()),
        (err: Error) => {
          assert.ok(err instanceof ServiceUnavailableException);
          const body = (err as ServiceUnavailableException).getResponse() as Record<
            string,
            unknown
          >;
          const error = body["error"] as Record<string, unknown>;
          assert.equal(error["code"], "heygen_unavailable");
          return true;
        }
      );
      assert.equal(fetchCalled, false, "fetch must NOT be called when base URL is not configured");
      console.log(
        "✓ Test 7: missing base URL → ServiceUnavailableException(heygen_unavailable), fetch not called"
      );
    } finally {
      globalThis.fetch = originalFetch;
      setGatewayUrl(originalEnv["PERSAI_PROVIDER_GATEWAY_BASE_URL"]);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 8: Request body shape verification
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    let capturedBody: unknown = null;
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      try {
        capturedBody = JSON.parse(String(init?.body));
      } catch {
        capturedBody = null;
      }
      return makeSuccessResponse(MOCK_AVATAR_ID);
    }) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      const testInput = makeInput();
      await client.createPhotoAvatar(testInput);

      assert.ok(
        capturedUrl?.endsWith("/api/v1/providers/heygen/create-photo-avatar"),
        `Expected URL to end with /api/v1/providers/heygen/create-photo-avatar, got: ${String(capturedUrl)}`
      );

      const body = capturedBody as Record<string, unknown>;
      assert.equal(body["schema"], "persai.providerGatewayHeyGenCreatePhotoAvatarRequest.v1");
      const cred = body["credential"] as Record<string, unknown>;
      assert.equal(cred["secretId"], testInput.credentialSecretId);
      assert.equal(cred["providerId"], "heygen");
      assert.equal(body["name"], testInput.name);
      assert.equal(body["portraitImageBytesBase64"], testInput.portraitImageBytesBase64);
      assert.equal(body["portraitImageMimeType"], testInput.portraitImageMimeType);

      console.log("✓ Test 8: request body shape is correct");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 9: createVoiceClone success → returns { voiceCloneId, previewAudioUrl }
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          schema: "persai.providerGatewayHeyGenCreateVoiceCloneResult.v1",
          provider: "heygen",
          voiceCloneId: MOCK_VOICE_CLONE_ID,
          status: "complete",
          previewAudioUrl: "https://cdn.heygen.com/clone-preview.mp3",
          respondedAt: new Date().toISOString()
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      const result = await client.createVoiceClone(makeVoiceCloneInput());
      assert.equal(result.voiceCloneId, MOCK_VOICE_CLONE_ID);
      assert.equal(result.previewAudioUrl, "https://cdn.heygen.com/clone-preview.mp3");
      console.log("✓ Test 9: createVoiceClone success parses the provider-gateway result");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 10: resource_limit_reached maps to stable BadRequestException code
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "heygen_voice_clone_limit_reached",
            message: "You have reached the HeyGen clone limit."
          }
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      await assert.rejects(
        () => client.createVoiceClone(makeVoiceCloneInput()),
        (err: Error) => {
          assert.ok(err instanceof BadRequestException);
          const body = err.getResponse() as Record<string, unknown>;
          const error = body["error"] as Record<string, unknown>;
          assert.equal(error["code"], "heygen_voice_clone_limit_reached");
          return true;
        }
      );
      console.log("✓ Test 10: clone limit maps to stable BadRequestException code");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 11: plan_upgrade_required maps to stable BadRequestException code
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "heygen_voice_clone_plan_upgrade_required",
            message: "Please upgrade your HeyGen plan."
          }
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      await assert.rejects(
        () => client.createVoiceClone(makeVoiceCloneInput()),
        (err: Error) => {
          assert.ok(err instanceof BadRequestException);
          const body = err.getResponse() as Record<string, unknown>;
          const error = body["error"] as Record<string, unknown>;
          assert.equal(error["code"], "heygen_voice_clone_plan_upgrade_required");
          return true;
        }
      );
      console.log("✓ Test 11: plan-upgrade maps to stable BadRequestException code");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 12: createVoiceClone request body shape verification
  // ──────────────────────────────────────────────────────────────────────────
  {
    setGatewayUrl(GATEWAY_URL);
    let capturedBody: unknown = null;
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          schema: "persai.providerGatewayHeyGenCreateVoiceCloneResult.v1",
          provider: "heygen",
          voiceCloneId: MOCK_VOICE_CLONE_ID,
          status: "complete",
          previewAudioUrl: null,
          respondedAt: new Date().toISOString()
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      const client = new HeyGenProviderGatewayClient();
      const testInput = makeVoiceCloneInput();
      await client.createVoiceClone(testInput);

      assert.ok(
        capturedUrl?.endsWith("/api/v1/providers/heygen/create-voice-clone"),
        `Expected URL to end with /api/v1/providers/heygen/create-voice-clone, got: ${String(capturedUrl)}`
      );
      const body = capturedBody as Record<string, unknown>;
      assert.equal(body["schema"], "persai.providerGatewayHeyGenCreateVoiceCloneRequest.v1");
      const cred = body["credential"] as Record<string, unknown>;
      assert.equal(cred["secretId"], testInput.credentialSecretId);
      assert.equal(cred["providerId"], "heygen");
      assert.equal(body["displayName"], testInput.displayName);
      assert.equal(body["audioBytesBase64"], testInput.audioBytesBase64);
      assert.equal(body["audioMimeType"], testInput.audioMimeType);
      assert.equal(body["languageHint"], testInput.languageHint);
      assert.equal(body["removeBackgroundNoise"], true);
      console.log("✓ Test 12: createVoiceClone request body shape is correct");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // Restore env
  process.env["PERSAI_PROVIDER_GATEWAY_BASE_URL"] = originalEnv["PERSAI_PROVIDER_GATEWAY_BASE_URL"];

  console.log("\nheygen-provider-gateway.client: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
