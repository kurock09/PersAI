import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { describe, test } from "node:test";
import type {
  AssistantBrowserProfileStatus,
  LocalBrowserBridgeDeviceKind,
  LocalBrowserResult
} from "@persai/runtime-contract";
import { AssistantBrowserProfileService } from "../src/modules/workspace-management/application/assistant-browser-profile.service";
import {
  DEFAULT_BROWSER_PROFILE_TTL_DAYS,
  resolveBrowserProfileTtlDays
} from "../src/modules/workspace-management/application/resolve-browser-profile-ttl-days";
import {
  ensureBrowserProfileKeyUnique,
  generateBrowserProfileKeyBase
} from "../src/modules/workspace-management/application/browser-profile-key";
import type {
  AssistantBrowserProfileRepository,
  AssistantBrowserProfileRow
} from "../src/modules/workspace-management/domain/assistant-browser-profile.repository";

class InMemoryAssistantBrowserProfileRepository implements AssistantBrowserProfileRepository {
  private rows = new Map<string, AssistantBrowserProfileRow>();
  private nextId = 1;

  seed(
    row: Omit<AssistantBrowserProfileRow, "createdAt" | "updatedAt">
  ): AssistantBrowserProfileRow {
    const now = new Date("2026-07-05T12:00:00.000Z");
    const stored: AssistantBrowserProfileRow = { ...row, createdAt: now, updatedAt: now };
    this.rows.set(stored.id, stored);
    return { ...stored };
  }

  async findByAssistantAndKey(
    assistantId: string,
    profileKey: string
  ): Promise<AssistantBrowserProfileRow | null> {
    for (const row of this.rows.values()) {
      if (row.assistantId === assistantId && row.profileKey === profileKey) {
        return { ...row };
      }
    }
    return null;
  }

  async findById(id: string): Promise<AssistantBrowserProfileRow | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async listByAssistant(assistantId: string): Promise<AssistantBrowserProfileRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.assistantId === assistantId)
      .map((row) => ({ ...row }));
  }

  async listProfileKeysWithPrefix(assistantId: string, prefix: string): Promise<string[]> {
    return [...this.rows.values()]
      .filter((row) => row.assistantId === assistantId && row.profileKey.startsWith(prefix))
      .map((row) => row.profileKey);
  }

  async findMostRecentPendingLogin(): Promise<AssistantBrowserProfileRow | null> {
    return null;
  }

  async findMostRecentPendingLoginForChat(
    assistantId: string,
    chatId: string
  ): Promise<AssistantBrowserProfileRow | null> {
    const row = [...this.rows.values()]
      .filter(
        (candidate) =>
          candidate.assistantId === assistantId &&
          candidate.originatingChatId === chatId &&
          candidate.status === "pending_login"
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
    return row ? { ...row } : null;
  }

  async findReusableByAssistantAndOriginHost(
    assistantId: string,
    originHost: string,
    originatingChatId?: string | null
  ): Promise<AssistantBrowserProfileRow | null> {
    const active = [...this.rows.values()]
      .filter(
        (row) =>
          row.assistantId === assistantId &&
          row.originHost === originHost &&
          row.status === "active"
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
    if (active !== undefined) {
      return { ...active };
    }
    const pending = [...this.rows.values()]
      .filter(
        (row) =>
          row.assistantId === assistantId &&
          row.originHost === originHost &&
          row.status === "pending_login" &&
          (originatingChatId === undefined ||
            originatingChatId === null ||
            row.originatingChatId === originatingChatId)
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
    return pending ? { ...pending } : null;
  }

  async create(input: {
    assistantId: string;
    workspaceId: string;
    profileKey: string;
    displayName: string;
    loginUrl: string;
    originHost: string;
    bridgeSessionRef?: string | null;
    bridgeClientKind?: LocalBrowserBridgeDeviceKind | null;
    originatingChatId?: string | null;
    status: AssistantBrowserProfileStatus;
  }): Promise<AssistantBrowserProfileRow> {
    const now = new Date("2026-07-05T12:00:00.000Z");
    const row: AssistantBrowserProfileRow = {
      id: `profile-${this.nextId++}`,
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      profileKey: input.profileKey,
      displayName: input.displayName,
      loginUrl: input.loginUrl,
      originHost: input.originHost,
      bridgeSessionRef: input.bridgeSessionRef ?? null,
      bridgeClientKind: input.bridgeClientKind ?? null,
      originatingChatId: input.originatingChatId ?? null,
      status: input.status,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async updateStatus(id: string, status: AssistantBrowserProfileStatus): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.status = status;
    }
  }

  async updatePendingLogin(
    id: string,
    input: { bridgeSessionRef: string | null; bridgeClientKind: LocalBrowserBridgeDeviceKind }
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.status = "pending_login";
      row.bridgeSessionRef = input.bridgeSessionRef;
      row.bridgeClientKind = input.bridgeClientKind;
    }
  }

  async activate(
    id: string,
    input: {
      bridgeSessionRef: string;
      bridgeClientKind: LocalBrowserBridgeDeviceKind;
      lastUsedAt: Date;
      expiresAt: Date;
    }
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.status = "active";
      row.bridgeSessionRef = input.bridgeSessionRef;
      row.bridgeClientKind = input.bridgeClientKind;
      row.lastUsedAt = input.lastUsedAt;
      row.expiresAt = input.expiresAt;
    }
  }

  async updateBridgeSessionRef(id: string, bridgeSessionRef: string | null): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.bridgeSessionRef = bridgeSessionRef;
    }
  }

  async touch(id: string, lastUsedAt: Date, expiresAt: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.lastUsedAt = lastUsedAt;
      row.expiresAt = expiresAt;
    }
  }

  async markExpired(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.status = "expired";
      row.bridgeSessionRef = null;
    }
  }

  async deleteById(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  async claimExpiredProfiles(): Promise<AssistantBrowserProfileRow[]> {
    return [];
  }
}

class FakeBrowserBridgeRelayService {
  readonly dispatches: Array<{
    assistantId: string;
    workspaceId: string;
    bridgeDeviceId?: string | null;
    command: { commandId: string; profileKey: string; action: string; url?: string };
  }> = [];
  nextAccepted = true;
  nextBridgeDeviceId = "bridge-device-1";
  nextUnavailableCode = "bridge_unavailable";
  nextResult: LocalBrowserResult = { commandId: "pending", ok: true };
  private results = new Map<string, LocalBrowserResult>();

  dispatchCommand(input: {
    assistantId: string;
    workspaceId: string;
    bridgeDeviceId?: string | null;
    command: { commandId: string; profileKey: string; action: string; url?: string };
  }) {
    this.dispatches.push(input);
    if (!this.nextAccepted) {
      return {
        accepted: false as const,
        commandId: input.command.commandId,
        code: this.nextUnavailableCode as
          | "bridge_unavailable"
          | "bridge_device_not_connected"
          | "bridge_device_ambiguous",
        message: "bridge unavailable",
        activeBridgeDeviceIds: []
      };
    }
    this.results.set(input.command.commandId, {
      ...this.nextResult,
      commandId: input.command.commandId
    });
    return {
      accepted: true as const,
      commandId: input.command.commandId,
      bridgeDeviceId: this.nextBridgeDeviceId
    };
  }

  getCommandResult(commandId: string) {
    return {
      status: "completed" as const,
      result: this.results.get(commandId)
    };
  }
}

function buildService(input: {
  repository: InMemoryAssistantBrowserProfileRepository;
  relay?: FakeBrowserBridgeRelayService;
  ttlDays?: number | null;
}) {
  const prisma = {
    assistant: {
      findUnique: async () => ({
        id: "assistant-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        governance: {
          assistantPlanOverrideCode: null,
          quotaPlanCode: null
        }
      })
    },
    planCatalogPlan: {
      findUnique: async () => ({
        billingProviderHints: {
          browserProfileTtlDays: input.ttlDays ?? null
        }
      })
    }
  };
  const resolveEffectiveSubscriptionStateService = {
    execute: async () => ({ planCode: "starter" })
  };
  return new AssistantBrowserProfileService(
    input.repository,
    prisma as never,
    resolveEffectiveSubscriptionStateService as never,
    (input.relay ?? new FakeBrowserBridgeRelayService()) as never
  );
}

describe("browser profile key helpers", () => {
  test("dedupes profile keys with numeric suffix", () => {
    const base = generateBrowserProfileKeyBase("Bitrix24 CRM", "assistant-1");
    assert.equal(base, "bitrix24-crm");
    assert.equal(ensureBrowserProfileKeyUnique([base], base), "bitrix24-crm-1");
    assert.equal(ensureBrowserProfileKeyUnique([base, `${base}-1`], base), "bitrix24-crm-2");
  });
});

describe("resolveBrowserProfileTtlDays", () => {
  test("defaults to 30 days when plan hint is absent", () => {
    assert.equal(resolveBrowserProfileTtlDays(null), DEFAULT_BROWSER_PROFILE_TTL_DAYS);
    assert.equal(resolveBrowserProfileTtlDays({ browserProfileTtlDays: null }), 30);
  });
});

describe("AssistantBrowserProfileService", () => {
  test("startLogin creates pending profile with deduped key and defaults bridge client kind to extension", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "existing-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "bitrix24-crm",
      displayName: "Bitrix24 CRM",
      loginUrl: "https://old.example/login",
      originHost: "old.example",
      bridgeSessionRef: "bridge-device-old",
      bridgeClientKind: "extension",
      originatingChatId: null,
      status: "active",
      lastUsedAt: null,
      expiresAt: null
    });
    const service = buildService({ repository });

    const result = await service.startLogin({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      displayName: "Bitrix24 CRM",
      loginUrl: "https://crm.example/login"
    });

    assert.equal(result.profileKey, "bitrix24-crm-1");
    assert.equal(result.status, "pending_login");
    assert.equal(result.bridgeClientKind, "extension");
    const created = await repository.findById(result.profileId);
    assert.equal(created?.bridgeSessionRef, null);
    assert.equal(created?.bridgeClientKind, "extension");
  });

  test("startLogin reuses same-origin row and moves it back to pending_login", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "active-crm",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      bridgeSessionRef: "bridge-device-1",
      bridgeClientKind: "capacitor",
      originatingChatId: null,
      status: "active",
      lastUsedAt: new Date("2026-07-05T10:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z")
    });
    const relay = new FakeBrowserBridgeRelayService();
    const service = buildService({ repository, relay });

    const result = await service.startLogin({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      displayName: "CRM again",
      loginUrl: "https://crm.example/login"
    });

    assert.equal(result.profileId, "active-crm");
    assert.equal(result.bridgeClientKind, "extension");
    const updated = await repository.findById("active-crm");
    assert.equal(updated?.status, "pending_login");
    assert.equal(updated?.bridgeSessionRef, null);
    assert.equal(relay.dispatches.length, 1);
    assert.equal(relay.dispatches[0]?.command.action, "close_view");
  });

  test("resolveProfileForTool returns pending browser login state with bridge fields only", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "pending-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "bitrix",
      displayName: "Bitrix24",
      loginUrl: "https://example.bitrix24.ru/login",
      originHost: "example.bitrix24.ru",
      bridgeSessionRef: null,
      bridgeClientKind: "extension",
      originatingChatId: "chat-1",
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    const service = buildService({ repository });

    assert.deepEqual(
      await service.resolveProfileForTool({ assistantId: "assistant-1", profileKey: "bitrix" }),
      {
        ok: false,
        reason: "browser_profile_pending_login",
        pendingBrowserLogin: {
          profileId: "pending-1",
          profileKey: "bitrix",
          displayName: "Bitrix24",
          loginUrl: "https://example.bitrix24.ru/login",
          workspaceId: "workspace-1",
          bridgeClientKind: "extension",
          completionMode: "login"
        }
      }
    );
  });

  test("resolveProfileForTool treats active rows with null bridgeSessionRef as re-login required", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "active-null-ref",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      bridgeSessionRef: null,
      bridgeClientKind: "capacitor",
      originatingChatId: null,
      status: "active",
      lastUsedAt: null,
      expiresAt: new Date("2099-01-01T00:00:00.000Z")
    });
    const service = buildService({ repository });

    const result = await service.resolveProfileForTool({
      assistantId: "assistant-1",
      profileKey: "crm"
    });

    assert.deepEqual(result, {
      ok: false,
      reason: "browser_profile_needs_user_reauth",
      pendingBrowserLogin: {
        profileId: "active-null-ref",
        profileKey: "crm",
        displayName: "CRM",
        loginUrl: "https://crm.example/login",
        workspaceId: "workspace-1",
        bridgeClientKind: "capacitor",
        completionMode: "login"
      }
    });
  });

  test("resolveProfileForTool returns ok for active profile with bridge session ref", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "active-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      bridgeSessionRef: "bridge-device-1",
      bridgeClientKind: "extension",
      originatingChatId: null,
      status: "active",
      lastUsedAt: new Date("2026-07-05T10:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z")
    });
    const service = buildService({ repository });

    assert.deepEqual(
      await service.resolveProfileForTool({ assistantId: "assistant-1", profileKey: "crm" }),
      {
        ok: true,
        profileId: "active-1",
        bridgeSessionRef: "bridge-device-1"
      }
    );
  });

  test("completeLogin activates a pending profile from bridge verification truth", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "pending-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      bridgeSessionRef: null,
      bridgeClientKind: "extension",
      originatingChatId: null,
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    const relay = new FakeBrowserBridgeRelayService();
    relay.nextBridgeDeviceId = "bridge-device-42";
    relay.nextResult = { commandId: "ignored", ok: true, finalUrl: "https://crm.example/home" };
    const service = buildService({ repository, relay, ttlDays: 90 });

    const before = Date.now();
    const result = await service.completeLogin({
      profileId: "pending-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });
    const after = Date.now();

    assert.equal(result.profile.status, "active");
    const updated = await repository.findById("pending-1");
    assert.equal(updated?.bridgeSessionRef, "bridge-device-42");
    assert.equal(updated?.bridgeClientKind, "extension");
    assert.ok(updated?.lastUsedAt instanceof Date);
    assert.ok(updated?.expiresAt instanceof Date);
    const minExpiresAt = before + 90 * 24 * 60 * 60 * 1000 - 1_000;
    const maxExpiresAt = after + 90 * 24 * 60 * 60 * 1000 + 1_000;
    assert.ok((updated?.expiresAt?.getTime() ?? 0) >= minExpiresAt);
    assert.ok((updated?.expiresAt?.getTime() ?? 0) <= maxExpiresAt);
    assert.equal(relay.dispatches[0]?.command.action, "snapshot");
  });

  test("completeLogin fails honestly when no bridge device is connected", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "pending-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      bridgeSessionRef: null,
      bridgeClientKind: "extension",
      originatingChatId: null,
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    const relay = new FakeBrowserBridgeRelayService();
    relay.nextAccepted = false;
    const service = buildService({ repository, relay });

    await assert.rejects(
      () =>
        service.completeLogin({
          profileId: "pending-1",
          assistantId: "assistant-1",
          workspaceId: "workspace-1"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.match(error.message, /local browser bridge/i);
        return true;
      }
    );
  });

  test("openLiveView shows an active profile in assist mode and pins the chosen device", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "active-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      bridgeSessionRef: "bridge-device-old",
      bridgeClientKind: "extension",
      originatingChatId: null,
      status: "active",
      lastUsedAt: new Date("2026-07-05T10:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z")
    });
    const relay = new FakeBrowserBridgeRelayService();
    relay.nextBridgeDeviceId = "bridge-device-new";
    relay.nextResult = { commandId: "ignored", ok: true };
    const service = buildService({ repository, relay });

    const result = await service.openLiveView({
      profileId: "active-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });

    assert.equal(result.completionMode, "assist");
    assert.equal(result.bridgeClientKind, "extension");
    assert.equal((await repository.findById("active-1"))?.bridgeSessionRef, "bridge-device-new");
    assert.equal(relay.dispatches[0]?.command.action, "open_view");
  });
});
