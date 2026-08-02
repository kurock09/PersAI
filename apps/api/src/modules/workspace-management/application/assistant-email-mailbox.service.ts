import { createHash, randomBytes } from "node:crypto";
import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { WorkspaceEmailMailboxStatus } from "@prisma/client";
import { ApiErrorHttpException } from "../../platform-core/interface/http/api-error";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import {
  MAILBOX_OAUTH_PROVIDERS,
  isMailboxOAuthProviderId,
  type MailboxOAuthProviderId
} from "./mailbox-oauth-provider-registry";
import { resolveMailboxOAuthCallbackRedirectUri } from "./mailbox-oauth-redirect";

const STATE_BYTES = 32;
const STATE_TTL_MS = 10 * 60 * 1000;
const CREDENTIALS_UNAVAILABLE_REASON = "mailbox_oauth_credentials_unavailable";
const REDIRECT_URI_UNAVAILABLE_REASON = "mailbox_oauth_redirect_uri_unavailable";

export function mailboxOAuthSecretProviderKey(workspaceId: string): string {
  return `mailbox_oauth:${workspaceId}`;
}

export type WorkspaceEmailMailboxStateView = {
  provider: MailboxOAuthProviderId;
  email: string;
  displayName: string | null;
  status: WorkspaceEmailMailboxStatus;
  connectedAt: string;
  lastErrorReason: string | null;
};

export type ConnectMailboxOAuthInput = { provider: MailboxOAuthProviderId };

/**
 * ADR-169 S2 — the three authenticated mailbox-connection endpoints: read
 * current state, initiate the OAuth connect redirect, and disconnect.
 * Everything for the unauthenticated provider callback lives in
 * `HandleMailboxOAuthCallbackService` instead — it has no session to resolve
 * a workspace from.
 */
@Injectable()
export class AssistantEmailMailboxService {
  private readonly logger = new Logger(AssistantEmailMailboxService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly secretStore: PlatformRuntimeProviderSecretStoreService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseConnectInput(body: unknown): ConnectMailboxOAuthInput {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
        code: "mailbox_oauth_invalid_body",
        category: "validation",
        message: "Request body must be an object."
      });
    }
    const providerRaw = (body as Record<string, unknown>)["provider"];
    if (typeof providerRaw !== "string" || !isMailboxOAuthProviderId(providerRaw)) {
      throw new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
        code: "mailbox_oauth_invalid_provider",
        category: "validation",
        message: "provider must be one of: mailru, yandex."
      });
    }
    return { provider: providerRaw };
  }

  async readMailbox(workspaceId: string): Promise<WorkspaceEmailMailboxStateView | null> {
    const row = await this.prisma.workspaceEmailSenderIdentity.findUnique({
      where: { workspaceId }
    });
    if (row === null || row.provider === null || row.mailboxStatus === null) {
      return null;
    }
    return {
      provider: row.provider as MailboxOAuthProviderId,
      email: row.email,
      displayName: row.displayName,
      status: row.mailboxStatus,
      connectedAt: (row.connectedAt ?? row.updatedAt).toISOString(),
      lastErrorReason: row.lastErrorReason
    };
  }

  async initiateConnect(
    workspaceId: string,
    input: ConnectMailboxOAuthInput
  ): Promise<{ authorizationUrl: string }> {
    const providerConfig = MAILBOX_OAUTH_PROVIDERS[input.provider];

    const [clientId] = await this.resolveProviderCredentials(providerConfig.id);
    const redirectUri = resolveMailboxOAuthCallbackRedirectUri();
    if (redirectUri === null) {
      throw new ApiErrorHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
        code: REDIRECT_URI_UNAVAILABLE_REASON,
        category: "infra",
        message:
          "The mailbox OAuth callback base URL is not configured. Configure PERSAI_PUBLIC_API_BASE_URL before connecting a mailbox."
      });
    }

    const state = randomBytes(STATE_BYTES).toString("base64url");
    const stateHash = createHash("sha256").update(state).digest("hex");

    // Opportunistic bounded cleanup, no scheduler: every connect attempt is
    // a natural, infrequent trigger to drop this workspace's own
    // consumed/expired states before the table grows unbounded.
    await this.prisma.workspaceEmailOAuthState.deleteMany({
      where: {
        workspaceId,
        OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: new Date() } }]
      }
    });

    await this.prisma.workspaceEmailOAuthState.create({
      data: {
        workspaceId,
        provider: providerConfig.id,
        stateHash,
        expiresAt: new Date(Date.now() + STATE_TTL_MS)
      }
    });

    const authorizationUrl = new URL(providerConfig.authorizationEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set(
      "scope",
      providerConfig.scopes.join(providerConfig.scopeDelimiter)
    );
    authorizationUrl.searchParams.set("state", state);

    return { authorizationUrl: authorizationUrl.toString() };
  }

  async disconnect(workspaceId: string, actorUserId: string): Promise<{ removed: boolean }> {
    const existing = await this.prisma.workspaceEmailSenderIdentity.findUnique({
      where: { workspaceId }
    });
    if (existing === null || existing.mailboxStatus === null) {
      return { removed: false };
    }

    await this.secretStore
      .deleteProviderKey(mailboxOAuthSecretProviderKey(workspaceId))
      .catch((error: unknown) => {
        this.logger.warn({
          event: "email_mailbox.disconnect_secret_delete_failed",
          workspaceId,
          message: error instanceof Error ? error.message : String(error)
        });
      });

    await this.prisma.workspaceEmailSenderIdentity.update({
      where: { workspaceId },
      data: {
        provider: null,
        mailboxStatus: null,
        tokenExpiresAt: null,
        connectedAt: null
      }
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId,
      assistantId: null,
      actorUserId,
      eventCategory: "secret_change",
      eventCode: "workspace.email_mailbox_disconnected",
      summary: "Workspace disconnected its connected mailbox for assistant email sending.",
      details: { provider: existing.provider }
    });

    return { removed: true };
  }

  /** Fail-closed per ADR-168's missing-token shape: no client id/secret, no OAuth call. */
  private async resolveProviderCredentials(
    provider: MailboxOAuthProviderId
  ): Promise<[string, string]> {
    const config = MAILBOX_OAUTH_PROVIDERS[provider];
    try {
      const clientId = await this.secretStore.resolveSecretValueById(config.clientIdSecretId);
      const clientSecret = await this.secretStore.resolveSecretValueById(
        config.clientSecretSecretId
      );
      return [clientId, clientSecret];
    } catch {
      throw new ApiErrorHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
        code: CREDENTIALS_UNAVAILABLE_REASON,
        category: "infra",
        message: `Mailbox OAuth credentials for ${config.label} are not configured. Configure them in Admin > Tools before connecting a mailbox.`
      });
    }
  }
}
