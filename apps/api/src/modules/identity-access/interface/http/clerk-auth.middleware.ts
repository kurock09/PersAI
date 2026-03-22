import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { RequestContextStore } from "../../../platform-core/infrastructure/request-context/request-context.store";
import {
  NextRequestFunction,
  RequestResolvedAppUser,
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "../../../platform-core/interface/http/request-http.types";
import { ResolveAppUserService } from "../../application/resolve-app-user.service";
import { ClerkAuthService } from "../../infrastructure/identity/clerk-auth.service";

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
    const authenticatedUser = await this.clerkAuthService.resolveAuthenticatedUser(token);
    const resolvedAppUser = await this.resolveAppUserService.resolveOrCreate(authenticatedUser);

    const requestUser: RequestResolvedAppUser = {
      id: resolvedAppUser.id,
      clerkUserId: resolvedAppUser.clerkUserId,
      email: resolvedAppUser.email,
      displayName: resolvedAppUser.displayName
    };

    req.userId = requestUser.id;
    req.resolvedAppUser = requestUser;

    const requestContext = this.requestContextStore.get();
    if (requestContext !== undefined) {
      requestContext.userId = requestUser.id;
    }

    next();
  }
}
