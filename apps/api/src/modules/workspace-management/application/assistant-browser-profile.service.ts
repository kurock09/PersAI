import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  AssistantBrowserProfileStatus,
  LocalBrowserBridgeDeviceKind,
  LocalBrowserResult,
  PendingBrowserLoginState,
  PersaiRuntimeBrowserProfileErrorReason,
  RuntimeBrowserLoginResult,
  RuntimeBrowserProfileListItem
} from "@persai/runtime-contract";
import { BrowserBridgeRelayService } from "../../browser-bridge/application/browser-bridge-relay.service";
import {
  ASSISTANT_BROWSER_PROFILE_REPOSITORY,
  type AssistantBrowserProfileRepository,
  type AssistantBrowserProfileRow
} from "../domain/assistant-browser-profile.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  ensureBrowserProfileKeyUnique,
  generateBrowserProfileKeyBase,
  parseBrowserLoginOriginHost
} from "./browser-profile-key";
import { resolveBrowserProfileTtlDays } from "./resolve-browser-profile-ttl-days";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";

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
  | {
      ok: true;
      profileId: string;
      bridgeSessionRef: string;
    }
  | {
      ok: false;
      reason: PersaiRuntimeBrowserProfileErrorReason;
      pendingBrowserLogin?: PendingBrowserLoginState;
    };

const DEFAULT_PENDING_BRIDGE_CLIENT_KIND: LocalBrowserBridgeDeviceKind = "extension";
const BRIDGE_RESULT_POLL_INTERVAL_MS = 500;

@Injectable()
export class AssistantBrowserProfileService {
  constructor(
    @Inject(ASSISTANT_BROWSER_PROFILE_REPOSITORY)
    private readonly repository: AssistantBrowserProfileRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly browserBridgeRelayService: BrowserBridgeRelayService
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
    originatingChatId?: string | null;
    bridgeClientKind?: LocalBrowserBridgeDeviceKind;
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

    const bridgeClientKind = this.resolvePendingBridgeClientKind(input.bridgeClientKind);
    const reusable = await this.repository.findReusableByAssistantAndOriginHost(
      input.assistantId,
      originHost,
      input.originatingChatId ?? null
    );
    if (reusable !== null) {
      await this.cleanupDuplicateProfilesForOriginHost(input.assistantId, originHost, reusable.id);
      return this.startPendingLoginForExistingProfile(reusable, bridgeClientKind);
    }

    await this.cleanupStalePendingProfiles(input.assistantId, input.originatingChatId ?? null);

    const baseKey = generateBrowserProfileKeyBase(displayName, input.assistantId);
    const existingKeys = await this.repository.listProfileKeysWithPrefix(
      input.assistantId,
      baseKey
    );
    const profileKey = ensureBrowserProfileKeyUnique(existingKeys, baseKey);
    const row = await this.repository.create({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      profileKey,
      displayName,
      loginUrl,
      originHost,
      bridgeSessionRef: null,
      bridgeClientKind,
      originatingChatId: input.originatingChatId ?? null,
      status: "pending_login"
    });

    return {
      profileId: row.id,
      profileKey: row.profileKey,
      displayName: row.displayName,
      loginUrl: row.loginUrl,
      workspaceId: row.workspaceId,
      bridgeClientKind,
      status: row.status
    };
  }

  async completeLogin(input: {
    profileId: string;
    assistantId: string;
    workspaceId: string;
  }): Promise<{ profile: AssistantBrowserProfileSettingsItem }> {
    const row = await this.requireOwnedProfile(
      input.profileId,
      input.assistantId,
      input.workspaceId
    );
    if (row.status === "expired") {
      throw new ConflictException("Browser profile session has expired. Start login again.");
    }
    if (row.status === "active" && row.bridgeSessionRef !== null) {
      return { profile: this.toSettingsItem(row) };
    }
    if (row.status !== "pending_login" && row.status !== "active") {
      throw new ConflictException("Browser profile is not awaiting login completion.");
    }

    const bridgeClientKind = this.resolvePendingBridgeClientKind(row.bridgeClientKind);
    const bridgeSessionRef = await this.verifyBridgeLoginSession(row);
    const ttlDays = await this.resolveTtlDaysForAssistant(input.assistantId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
    await this.repository.activate(row.id, {
      bridgeSessionRef,
      bridgeClientKind,
      lastUsedAt: now,
      expiresAt
    });
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
    if (row.status === "pending_login") {
      const pendingBrowserLogin = this.toPendingBrowserLoginStateFromRow(row);
      if (pendingBrowserLogin !== null) {
        return {
          ok: false,
          reason: "browser_profile_pending_login",
          pendingBrowserLogin
        };
      }
      return { ok: false, reason: "browser_profile_pending_login" };
    }
    if (row.status === "expired") {
      return this.reopenExpiredProfile(row);
    }
    if (row.status !== "active") {
      return { ok: false, reason: "browser_profile_not_found" };
    }
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
      await this.repository.markExpired(row.id);
      await this.closeBridgeViewBestEffort(row);
      const expiredRow = (await this.repository.findById(row.id)) ?? {
        ...row,
        status: "expired" as const,
        bridgeSessionRef: null
      };
      return this.reopenExpiredProfile(expiredRow);
    }
    if (row.bridgeSessionRef === null) {
      const restarted = await this.startPendingLoginForExistingProfile(
        row,
        this.resolvePendingBridgeClientKind(row.bridgeClientKind)
      );
      return {
        ok: false,
        reason: "browser_profile_needs_user_reauth",
        pendingBrowserLogin: this.toPendingBrowserLoginState(restarted)
      };
    }
    return {
      ok: true,
      profileId: row.id,
      bridgeSessionRef: row.bridgeSessionRef
    };
  }

  async reconnectLogin(input: {
    profileId: string;
    assistantId: string;
    workspaceId: string;
    bridgeClientKind?: LocalBrowserBridgeDeviceKind;
  }): Promise<RuntimeBrowserLoginResult & { profileId: string }> {
    const row = await this.requireOwnedProfile(
      input.profileId,
      input.assistantId,
      input.workspaceId
    );
    return this.startPendingLoginForExistingProfile(
      row,
      this.resolvePendingBridgeClientKind(input.bridgeClientKind ?? row.bridgeClientKind)
    );
  }

  async openLiveView(input: {
    profileId: string;
    assistantId: string;
    workspaceId: string;
  }): Promise<
    RuntimeBrowserLoginResult & { profileId: string; completionMode: "login" | "assist" }
  > {
    const row = await this.requireOwnedProfile(
      input.profileId,
      input.assistantId,
      input.workspaceId
    );
    if (row.status === "expired") {
      throw new ConflictException("Browser profile session has expired. Start login again.");
    }
    const completionMode = row.status === "active" ? "assist" : "login";
    const opened = await this.dispatchBridgeCommand({
      assistantId: row.assistantId,
      workspaceId: row.workspaceId,
      bridgeDeviceId: row.bridgeSessionRef,
      command: {
        commandId: randomUUID(),
        profileKey: row.profileKey,
        action: "open_view",
        url: row.loginUrl,
        showWindow: true
      },
      unavailableMessage:
        "No local browser bridge is connected for this assistant. Continue in PersAI web/app with the extension or mobile bridge connected.",
      failureMessage:
        "The connected browser bridge could not open the browser view. Reopen the login flow and try again."
    });
    await this.repository.updateBridgeSessionRef(row.id, opened.bridgeSessionRef);
    return {
      profileId: row.id,
      profileKey: row.profileKey,
      displayName: row.displayName,
      loginUrl: row.loginUrl,
      workspaceId: row.workspaceId,
      bridgeClientKind: this.resolvePendingBridgeClientKind(row.bridgeClientKind),
      status: row.status,
      completionMode
    };
  }

  async dismissLiveView(input: {
    profileId: string;
    assistantId: string;
    workspaceId: string;
  }): Promise<{ dismissed: true }> {
    const row = await this.requireOwnedProfile(
      input.profileId,
      input.assistantId,
      input.workspaceId
    );
    await this.closeBridgeViewBestEffort(row);
    return { dismissed: true };
  }

  async deleteProfile(input: {
    profileId: string;
    assistantId: string;
    workspaceId: string;
  }): Promise<{ deleted: true }> {
    const row = await this.requireOwnedProfile(
      input.profileId,
      input.assistantId,
      input.workspaceId
    );
    await this.closeBridgeViewBestEffort(row);
    const deleted = await this.repository.deleteById(row.id);
    if (!deleted) {
      throw new NotFoundException("Browser profile was not found.");
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
    if (
      row === null ||
      row.workspaceId !== input.workspaceId ||
      row.status !== "active" ||
      row.bridgeSessionRef === null
    ) {
      return;
    }
    const ttlDays = await this.resolveTtlDaysForAssistant(input.assistantId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
    await this.repository.touch(row.id, now, expiresAt);
  }

  private async cleanupStalePendingProfiles(
    assistantId: string,
    originatingChatId: string | null
  ): Promise<void> {
    const rows = await this.repository.listByAssistant(assistantId);
    for (const row of rows) {
      if (row.status !== "pending_login") {
        continue;
      }
      if (originatingChatId !== null) {
        if (row.originatingChatId !== originatingChatId) {
          continue;
        }
      } else if (row.originatingChatId !== null) {
        continue;
      }
      await this.closeBridgeViewBestEffort(row);
      await this.repository.deleteById(row.id);
    }
  }

  private async cleanupDuplicateProfilesForOriginHost(
    assistantId: string,
    originHost: string,
    keepProfileId: string
  ): Promise<void> {
    const rows = await this.repository.listByAssistant(assistantId);
    for (const row of rows) {
      if (row.id === keepProfileId || row.originHost !== originHost) {
        continue;
      }
      if (row.status !== "pending_login" && row.status !== "expired") {
        continue;
      }
      await this.closeBridgeViewBestEffort(row);
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

  private async reopenExpiredProfile(
    row: AssistantBrowserProfileRow
  ): Promise<ResolveBrowserProfileForToolResult> {
    const restarted = await this.startPendingLoginForExistingProfile(
      row,
      this.resolvePendingBridgeClientKind(row.bridgeClientKind)
    );
    return {
      ok: false,
      reason: "browser_profile_needs_user_reauth",
      pendingBrowserLogin: this.toPendingBrowserLoginState(restarted)
    };
  }

  private async startPendingLoginForExistingProfile(
    row: AssistantBrowserProfileRow,
    bridgeClientKind: LocalBrowserBridgeDeviceKind
  ): Promise<RuntimeBrowserLoginResult & { profileId: string }> {
    await this.closeBridgeViewBestEffort(row);
    await this.repository.updatePendingLogin(row.id, {
      bridgeSessionRef: null,
      bridgeClientKind
    });
    return {
      profileId: row.id,
      profileKey: row.profileKey,
      displayName: row.displayName,
      loginUrl: row.loginUrl,
      workspaceId: row.workspaceId,
      bridgeClientKind,
      status: "pending_login"
    };
  }

  private toPendingBrowserLoginStateFromRow(
    row: Pick<
      AssistantBrowserProfileRow,
      "id" | "profileKey" | "displayName" | "loginUrl" | "workspaceId" | "bridgeClientKind"
    >
  ): PendingBrowserLoginState | null {
    return {
      profileId: row.id,
      profileKey: row.profileKey,
      displayName: row.displayName,
      loginUrl: row.loginUrl,
      workspaceId: row.workspaceId,
      bridgeClientKind: this.resolvePendingBridgeClientKind(row.bridgeClientKind),
      completionMode: "login"
    };
  }

  private toPendingBrowserLoginState(
    row: RuntimeBrowserLoginResult & { profileId: string }
  ): PendingBrowserLoginState {
    return {
      profileId: row.profileId,
      profileKey: row.profileKey,
      displayName: row.displayName,
      loginUrl: row.loginUrl,
      workspaceId: row.workspaceId,
      bridgeClientKind: row.bridgeClientKind,
      completionMode: "login"
    };
  }

  private requireNonEmptyString(value: string, label: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(`${label} must be a non-empty string.`);
    }
    return trimmed;
  }

  private resolvePendingBridgeClientKind(
    value: LocalBrowserBridgeDeviceKind | null | undefined
  ): LocalBrowserBridgeDeviceKind {
    return value === "extension" || value === "capacitor"
      ? value
      : DEFAULT_PENDING_BRIDGE_CLIENT_KIND;
  }

  private async verifyBridgeLoginSession(row: AssistantBrowserProfileRow): Promise<string> {
    const outcome = await this.dispatchBridgeCommand({
      assistantId: row.assistantId,
      workspaceId: row.workspaceId,
      bridgeDeviceId: row.bridgeSessionRef,
      command: {
        commandId: randomUUID(),
        profileKey: row.profileKey,
        action: "snapshot",
        url: row.loginUrl,
        format: "text",
        optimizeForSpeed: true
      },
      unavailableMessage:
        "No local browser bridge is connected for this assistant. Continue in PersAI web/app with the extension or mobile bridge connected.",
      failureMessage:
        "Browser login is not ready yet on the connected device. Finish the login in the browser window, then press Done again."
    });
    return outcome.bridgeSessionRef;
  }

  private async closeBridgeViewBestEffort(row: AssistantBrowserProfileRow): Promise<void> {
    if (row.bridgeSessionRef === null) {
      return;
    }
    const commandId = randomUUID();
    const outcome = this.browserBridgeRelayService.dispatchCommand({
      assistantId: row.assistantId,
      workspaceId: row.workspaceId,
      bridgeDeviceId: row.bridgeSessionRef,
      command: {
        commandId,
        profileKey: row.profileKey,
        action: "close_view"
      }
    });
    if (outcome.accepted !== true) {
      return;
    }
    await this.pollBridgeCommandResult(commandId).catch(() => undefined);
  }

  private async dispatchBridgeCommand(input: {
    assistantId: string;
    workspaceId: string;
    bridgeDeviceId: string | null;
    command: {
      commandId: string;
      profileKey: string;
      action: "snapshot" | "open_view";
      url?: string;
      format?: "text";
      optimizeForSpeed?: boolean;
      showWindow?: boolean;
    };
    unavailableMessage: string;
    failureMessage: string;
  }): Promise<{ bridgeSessionRef: string; result: LocalBrowserResult }> {
    const dispatched = this.browserBridgeRelayService.dispatchCommand({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      ...(input.bridgeDeviceId === null ? {} : { bridgeDeviceId: input.bridgeDeviceId }),
      command: input.command
    });
    if (dispatched.accepted !== true) {
      throw new ConflictException(input.unavailableMessage);
    }
    const polled = await this.pollBridgeCommandResult(dispatched.commandId);
    if (polled.ok !== true) {
      throw new ConflictException(
        polled.warning?.trim().length ? polled.warning : input.failureMessage
      );
    }
    return {
      bridgeSessionRef: dispatched.bridgeDeviceId,
      result: polled
    };
  }

  private async pollBridgeCommandResult(commandId: string): Promise<LocalBrowserResult> {
    for (;;) {
      const result = this.browserBridgeRelayService.getCommandResult(commandId);
      if (result.status === "completed") {
        return (
          result.result ?? {
            commandId,
            ok: false,
            errorReason: "bridge_command_not_found_or_expired"
          }
        );
      }
      await this.sleep(BRIDGE_RESULT_POLL_INTERVAL_MS);
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
