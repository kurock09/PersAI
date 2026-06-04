/**
 * ADR-109 Slice 5b (E12) — unit tests for ProviderHeyGenAvatarsService.
 *
 * All external dependencies are stubbed. No real network or HeyGen calls.
 *
 * Coverage:
 *  1. Happy path — dispatch reaches HeyGenProviderClient.createPhotoAvatar, returns result
 *  2. normalizeInput rejects non-heygen providerId with 400
 *  3. normalizeInput rejects missing portraitImageBytesBase64 with 400
 *  4. normalizeInput rejects missing name with 400
 *  5. Secret resolution failure propagates as ServiceUnavailableException
 *  6. HeyGen client error wraps as ServiceUnavailableException(heygen_avatar_create_failed)
 */

import assert from "node:assert/strict";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import type { ProviderGatewayHeyGenCreatePhotoAvatarRequest } from "@persai/runtime-contract";
import { ProviderHeyGenAvatarsService } from "../src/modules/providers/provider-heygen-avatars.service";
import type { HeyGenProviderClient } from "../src/modules/providers/heygen/heygen-provider.client";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";

const MOCK_AVATAR_ID = "ava-svc-test-1";
const MOCK_CREDENTIAL_VALUE = "hg-real-api-key-from-internal";

function makeValidRequest(
  overrides: Partial<ProviderGatewayHeyGenCreatePhotoAvatarRequest> = {}
): ProviderGatewayHeyGenCreatePhotoAvatarRequest {
  return {
    schema: "persai.providerGatewayHeyGenCreatePhotoAvatarRequest.v1",
    credential: { secretId: "tool/video_generate/heygen/api-key", providerId: "heygen" },
    name: "Test Persona",
    portraitImageBytesBase64: Buffer.from("portrait-data").toString("base64"),
    portraitImageMimeType: "image/jpeg",
    ...overrides
  };
}

function makeHeyGenClient(opts: {
  avatarId?: string;
  failWith?: Error;
  callArgs?: Array<{ name: string; credentialValue: string }>;
}): HeyGenProviderClient {
  return {
    async createPhotoAvatar(
      input: { name: string; portraitImageBytesBase64: string; portraitImageMimeType: string },
      options: { credentialValue: string }
    ) {
      if (opts.callArgs !== undefined) {
        opts.callArgs.push({ name: input.name, credentialValue: options.credentialValue });
      }
      if (opts.failWith !== undefined) {
        throw opts.failWith;
      }
      return { avatarId: opts.avatarId ?? MOCK_AVATAR_ID };
    }
  } as unknown as HeyGenProviderClient;
}

function makeInternalApiClient(opts: {
  resolvedValue?: string;
  failWith?: Error;
}): PersaiInternalApiClientService {
  return {
    async resolveSecretValue(secretId: string): Promise<string> {
      void secretId;
      if (opts.failWith !== undefined) {
        throw opts.failWith;
      }
      return opts.resolvedValue ?? MOCK_CREDENTIAL_VALUE;
    }
  } as unknown as PersaiInternalApiClientService;
}

async function run(): Promise<void> {
  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: Happy path — dispatch reaches client, result returned
  // ──────────────────────────────────────────────────────────────────────────
  {
    const callArgs: Array<{ name: string; credentialValue: string }> = [];
    const heygenClient = makeHeyGenClient({ callArgs, avatarId: MOCK_AVATAR_ID });
    const internalApiClient = makeInternalApiClient({ resolvedValue: MOCK_CREDENTIAL_VALUE });

    const service = new ProviderHeyGenAvatarsService(heygenClient, internalApiClient);
    const result = await service.createPhotoAvatar(makeValidRequest());

    assert.equal(result.schema, "persai.providerGatewayHeyGenCreatePhotoAvatarResult.v1");
    assert.equal(result.provider, "heygen");
    assert.equal(result.avatarId, MOCK_AVATAR_ID);
    assert.ok(typeof result.respondedAt === "string" && result.respondedAt.length > 0);

    // Verify the credential was resolved and passed to the HeyGen client
    assert.equal(callArgs.length, 1);
    assert.equal(callArgs[0]!["name"], "Test Persona");
    assert.equal(callArgs[0]!["credentialValue"], MOCK_CREDENTIAL_VALUE);

    console.log("✓ Test 1: happy path — dispatch reaches client, result returned");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: normalizeInput rejects non-heygen providerId with 400
  // ──────────────────────────────────────────────────────────────────────────
  {
    const service = new ProviderHeyGenAvatarsService(
      makeHeyGenClient({}),
      makeInternalApiClient({})
    );

    await assert.rejects(
      () =>
        service.createPhotoAvatar({
          ...makeValidRequest(),
          credential: {
            secretId: "tool/video_generate/heygen/api-key",
            providerId: "openai" as "heygen"
          }
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      }
    );
    console.log("✓ Test 2: non-heygen providerId → BadRequestException");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: normalizeInput rejects missing portraitImageBytesBase64 with 400
  // ──────────────────────────────────────────────────────────────────────────
  {
    const service = new ProviderHeyGenAvatarsService(
      makeHeyGenClient({}),
      makeInternalApiClient({})
    );

    await assert.rejects(
      () =>
        service.createPhotoAvatar({
          ...makeValidRequest(),
          portraitImageBytesBase64: ""
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      }
    );
    console.log("✓ Test 3: empty portraitImageBytesBase64 → BadRequestException");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: normalizeInput rejects missing name with 400
  // ──────────────────────────────────────────────────────────────────────────
  {
    const service = new ProviderHeyGenAvatarsService(
      makeHeyGenClient({}),
      makeInternalApiClient({})
    );

    await assert.rejects(
      () =>
        service.createPhotoAvatar({
          ...makeValidRequest(),
          name: "   "
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      }
    );
    console.log("✓ Test 4: empty name → BadRequestException");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5: Secret resolution failure propagates as ServiceUnavailableException
  // ──────────────────────────────────────────────────────────────────────────
  {
    const service = new ProviderHeyGenAvatarsService(
      makeHeyGenClient({}),
      makeInternalApiClient({
        failWith: new ServiceUnavailableException("Internal API unreachable")
      })
    );

    await assert.rejects(
      () => service.createPhotoAvatar(makeValidRequest()),
      (err: Error) => {
        assert.ok(err instanceof ServiceUnavailableException);
        return true;
      }
    );
    console.log("✓ Test 5: secret resolution failure → ServiceUnavailableException");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6: HeyGen client error wraps as ServiceUnavailableException
  // ──────────────────────────────────────────────────────────────────────────
  {
    const service = new ProviderHeyGenAvatarsService(
      makeHeyGenClient({
        failWith: new Error("HeyGen avatar creation returned a response missing avatar_item.id.")
      }),
      makeInternalApiClient({})
    );

    await assert.rejects(
      () => service.createPhotoAvatar(makeValidRequest()),
      (err: Error) => {
        assert.ok(err instanceof ServiceUnavailableException);
        const body = (err as ServiceUnavailableException).getResponse() as Record<string, unknown>;
        const error = body["error"] as Record<string, unknown>;
        assert.equal(error["code"], "heygen_avatar_create_failed");
        return true;
      }
    );
    console.log(
      "✓ Test 6: HeyGen client error → ServiceUnavailableException(heygen_avatar_create_failed)"
    );
  }

  console.log("\nprovider-heygen-avatars.service: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
