import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { RequestContextStore } from "../../../platform-core/infrastructure/request-context/request-context.store";
import {
  NextRequestFunction,
  RequestResolvedAppUser,
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "../../../platform-core/interface/http/request-http.types";
import {
  isOperatorApiAuthConfigured,
  readOperatorApiAuthFromEnv,
  verifyOperatorApiToken
} from "../../application/operator-api-auth";
import { ResolveAppUserService } from "../../application/resolve-app-user.service";
import { ResolveOperatorActorService } from "../../application/resolve-operator-actor.service";
import { ClerkAuthService } from "../../infrastructure/identity/clerk-auth.service";
import type { ResolvedAppUser } from "../../application/resolved-auth-user.types";

const BEARER_PREFIX = "Bearer ";

function toAuthorizationHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === "string" ? value : null;
}

@Injectable()
export class ClerkAuthMiddleware implements NestMiddleware {
  constructor(
    private readonly clerkAuthService: ClerkAuthService,
    private readonly resolveAppUserService: ResolveAppUserService,
    private readonly resolveOperatorActorService: ResolveOperatorActorService,
    private readonly requestContextStore: RequestContextStore
  ) {}

  async use(
    req: RequestWithPlatformContext,
    _res: ResponseWithPlatformContext,
    next: NextRequestFunction
  ): Promise<void> {
    const authorizationHeader = toAuthorizationHeader(req.headers.authorization);
    if (authorizationHeader === null || !authorizationHeader.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException("Missing Authorization bearer token.");
    }

    const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
    const operatorConfig = readOperatorApiAuthFromEnv(process.env);

    if (isOperatorApiAuthConfigured(operatorConfig)) {
      const configuredOperatorToken = operatorConfig.PERSAI_OPERATOR_TOKEN?.trim() ?? "";
      const configuredInternalToken = process.env.PERSAI_INTERNAL_API_TOKEN?.trim() ?? "";
      if (
        configuredInternalToken.length > 0 &&
        verifyOperatorApiToken(configuredOperatorToken, configuredInternalToken)
      ) {
        throw new UnauthorizedException(
          "Operator API token must not match PERSAI_INTERNAL_API_TOKEN."
        );
      }
      if (verifyOperatorApiToken(token, configuredOperatorToken)) {
        const resolvedAppUser = await this.resolveOperatorActorService.resolveActorUser();
        this.attachResolvedUser(req, resolvedAppUser);
        next();
        return;
      }
    }

    const authenticatedUser = await this.clerkAuthService.resolveAuthenticatedUser(token);
    const resolvedAppUser = await this.resolveAppUserService.resolveOrCreate(authenticatedUser);
    this.attachResolvedUser(req, resolvedAppUser);
    next();
  }

  private attachResolvedUser(
    req: RequestWithPlatformContext,
    resolvedAppUser: ResolvedAppUser
  ): void {
    const requestUser: RequestResolvedAppUser = {
      id: resolvedAppUser.id,
      clerkUserId: resolvedAppUser.clerkUserId,
      email: resolvedAppUser.email,
      displayName: resolvedAppUser.displayName,
      birthday: resolvedAppUser.birthday,
      gender: resolvedAppUser.gender,
      preferredLocale: resolvedAppUser.preferredLocale,
      countryCode: resolvedAppUser.countryCode
    };

    req.userId = requestUser.id;
    req.resolvedAppUser = requestUser;

    const requestContext = this.requestContextStore.get();
    if (requestContext !== undefined) {
      requestContext.userId = requestUser.id;
    }
  }
}
