import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  AssistantBrowserProfileStatus,
  PersaiRuntimeBrowserProfileErrorReason,
  RuntimeBrowserLoginResult,
  RuntimeBrowserProfileListItem
} from "@persai/runtime-contract";
import {
  ASSISTANT_BROWSER_PROFILE_REPOSITORY,
  type AssistantBrowserProfileRepository,
  type AssistantBrowserProfileRow
} from "../domain/assistant-browser-profile.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { BROWSERLESS_SESSION_PORT, type BrowserlessSessionPort } from "./browserless-session.port";
import {
  ensureBrowserProfileKeyUnique,
  generateBrowserProfileKeyBase,
  parseBrowserLoginOriginHost
} from "./browser-profile-key";
import { resolveBrowserProfileTtlDays } from "./resolve-browser-profile-ttl-days";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import { resolveBrowserToolCredentialSecretId } from "./tool-credential-settings";

export type AssistantBrowserProfileSettingsItem = {
  id: string;
  profileKey: string;
  displayName: string;
  loginUrl: string;
  originHost: string;
  status: AssistantBrowserProfileStatus;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type ResolveBrowserProfileForToolResult =
  | { ok: true; providerSessionId: string; profileId: string }
  | { ok: false; reason: PersaiRuntimeBrowserProfileErrorReason };

@Injectable()
export class AssistantBrowserProfileService {
  constructor(
    @Inject(ASSISTANT_BROWSER_PROFILE_REPOSITORY)
    private readonly repository: AssistantBrowserProfileRepository,
    @Inject(BROWSERLESS_SESSION_PORT)
    private readonly browserlessSessionPort: BrowserlessSessionPort,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService
  ) {}

  async listProfiles(
    assistantId: string,
    workspaceId: string
  ): Promise<{ profiles: AssistantBrowserProfileSettingsItem[] }> {
    await this.assertAssistantInWorkspace(assistantId, workspaceId);
    const rows = await this.repository.listByAssistant(assistantId);
    return {
      profiles: rows.map((row) => this.toSettingsItem(row))
    };
  }

  async listProfilesForRuntime(assistantId: string): Promise<RuntimeBrowserProfileListItem[]> {
    const rows = await this.repository.listByAssistant(assistantId);
    return rows.map((row) => this.toRuntimeListItem(row));
  }

  async startLogin(input: {
    assistantId: string;
    workspaceId: string;
    displayName: string;
    loginUrl: string;
    browserCredentialSecretId?: string;
    originatingChatId?: string | null;
  }): Promise<RuntimeBrowserLoginResult & { profileId: string }> {
    await this.assertAssistantInWorkspace(input.assistantId, input.workspaceId);
    const displayName = this.requireNonEmptyString(input.displayName, "displayName");
    const loginUrl = this.requireNonEmptyString(input.loginUrl, "loginUrl");
    let originHost: string;
    try {
      originHost = parseBrowserLoginOriginHost(loginUrl);
    } catch {
      throw new BadRequestException("loginUrl must be a valid http(s) URL with a hostname.");
    }

    await this.cleanupStalePendingProfiles(
      input.assistantId,
      input.browserCredentialSecretId ?? resolveBrowserToolCredentialSecretId()
    );

    const baseKey = generateBrowserProfileKeyBase(displayName, input.assistantId);
    const existingKeys = await this.repository.listProfileKeysWithPrefix(
      input.assistantId,
      baseKey
    );
    const profileKey = ensureBrowserProfileKeyUnique(existingKeys, baseKey);

    const reconnectTimeoutMs = await this.resolveReconnectTimeoutMsForAssistant(input.assistantId);
    const session = await this.browserlessSessionPort.startLogin({
      loginUrl,
      profileKey,
      reconnectTimeoutMs,
      ...(input.browserCredentialSecretId !== undefined
        ? { browserCredentialSecretId: input.browserCredentialSecretId }
        : {})
    });
    const row = await this.repository.create({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      profileKey,
      displayName,
      loginUrl,
      originHost,
      providerSessionId: session.providerSessionId,
      liveUrl: session.liveUrl,
      originatingChatId: input.originatingChatId ?? null,
      status: "pending_login"
    });

    return {
      profileId: row.id,
      profileKey: row.profileKey,
      displayName: row.displayName,
      liveUrl: session.liveUrl,
      loginUrl: row.loginUrl,
      status: row.status
    };
  }

  async completeLogin(input: {
    profileId: string;
    assistantId: string;
    workspaceId: string;
    browserCredentialSecretId?: string;
  }): Promise<{ profile: AssistantBrowserProfileSettingsItem }> {
    const row = await this.requireOwnedProfile(
      input.profileId,
      input.assistantId,
      input.workspaceId
    );
    if (row.status === "expired") {
      throw new ConflictException("Browser profile session has expired. Start login again.");
    }
    if (row.status === "active") {
      return { profile: this.toSettingsItem(row) };
    }
    if (row.status !== "pending_login") {
      throw new ConflictException("Browser profile is not awaiting login completion.");
    }

    const browserCredentialSecretId =
      input.browserCredentialSecretId ?? resolveBrowserToolCredentialSecretId();
    try {
      await this.browserlessSessionPort.verifySession({
        providerSessionId: row.providerSessionId,
        browserCredentialSecretId
      });
    } catch {
      throw new ConflictException(
        "Browser session is not reachable. Finish login in the browser window and try again."
      );
    }

    const ttlDays = await this.resolveTtlDaysForAssistant(input.assistantId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
    await this.repository.updateStatus(row.id, "active");
    await this.repository.touch(row.id, now, expiresAt);
    await this.repository.clearLiveUrl(row.id);
    const updated = await this.repository.findById(row.id);
    if (updated === null) {
      throw new NotFoundException("Browser profile was not found.");
    }
    return { profile: this.toSettingsItem(updated) };
  }

  async resolveProfileForTool(input: {
    assistantId: string;
    profileKey: string;
  }): Promise<ResolveBrowserProfileForToolResult> {
    const profileKey = this.requireNonEmptyString(input.profileKey, "profileKey");
    const row = await this.repository.findByAssistantAndKey(input.assistantId, profileKey);
    if (row === null) {
      return { ok: false, reason: "browser_profile_not_found" };
    }
    if (row.status === "expired") {
      return { ok: false, reason: "browser_profile_expired" };
    }
    if (row.status === "pending_login") {
      return { ok: false, reason: "browser_profile_pending_login" };
    }
    if (row.status !== "active") {
      return { ok: false, reason: "browser_profile_not_found" };
    }
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
      await this.repository.markExpired(row.id);
      return { ok: false, reason: "browser_profile_expired" };
    }
    return {
      ok: true,
      providerSessionId: row.providerSessionId,
      profileId: row.id
    };
  }

  async reconnectLogin(input: {
    profileId: string;
    assistantId: string;
    workspaceId: string;
    browserCredentialSecretId?: string;
  }): Promise<RuntimeBrowserLoginResult & { profileId: string }> {
    const row = await this.requireOwnedProfile(
      input.profileId,
      input.assistantId,
      input.workspaceId
    );
    const browserCredentialSecretId =
      input.browserCredentialSecretId ?? resolveBrowserToolCredentialSecretId();
    try {
      await this.browserlessSessionPort.deleteSession(row.providerSessionId, {
        browserCredentialSecretId
      });
    } catch {
      // Best-effort cleanup before opening a fresh live session.
    }
    const reconnectTimeoutMs = await this.resolveReconnectTimeoutMsForAssistant(input.assistantId);
    const session = await this.browserlessSessionPort.startLogin({
      loginUrl: row.loginUrl,
      profileKey: row.profileKey,
      reconnectTimeoutMs,
      browserCredentialSecretId
    });
    await this.repository.updatePendingLoginSession(row.id, {
      providerSessionId: session.providerSessionId,
      liveUrl: session.liveUrl
    });
    return {
      profileId: row.id,
      profileKey: row.profileKey,
      displayName: row.displayName,
      liveUrl: session.liveUrl,
      loginUrl: row.loginUrl,
      status: "pending_login"
    };
  }

  async deleteProfile(input: {
    profileId: string;
    assistantId: string;
    workspaceId: string;
    browserCredentialSecretId?: string;
  }): Promise<{ deleted: true }> {
    const row = await this.requireOwnedProfile(
      input.profileId,
      input.assistantId,
      input.workspaceId
    );
    const deleted = await this.repository.deleteById(row.id);
    if (!deleted) {
      throw new NotFoundException("Browser profile was not found.");
    }
    const browserCredentialSecretId =
      input.browserCredentialSecretId ?? resolveBrowserToolCredentialSecretId();
    try {
      await this.browserlessSessionPort.deleteSession(row.providerSessionId, {
        browserCredentialSecretId
      });
    } catch {
      // Best-effort provider cleanup; row is already removed.
    }
    return { deleted: true };
  }

  async touchProfile(input: {
    assistantId: string;
    workspaceId: string;
    profileKey: string;
  }): Promise<void> {
    const profileKey = this.requireNonEmptyString(input.profileKey, "profileKey");
    const row = await this.repository.findByAssistantAndKey(input.assistantId, profileKey);
    if (row === null || row.workspaceId !== input.workspaceId || row.status !== "active") {
      return;
    }
    const ttlDays = await this.resolveTtlDaysForAssistant(input.assistantId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
    await this.repository.touch(row.id, now, expiresAt);
  }

  private async cleanupStalePendingProfiles(
    assistantId: string,
    browserCredentialSecretId: string
  ): Promise<void> {
    const rows = await this.repository.listByAssistant(assistantId);
    for (const row of rows) {
      if (row.status !== "pending_login") {
        continue;
      }
      try {
        await this.browserlessSessionPort.deleteSession(row.providerSessionId, {
          browserCredentialSecretId
        });
      } catch {
        // Best-effort provider cleanup before removing stale pending rows.
      }
      await this.repository.deleteById(row.id);
    }
  }

  private async requireOwnedProfile(
    profileId: string,
    assistantId: string,
    workspaceId: string
  ): Promise<AssistantBrowserProfileRow> {
    await this.assertAssistantInWorkspace(assistantId, workspaceId);
    const row = await this.repository.findById(profileId);
    if (row === null || row.assistantId !== assistantId || row.workspaceId !== workspaceId) {
      throw new NotFoundException("Browser profile was not found.");
    }
    return row;
  }

  private async assertAssistantInWorkspace(
    assistantId: string,
    workspaceId: string
  ): Promise<void> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: assistantId },
      select: { id: true, workspaceId: true }
    });
    if (assistant === null || assistant.workspaceId !== workspaceId) {
      throw new NotFoundException("Assistant does not exist for this workspace.");
    }
  }

  private async resolveReconnectTimeoutMsForAssistant(assistantId: string): Promise<number> {
    const ttlDays = await this.resolveTtlDaysForAssistant(assistantId);
    return ttlDays * 24 * 60 * 60 * 1000;
  }

  private async resolveTtlDaysForAssistant(assistantId: string): Promise<number> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: assistantId },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        governance: {
          select: {
            assistantPlanOverrideCode: true,
            quotaPlanCode: true
          }
        }
      }
    });
    if (assistant === null) {
      return resolveBrowserProfileTtlDays(null);
    }
    const subscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      assistantPlanOverrideCode: assistant.governance?.assistantPlanOverrideCode ?? null,
      assistantQuotaPlanCode: assistant.governance?.quotaPlanCode ?? null
    });
    if (subscription.planCode === null) {
      return resolveBrowserProfileTtlDays(null);
    }
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: subscription.planCode },
      select: { billingProviderHints: true }
    });
    const billingProviderHints = plan?.billingProviderHints ?? null;
    const hints =
      billingProviderHints !== null &&
      typeof billingProviderHints === "object" &&
      !Array.isArray(billingProviderHints)
        ? (billingProviderHints as Record<string, unknown>)
        : null;
    return resolveBrowserProfileTtlDays({
      browserProfileTtlDays:
        typeof hints?.browserProfileTtlDays === "number" ? hints.browserProfileTtlDays : null
    });
  }

  private toSettingsItem(row: AssistantBrowserProfileRow): AssistantBrowserProfileSettingsItem {
    return {
      id: row.id,
      profileKey: row.profileKey,
      displayName: row.displayName,
      loginUrl: row.loginUrl,
      originHost: row.originHost,
      status: row.status,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    };
  }

  private toRuntimeListItem(row: AssistantBrowserProfileRow): RuntimeBrowserProfileListItem {
    return {
      profileKey: row.profileKey,
      displayName: row.displayName,
      status: row.status,
      originHost: row.originHost,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null
    };
  }

  private requireNonEmptyString(value: string, label: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(`${label} must be a non-empty string.`);
    }
    return trimmed;
  }
}
