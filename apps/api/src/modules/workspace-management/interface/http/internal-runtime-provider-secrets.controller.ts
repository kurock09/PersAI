import { BadRequestException, Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { PlatformRuntimeProviderSecretStoreService } from "../../application/platform-runtime-provider-secret-store.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

type ResolveRuntimeProviderSecretsRequest = {
  protocolVersion: 1;
  ids: string[];
};

function parseResolveInput(body: unknown): ResolveRuntimeProviderSecretsRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("Request body must be an object.");
  }
  const row = body as Record<string, unknown>;
  if (row.protocolVersion !== 1) {
    throw new BadRequestException("protocolVersion must be 1.");
  }
  if (!Array.isArray(row.ids) || row.ids.length === 0 || row.ids.length > 128) {
    throw new BadRequestException("ids must be a non-empty array with at most 128 entries.");
  }
  const ids = row.ids.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new BadRequestException(`ids[${String(index)}] must be a non-empty string.`);
    }
    return entry.trim();
  });
  return {
    protocolVersion: 1,
    ids
  };
}

@Controller("api/v1/internal/runtime/provider-secrets")
export class InternalRuntimeProviderSecretsController {
  constructor(
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  @HttpCode(200)
  @Post("resolve")
  async resolveSecrets(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    protocolVersion: 1;
    values: Record<string, string>;
    errors?: Record<string, { message: string }>;
  }> {
    this.assertAuthorized(req);
    const input = parseResolveInput(body);
    const values: Record<string, string> = {};
    const errors: Record<string, { message: string }> = {};

    for (const id of input.ids) {
      try {
        values[id] =
          await this.platformRuntimeProviderSecretStoreService.resolveSecretValueById(id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : `Could not resolve runtime secret "${id}".`;
        errors[id] = { message };
      }
    }

    return Object.keys(errors).length > 0
      ? {
          protocolVersion: 1,
          values,
          errors
        }
      : {
          protocolVersion: 1,
          values
        };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured before internal runtime secret resolution can be used.",
      "Internal runtime secret resolver authorization failed."
    );
  }
}
