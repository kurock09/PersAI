import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type { ProviderGatewayVideoGenerateRequest } from "@persai/runtime-contract";
import {
  HeyGenProviderClient,
  HeyGenProviderClientError
} from "../src/modules/providers/heygen/heygen-provider.client";
import { ProviderHeyGenVoicesService } from "../src/modules/providers/provider-heygen-voices.service";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_BROWSERLESS_BASE_URL: "https://production-sfo.browserless.io",
    PROVIDER_GATEWAY_OPENAI_API_KEY: "openai-test-key",
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: undefined,
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

function createBaseRequest(
  overrides: Partial<ProviderGatewayVideoGenerateRequest> = {}
): ProviderGatewayVideoGenerateRequest {
  return {
    prompt: "Welcome to our new product",
    model: "heygen-photo-avatar-v3",
    size: "1280x720",
    seconds: 10,
    referenceImage: null,
    speechText: "Welcome to our new product. We are excited to share it with you.",
    speechLanguage: "en-US",
    voiceKey: "voice-en-female-1",
    credential: {
      toolCode: "video_generate",
      secretId: "tool/video_generate/heygen/api-key",
      providerId: "heygen"
    },
    providerParameters: null,
    ...overrides
  };
}

// Stable mock video bytes
const MOCK_VIDEO_BYTES = Buffer.from("heygen-video-content");
const MOCK_HEYGEN_API_KEY = "hg-test-api-key";

function makePollResponse(status: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      data: { status, ...extra }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function makeCompletedPollResponse(videoUrl: string, duration: number): Response {
  return makePollResponse("completed", { video_url: videoUrl, duration });
}

function makeSubmitResponse(videoId: string): Response {
  return new Response(JSON.stringify({ data: { video_id: videoId } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function makeUploadAssetResponse(assetId: string): Response {
  return new Response(JSON.stringify({ data: { asset_id: assetId } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function makeAvatarCreateResponse(avatarId: string): Response {
  return new Response(JSON.stringify({ data: { avatar_item: { id: avatarId } } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function makeVoiceCloneSubmitResponse(voiceCloneId: string): Response {
  return new Response(JSON.stringify({ data: { voice_clone_id: voiceCloneId } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function makeVoiceClonePollResponse(status: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ data: { status, ...extra } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function makeVideoDownload(): Response {
  return new Response(MOCK_VIDEO_BYTES, {
    status: 200,
    headers: { "Content-Type": "video/mp4" }
  });
}

function makeOctetStreamVideoDownload(): Response {
  return new Response(MOCK_VIDEO_BYTES, {
    status: 200,
    headers: { "Content-Type": "binary/octet-stream" }
  });
}

export async function runHeyGenProviderClientTest(): Promise<void> {
  const client = new HeyGenProviderClient(createConfig());
  const originalFetch = globalThis.fetch;

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: Scenario A (ad-hoc) happy path
  // ──────────────────────────────────────────────────────────────────────────
  {
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (init !== undefined) {
        requests.push({ url, init });
      } else {
        requests.push({ url });
      }

      if (url === "https://api.heygen.com/v3/videos") {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.type, "image");
        assert.ok(body.image !== null && typeof body.image === "object");
        assert.equal(body.image.type, "base64");
        assert.equal(body.image.media_type, "image/jpeg");
        assert.ok(typeof body.image.data === "string" && body.image.data.length > 0);
        assert.equal(
          body.script,
          "Welcome to our new product. We are excited to share it with you."
        );
        assert.equal(body.voice_id, "voice-en-female-1");
        return makeSubmitResponse("vid-adhoc-1");
      }
      if (url === "https://api.heygen.com/v3/videos/vid-adhoc-1") {
        const pollCount = requests.filter((r) => r.url === url).length;
        if (pollCount === 1) return makePollResponse("pending");
        if (pollCount === 2) return makePollResponse("processing");
        return makeCompletedPollResponse("https://cdn.heygen.com/vid-adhoc-1.mp4", 8.5);
      }
      if (url === "https://cdn.heygen.com/vid-adhoc-1.mp4") {
        return makeVideoDownload();
      }
      throw new Error(`Unexpected fetch in Scenario A test: ${url}`);
    }) as typeof fetch;

    try {
      const result = await client.generateVideo(
        createBaseRequest({
          personaId: null,
          portraitImageBytesBase64: Buffer.from("portrait-image-bytes").toString("base64"),
          portraitImageMimeType: "image/jpeg"
        }),
        { credentialValue: MOCK_HEYGEN_API_KEY }
      );

      assert.equal(result.provider, "heygen");
      assert.equal(result.model, "heygen-photo-avatar-v3");
      assert.equal(
        result.lazyCreatedHeygenAvatarId,
        null,
        "Scenario A should return null lazyCreatedHeygenAvatarId"
      );
      assert.ok(result.video.bytesBase64.length > 0);
      assert.equal(result.video.mimeType, "video/mp4");
      // Test 9 (billingFacts shape): assert correct structure
      assert.equal(result.billingFacts?.providerKey, "heygen");
      assert.equal(result.billingFacts?.capability, "video");
      assert.equal(result.billingFacts?.modelKey, "heygen-photo-avatar-v3");
      assert.equal(result.billingFacts?.metering?.meteringKind, "time_metered");
      assert.equal(result.billingFacts?.metering?.durationSeconds, 8.5);
      assert.equal(result.billingFacts?.metering?.durationMs, 8500);
      // seconds in result should be the actual HeyGen duration, not input.seconds
      assert.equal(result.seconds, 8.5);
      console.log("✓ Test 1: Scenario A (ad-hoc) happy path");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: Scenario C (cached avatar_id) happy path
  // ──────────────────────────────────────────────────────────────────────────
  {
    const submitBodies: unknown[] = [];

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.heygen.com/v3/videos") {
        const body = JSON.parse(String(init?.body));
        submitBodies.push(body);
        assert.equal(body.type, "avatar");
        assert.equal(body.avatar_id, "ava-123");
        assert.equal(body.voice_id, "voice-en-female-1");
        assert.equal(body.resolution, "720p");
        assert.equal(body.aspect_ratio, "9:16");
        assert.deepEqual(body.engine, { type: "avatar_v" });
        return makeSubmitResponse("vid-cached-1");
      }
      if (url === "https://api.heygen.com/v3/videos/vid-cached-1") {
        return makeCompletedPollResponse("https://cdn.heygen.com/vid-cached-1.mp4", 10.0);
      }
      if (url === "https://cdn.heygen.com/vid-cached-1.mp4") {
        return makeVideoDownload();
      }
      throw new Error(`Unexpected fetch in Scenario C cached test: ${url}`);
    }) as typeof fetch;

    try {
      const result = await client.generateVideo(
        createBaseRequest({
          cachedHeygenAvatarId: "ava-123",
          personaId: "persona-p1",
          providerParameters: {
            resolution: "720p",
            aspectRatio: "9:16",
            engine: "avatar_v"
          }
        }),
        { credentialValue: MOCK_HEYGEN_API_KEY }
      );

      assert.equal(result.provider, "heygen");
      assert.equal(
        result.lazyCreatedHeygenAvatarId,
        null,
        "Cached scenario should return null (not lazy-created)"
      );
      assert.equal(submitBodies.length, 1);
      console.log("✓ Test 2: Scenario C (cached avatar_id) happy path");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2b: HeyGen download may return octet-stream for a real mp4
  // ──────────────────────────────────────────────────────────────────────────
  {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://api.heygen.com/v3/videos") {
        return makeSubmitResponse("vid-octet-1");
      }
      if (url === "https://api.heygen.com/v3/videos/vid-octet-1") {
        return makeCompletedPollResponse("https://cdn.heygen.com/vid-octet-1.mp4", 9.0);
      }
      if (url === "https://cdn.heygen.com/vid-octet-1.mp4") {
        return makeOctetStreamVideoDownload();
      }
      throw new Error(`Unexpected fetch in octet-stream video test: ${url}`);
    }) as typeof fetch;

    try {
      const result = await client.generateVideo(
        createBaseRequest({
          personaId: null,
          portraitImageBytesBase64: Buffer.from("portrait-image-bytes").toString("base64"),
          portraitImageMimeType: "image/jpeg"
        }),
        { credentialValue: MOCK_HEYGEN_API_KEY }
      );

      assert.equal(result.video.mimeType, "video/mp4");
      console.log("✓ Test 2b: octet-stream HeyGen download normalizes to video/mp4");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: Scenario C (lazy-create avatar) happy path
  // ──────────────────────────────────────────────────────────────────────────
  {
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (init !== undefined) {
        requests.push({ url, init });
      } else {
        requests.push({ url });
      }

      if (url === "https://api.heygen.com/v3/assets") {
        return makeUploadAssetResponse("asset-portrait-1");
      }
      if (url === "https://api.heygen.com/v3/avatars") {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.type, "photo");
        assert.equal(body.file.type, "asset_id");
        assert.equal(body.file.asset_id, "asset-portrait-1");
        return makeAvatarCreateResponse("new-ava-lazy-1");
      }
      if (url === "https://api.heygen.com/v3/videos") {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.type, "avatar");
        assert.equal(body.avatar_id, "new-ava-lazy-1");
        return makeSubmitResponse("vid-lazy-1");
      }
      if (url === "https://api.heygen.com/v3/videos/vid-lazy-1") {
        return makeCompletedPollResponse("https://cdn.heygen.com/vid-lazy-1.mp4", 12.0);
      }
      if (url === "https://cdn.heygen.com/vid-lazy-1.mp4") {
        return makeVideoDownload();
      }
      throw new Error(`Unexpected fetch in Scenario C lazy-create test: ${url}`);
    }) as typeof fetch;

    try {
      const result = await client.generateVideo(
        createBaseRequest({
          cachedHeygenAvatarId: null,
          personaId: "p1",
          portraitImageBytesBase64: Buffer.from("portrait-bytes").toString("base64"),
          portraitImageMimeType: "image/jpeg"
        }),
        { credentialValue: MOCK_HEYGEN_API_KEY }
      );

      assert.equal(result.provider, "heygen");
      assert.equal(
        result.lazyCreatedHeygenAvatarId,
        "new-ava-lazy-1",
        "Lazy-create should return the new avatar_id"
      );
      assert.ok(result.video.bytesBase64.length > 0);
      console.log("✓ Test 3: Scenario C (lazy-create) happy path");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: Idempotency-Key present on every POST
  // ──────────────────────────────────────────────────────────────────────────
  {
    const postHeaders: Array<Record<string, string>> = [];

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      // Only check Idempotency-Key on the submit/create POSTs (not GET polls, not asset upload).
      if (
        init?.method === "POST" &&
        (url === "https://api.heygen.com/v3/videos" || url === "https://api.heygen.com/v3/avatars")
      ) {
        const headers = (init.headers as Record<string, string>) ?? {};
        postHeaders.push(headers);
      }

      if (url === "https://api.heygen.com/v3/assets") {
        return makeUploadAssetResponse("asset-idm-1");
      }
      if (url === "https://api.heygen.com/v3/avatars") {
        return makeAvatarCreateResponse("ava-idm-1");
      }
      if (url === "https://api.heygen.com/v3/videos") {
        return makeSubmitResponse("vid-idm-1");
      }
      if (url === "https://api.heygen.com/v3/videos/vid-idm-1") {
        return makeCompletedPollResponse("https://cdn.heygen.com/vid-idm-1.mp4", 5.0);
      }
      if (url === "https://cdn.heygen.com/vid-idm-1.mp4") {
        return makeVideoDownload();
      }
      throw new Error(`Unexpected fetch in Idempotency-Key test: ${url}`);
    }) as typeof fetch;

    try {
      await client.generateVideo(
        createBaseRequest({
          cachedHeygenAvatarId: null,
          personaId: "p-idm",
          portraitImageBytesBase64: Buffer.from("portrait").toString("base64"),
          portraitImageMimeType: "image/jpeg"
        }),
        { credentialValue: MOCK_HEYGEN_API_KEY }
      );

      // Check that all POSTs (avatar create and video submit) carried Idempotency-Key
      assert.ok(postHeaders.length >= 2, "Expected at least 2 POST calls (avatars + videos)");
      for (const headers of postHeaders) {
        const idempotencyKey =
          headers["Idempotency-Key"] ?? headers["idempotency-key"] ?? headers["idempotency_key"];
        assert.ok(
          typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0,
          `Idempotency-Key must be set on all POST requests; got: ${String(idempotencyKey)}`
        );
        // UUID-shaped check: 8-4-4-4-12 hex chars
        assert.match(
          idempotencyKey,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
      }
      console.log("✓ Test 4: Idempotency-Key present on every POST");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5: Defensive status parsing (invariant #15)
  // ──────────────────────────────────────────────────────────────────────────
  {
    // 5a: "waiting" → in-progress (not terminal)
    {
      let pollCount = 0;
      globalThis.fetch = (async (input: URL | RequestInfo) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;

        if (url === "https://api.heygen.com/v3/videos") return makeSubmitResponse("vid-status-1");
        if (url === "https://api.heygen.com/v3/videos/vid-status-1") {
          pollCount++;
          if (pollCount === 1) return makePollResponse("waiting");
          if (pollCount === 2) return makePollResponse("unknown_future_value");
          return makeCompletedPollResponse("https://cdn.heygen.com/vid-status-1.mp4", 6.0);
        }
        if (url === "https://cdn.heygen.com/vid-status-1.mp4") return makeVideoDownload();
        throw new Error(`Unexpected fetch in defensive status test: ${url}`);
      }) as typeof fetch;

      try {
        const result = await client.generateVideo(
          createBaseRequest({
            cachedHeygenAvatarId: "ava-status",
            personaId: null
          }),
          { credentialValue: MOCK_HEYGEN_API_KEY }
        );
        assert.equal(result.provider, "heygen");
        // Confirm that "waiting" and "unknown_future_value" were treated as in-progress
        assert.ok(pollCount >= 3, "Should have polled past 'waiting' and 'unknown_future_value'");
        console.log("✓ Test 5a: 'waiting' and unknown status treated as in-progress");
      } finally {
        globalThis.fetch = originalFetch;
      }
    }

    // 5b: "failed" → terminal FAILED error
    {
      globalThis.fetch = (async (input: URL | RequestInfo) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;

        if (url === "https://api.heygen.com/v3/videos") return makeSubmitResponse("vid-failed-1");
        if (url === "https://api.heygen.com/v3/videos/vid-failed-1") {
          return makePollResponse("failed", {
            failure_message: "Avatar rendering failed due to low-quality image"
          });
        }
        throw new Error(`Unexpected fetch in 'failed' status test: ${url}`);
      }) as typeof fetch;

      try {
        await assert.rejects(
          () =>
            client.generateVideo(
              createBaseRequest({ cachedHeygenAvatarId: "ava-fail", personaId: null }),
              { credentialValue: MOCK_HEYGEN_API_KEY }
            ),
          /Avatar rendering failed due to low-quality image/i
        );
        console.log("✓ Test 5b: 'failed' status throws honest error");
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6: Polling-loss tolerance (3 consecutive transient failures → PERSAI_VIDEO_POLLING_LOST)
  // ──────────────────────────────────────────────────────────────────────────
  {
    let pollAttempts = 0;

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url === "https://api.heygen.com/v3/videos") return makeSubmitResponse("vid-loss-1");
      if (url === "https://api.heygen.com/v3/videos/vid-loss-1") {
        pollAttempts++;
        throw new Error("fetch network error");
      }
      throw new Error(`Unexpected fetch in polling-loss test: ${url}`);
    }) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          client.generateVideo(
            createBaseRequest({ cachedHeygenAvatarId: "ava-loss", personaId: null }),
            { credentialValue: MOCK_HEYGEN_API_KEY }
          ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /PERSAI_VIDEO_POLLING_LOST::/);
          const marker = "PERSAI_VIDEO_POLLING_LOST::";
          const payload = JSON.parse(
            error.message.slice(error.message.indexOf(marker) + marker.length)
          ) as Record<string, unknown>;
          assert.equal(payload["provider"], "heygen");
          assert.equal(payload["providerStage"], "accepted");
          assert.equal(payload["code"], "accepted_primary_unconfirmed");
          assert.equal(payload["providerTaskId"], "vid-loss-1");
          return true;
        }
      );
      assert.equal(pollAttempts, 3, "Should attempt exactly 3 polls before throwing");
      console.log("✓ Test 6: Polling-loss (3 failures) throws PERSAI_VIDEO_POLLING_LOST");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6b: Completed poll but download transport loss → PERSAI_VIDEO_POLLING_LOST
  // ──────────────────────────────────────────────────────────────────────────
  {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url === "https://api.heygen.com/v3/videos") return makeSubmitResponse("vid-dl-loss-1");
      if (url === "https://api.heygen.com/v3/videos/vid-dl-loss-1") {
        return makeCompletedPollResponse("https://cdn.heygen.com/vid-dl-loss-1.mp4", 12);
      }
      if (url === "https://cdn.heygen.com/vid-dl-loss-1.mp4") {
        throw new Error("fetch failed");
      }
      throw new Error(`Unexpected fetch in download-loss test: ${url}`);
    }) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          client.generateVideo(
            createBaseRequest({ cachedHeygenAvatarId: "ava-dl-loss", personaId: null }),
            { credentialValue: MOCK_HEYGEN_API_KEY }
          ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /PERSAI_VIDEO_POLLING_LOST::/);
          const marker = "PERSAI_VIDEO_POLLING_LOST::";
          const payload = JSON.parse(
            error.message.slice(error.message.indexOf(marker) + marker.length)
          ) as Record<string, unknown>;
          assert.equal(payload["providerTaskId"], "vid-dl-loss-1");
          assert.equal(payload["reason"], "provider completed but download transport lost");
          return true;
        }
      );
      console.log(
        "✓ Test 6b: Download transport loss throws recoverable PERSAI_VIDEO_POLLING_LOST"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6c: Accepted-task checkpoint fires immediately after submit
  // ──────────────────────────────────────────────────────────────────────────
  {
    const checkpointCalls: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url === "https://api.heygen.com/v3/videos") return makeSubmitResponse("vid-checkpoint-1");
      if (url === "https://api.heygen.com/v3/videos/vid-checkpoint-1") {
        return makeCompletedPollResponse("https://cdn.heygen.com/vid-checkpoint-1.mp4", 12);
      }
      if (url === "https://cdn.heygen.com/vid-checkpoint-1.mp4") {
        return new Response(MOCK_VIDEO_BYTES, {
          status: 200,
          headers: { "Content-Type": "video/mp4" }
        });
      }
      throw new Error(`Unexpected fetch in checkpoint test: ${url}`);
    }) as typeof fetch;

    try {
      await client.generateVideo(
        createBaseRequest({ cachedHeygenAvatarId: "ava-checkpoint", personaId: null }),
        {
          credentialValue: MOCK_HEYGEN_API_KEY,
          onAcceptedTaskCheckpoint: async (task) => {
            checkpointCalls.push(task as unknown as Record<string, unknown>);
          }
        }
      );
      assert.equal(checkpointCalls.length, 1);
      assert.equal(checkpointCalls[0]?.["providerTaskId"], "vid-checkpoint-1");
      assert.equal(checkpointCalls[0]?.["provider"], "heygen");
      console.log("✓ Test 6c: Accepted-task checkpoint fires after submit");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7: 4xx submit error — no retry, honest error message
  // ──────────────────────────────────────────────────────────────────────────
  {
    let submitCalls = 0;

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url === "https://api.heygen.com/v3/videos") {
        submitCalls++;
        return new Response(
          JSON.stringify({ error: { code: "authentication_failed", message: "Invalid API key" } }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch in 4xx test: ${url}`);
    }) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          client.generateVideo(
            createBaseRequest({ cachedHeygenAvatarId: "ava-4xx", personaId: null }),
            { credentialValue: MOCK_HEYGEN_API_KEY }
          ),
        /Invalid API key/i
      );
      assert.equal(submitCalls, 1, "Should NOT retry on 4xx — exactly 1 attempt");
      console.log("✓ Test 7: 4xx submit fails honestly with no retry");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 8: Missing duration in completed response → throws heygen_duration_missing
  // ──────────────────────────────────────────────────────────────────────────
  {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url === "https://api.heygen.com/v3/videos") return makeSubmitResponse("vid-nodur-1");
      if (url === "https://api.heygen.com/v3/videos/vid-nodur-1") {
        // completed but NO duration field
        return new Response(
          JSON.stringify({
            data: { status: "completed", video_url: "https://cdn.heygen.com/vid-nodur-1.mp4" }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch in missing duration test: ${url}`);
    }) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          client.generateVideo(
            createBaseRequest({ cachedHeygenAvatarId: "ava-nodur", personaId: null }),
            { credentialValue: MOCK_HEYGEN_API_KEY }
          ),
        /heygen_duration_missing/i
      );
      console.log(
        "✓ Test 8: Missing duration throws heygen_duration_missing (no fake billingFacts)"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 9 (baked into Test 1 above): BillingFacts shape verified
  // ──────────────────────────────────────────────────────────────────────────

  // ──────────────────────────────────────────────────────────────────────────
  // Test 10: Resume via input.acceptedTask (skip submit entirely)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const callUrls: string[] = [];

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      callUrls.push(url);

      if (url === "https://api.heygen.com/v3/videos/vid-existing") {
        return makeCompletedPollResponse("https://cdn.heygen.com/vid-existing.mp4", 15.0);
      }
      if (url === "https://cdn.heygen.com/vid-existing.mp4") {
        return makeVideoDownload();
      }
      throw new Error(`Unexpected fetch in resume test: ${url}`);
    }) as typeof fetch;

    try {
      const result = await client.generateVideo(
        createBaseRequest({
          cachedHeygenAvatarId: "ava-existing",
          acceptedTask: {
            provider: "heygen",
            model: "heygen-photo-avatar-v3",
            providerTaskId: "vid-existing",
            acceptedAt: "2026-06-05T00:00:00.000Z",
            providerStage: "accepted"
          }
        }),
        { credentialValue: MOCK_HEYGEN_API_KEY }
      );
      assert.equal(result.provider, "heygen");
      // Should NOT have called the submit endpoint
      const submitCalled = callUrls.some(
        (u) => u === "https://api.heygen.com/v3/videos" && !u.includes("/vid-")
      );
      assert.equal(submitCalled, false, "Should not call POST /v3/videos when resuming");
      assert.ok(
        callUrls.some((u) => u.includes("vid-existing")),
        "Should poll the existing video"
      );
      console.log("✓ Test 10: Resume via acceptedTask skips submit");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 11: Missing API key throws honest error
  // ──────────────────────────────────────────────────────────────────────────
  {
    await assert.rejects(
      () => client.generateVideo(createBaseRequest(), { credentialValue: "" }),
      /HeyGen API key is required/i
    );
    await assert.rejects(
      () => client.generateVideo(createBaseRequest()),
      /HeyGen API key is required/i
    );
    console.log("✓ Test 11: Missing API key throws honest error");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 12: voice_required when voiceKey is missing
  // ──────────────────────────────────────────────────────────────────────────
  {
    await assert.rejects(
      () =>
        client.generateVideo(
          createBaseRequest({
            cachedHeygenAvatarId: "ava-novoice",
            personaId: null,
            voiceKey: null,
            voiceIds: null
          }),
          { credentialValue: MOCK_HEYGEN_API_KEY }
        ),
      /voice_required/i
    );
    console.log("✓ Test 12: voice_required when voiceKey is missing");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 13: standalone createPhotoAvatar — asset upload + avatar create (Slice 5b E12)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (init !== undefined) {
        requests.push({ url, init });
      } else {
        requests.push({ url });
      }

      if (url === "https://api.heygen.com/v3/assets") {
        return makeUploadAssetResponse("asset-standalone-1");
      }
      if (url === "https://api.heygen.com/v3/avatars") {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.type, "photo");
        assert.equal(body.name, "My Display Name");
        assert.equal(body.file.type, "asset_id");
        assert.equal(body.file.asset_id, "asset-standalone-1");
        return makeAvatarCreateResponse("ava-standalone-1");
      }
      throw new Error(`Unexpected fetch in standalone createPhotoAvatar test: ${url}`);
    }) as typeof fetch;

    try {
      const result = await client.createPhotoAvatar(
        {
          name: "My Display Name",
          portraitImageBytesBase64: Buffer.from("portrait-bytes").toString("base64"),
          portraitImageMimeType: "image/jpeg"
        },
        { credentialValue: MOCK_HEYGEN_API_KEY }
      );

      assert.equal(result.avatarId, "ava-standalone-1");

      // Verify POST /v3/assets was called
      const assetPost = requests.find((r) => r.url === "https://api.heygen.com/v3/assets");
      assert.ok(assetPost !== undefined, "Asset upload POST should have been called");

      // Verify POST /v3/avatars has Idempotency-Key
      const avatarPost = requests.find(
        (r) => r.url === "https://api.heygen.com/v3/avatars" && r.init?.method === "POST"
      );
      assert.ok(avatarPost !== undefined, "Avatar create POST should have been called");
      const headers = (avatarPost!.init!.headers as Record<string, string>) ?? {};
      const idempotencyKey =
        headers["Idempotency-Key"] ?? headers["idempotency-key"] ?? headers["idempotency_key"];
      assert.ok(
        typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0,
        "Idempotency-Key must be set on avatar create POST"
      );
      assert.match(
        idempotencyKey,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // No video submission should have occurred
      const videoPost = requests.find((r) => r.url === "https://api.heygen.com/v3/videos");
      assert.ok(
        videoPost === undefined,
        "No video submit should occur in standalone createPhotoAvatar"
      );

      console.log(
        "✓ Test 13: standalone createPhotoAvatar — asset upload + avatar create; no video submit; idempotency-key present"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 14: createVoiceClone submits JSON clone request and accepts exact complete only
  // ──────────────────────────────────────────────────────────────────────────
  {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let pollCount = 0;

    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (init !== undefined) {
        requests.push({ url, init });
      } else {
        requests.push({ url });
      }

      if (url === "https://api.heygen.com/v3/voices/clone") {
        const headers = (init?.headers as Record<string, string>) ?? {};
        assert.equal(init?.method, "POST");
        assert.equal(headers["X-Api-Key"], MOCK_HEYGEN_API_KEY);
        assert.equal(headers["Content-Type"], "application/json");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.voice_name, "My Voice Clone");
        assert.equal(body.audio.type, "base64");
        assert.equal(body.audio.media_type, "audio/mpeg");
        assert.ok(typeof body.audio.data === "string" && body.audio.data.length > 0);
        assert.equal(body.language, "en");
        assert.equal(body.remove_background_noise, true);
        return makeVoiceCloneSubmitResponse("clone-voice-1");
      }
      if (url === "https://api.heygen.com/v3/voices/clone-voice-1") {
        pollCount += 1;
        if (pollCount === 1) {
          return makeVoiceClonePollResponse("pending");
        }
        if (pollCount === 2) {
          return makeVoiceClonePollResponse("completed");
        }
        return makeVoiceClonePollResponse("complete", {
          preview_audio_url: "https://cdn.heygen.com/clone-preview-1.mp3"
        });
      }
      throw new Error(`Unexpected fetch in voice-clone happy-path test: ${url}`);
    }) as typeof fetch;

    try {
      const result = await client.createVoiceClone(
        {
          displayName: "My Voice Clone",
          audioBytesBase64: Buffer.from("voice-bytes").toString("base64"),
          audioMimeType: "audio/mpeg",
          languageHint: "en",
          removeBackgroundNoise: true
        },
        { credentialValue: MOCK_HEYGEN_API_KEY, pollIntervalMs: 0 }
      );
      assert.equal(result.voiceCloneId, "clone-voice-1");
      assert.equal(result.status, "complete");
      assert.equal(result.previewAudioUrl, "https://cdn.heygen.com/clone-preview-1.mp3");
      assert.equal(pollCount, 3, 'Polling must continue past "completed" until exact "complete".');
      console.log(
        '✓ Test 14: voice clone uses POST /v3/voices/clone and only exact "complete" succeeds'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 15: createVoiceClone surfaces terminal failed status honestly
  // ──────────────────────────────────────────────────────────────────────────
  {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.heygen.com/v3/voices/clone") {
        return makeVoiceCloneSubmitResponse("clone-failed-1");
      }
      if (url === "https://api.heygen.com/v3/voices/clone-failed-1") {
        return makeVoiceClonePollResponse("failed", {
          failure_message: "Voice sample quality is too low"
        });
      }
      throw new Error(`Unexpected fetch in voice-clone failed-status test: ${url}`);
    }) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          client.createVoiceClone(
            {
              displayName: "Failed Clone",
              audioBytesBase64: Buffer.from("voice-bytes").toString("base64"),
              audioMimeType: "audio/mpeg"
            },
            { credentialValue: MOCK_HEYGEN_API_KEY, pollIntervalMs: 0 }
          ),
        /Voice sample quality is too low/i
      );
      console.log("✓ Test 15: voice clone failed status surfaces honest provider error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 16: provider voice service maps limit and plan-upgrade errors stably
  // ──────────────────────────────────────────────────────────────────────────
  {
    const service = new ProviderHeyGenVoicesService(
      {
        async createVoiceClone() {
          throw new HeyGenProviderClientError(
            "Clone limit reached",
            400,
            "Clone limit reached",
            "resource_limit_reached"
          );
        }
      } as never,
      {
        async resolveSecretValue() {
          return MOCK_HEYGEN_API_KEY;
        }
      } as never
    );
    await assert.rejects(
      () =>
        service.createVoiceClone({
          schema: "persai.providerGatewayHeyGenCreateVoiceCloneRequest.v1",
          credential: {
            secretId: "tool/video_generate/heygen/api-key",
            providerId: "heygen"
          },
          displayName: "Limit Clone",
          audioBytesBase64: Buffer.from("voice-bytes").toString("base64"),
          audioMimeType: "audio/mpeg"
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = error.getResponse() as { error?: { code?: string } };
        assert.equal(body.error?.code, "heygen_voice_clone_limit_reached");
        return true;
      }
    );

    const planUpgradeService = new ProviderHeyGenVoicesService(
      {
        async createVoiceClone() {
          throw new HeyGenProviderClientError(
            "Please upgrade your HeyGen plan",
            403,
            "Please upgrade your HeyGen plan",
            "plan_upgrade_required"
          );
        }
      } as never,
      {
        async resolveSecretValue() {
          return MOCK_HEYGEN_API_KEY;
        }
      } as never
    );
    await assert.rejects(
      () =>
        planUpgradeService.createVoiceClone({
          schema: "persai.providerGatewayHeyGenCreateVoiceCloneRequest.v1",
          credential: {
            secretId: "tool/video_generate/heygen/api-key",
            providerId: "heygen"
          },
          displayName: "Upgrade Clone",
          audioBytesBase64: Buffer.from("voice-bytes").toString("base64"),
          audioMimeType: "audio/mpeg"
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = error.getResponse() as { error?: { code?: string } };
        assert.equal(body.error?.code, "heygen_voice_clone_plan_upgrade_required");
        return true;
      }
    );
    console.log("✓ Test 16: provider voice service maps stable limit/plan-upgrade errors");
  }

  console.log("\n✅ All HeyGen provider client tests passed.");
}

if (process.argv[1] !== undefined && process.argv[1].includes("heygen-provider.client.test")) {
  runHeyGenProviderClientTest().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
