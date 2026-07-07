import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { describe, test } from "node:test";
import type {
  AssistantBrowserProfileStatus,
  PersistentBrowserCapabilityPolicy
} from "@persai/runtime-contract";
import { AssistantBrowserProfileService } from "../src/modules/workspace-management/application/assistant-browser-profile.service";
import type {
  AssistantBrowserProfileRepository,
  AssistantBrowserProfileRow
} from "../src/modules/workspace-management/domain/assistant-browser-profile.repository";
import type { BrowserlessSessionPort } from "../src/modules/workspace-management/application/browserless-session.port";
import {
  DEFAULT_BROWSER_PROFILE_TTL_DAYS,
  resolveBrowserProfileTtlDays
} from "../src/modules/workspace-management/application/resolve-browser-profile-ttl-days";
import {
  ensureBrowserProfileKeyUnique,
  generateBrowserProfileKeyBase
} from "../src/modules/workspace-management/application/browser-profile-key";
import { resolveBrowserToolCredentialSecretId } from "../src/modules/workspace-management/application/tool-credential-settings";

class InMemoryAssistantBrowserProfileRepository implements AssistantBrowserProfileRepository {
  private rows = new Map<string, AssistantBrowserProfileRow>();
  private nextId = 1;

  reset(): void {
    this.rows.clear();
    this.nextId = 1;
  }

  seed(
    row: Omit<AssistantBrowserProfileRow, "createdAt" | "updatedAt">
  ): AssistantBrowserProfileRow {
    const now = new Date("2026-07-05T12:00:00.000Z");
    const stored: AssistantBrowserProfileRow = {
      ...row,
      createdAt: now,
      updatedAt: now
    };
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

  async findMostRecentPendingLogin(
    assistantId: string
  ): Promise<AssistantBrowserProfileRow | null> {
    const pending = [...this.rows.values()]
      .filter((row) => row.assistantId === assistantId && row.status === "pending_login")
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const row = pending[0];
    return row ? { ...row } : null;
  }

  async findMostRecentPendingLoginForChat(
    assistantId: string,
    chatId: string
  ): Promise<AssistantBrowserProfileRow | null> {
    const pending = [...this.rows.values()]
      .filter(
        (row) =>
          row.assistantId === assistantId &&
          row.status === "pending_login" &&
          row.originatingChatId === chatId
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const row = pending[0];
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
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    if (active[0] !== undefined) {
      return { ...active[0] };
    }
    if (typeof originatingChatId === "string" && originatingChatId.trim().length > 0) {
      const pendingForChat = [...this.rows.values()]
        .filter(
          (row) =>
            row.assistantId === assistantId &&
            row.originHost === originHost &&
            row.status === "pending_login" &&
            row.originatingChatId === originatingChatId.trim()
        )
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
      if (pendingForChat[0] !== undefined) {
        return { ...pendingForChat[0] };
      }
    }
    const pending = [...this.rows.values()]
      .filter(
        (row) =>
          row.assistantId === assistantId &&
          row.originHost === originHost &&
          row.status === "pending_login"
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const row = pending[0];
    return row ? { ...row } : null;
  }

  async updateLiveUrl(id: string, liveUrl: string | null): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.liveUrl = liveUrl;
    }
  }

  async create(input: {
    assistantId: string;
    workspaceId: string;
    profileKey: string;
    displayName: string;
    loginUrl: string;
    originHost: string;
    providerSessionId: string;
    liveUrl?: string | null;
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
      providerSessionId: input.providerSessionId,
      liveUrl: input.liveUrl ?? null,
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

  async updatePendingLoginSession(
    id: string,
    input: { providerSessionId: string; liveUrl: string }
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.providerSessionId = input.providerSessionId;
      row.liveUrl = input.liveUrl;
      row.status = "pending_login";
    }
  }

  async clearLiveUrl(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.liveUrl = null;
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
      row.liveUrl = null;
    }
  }

  async deleteById(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  async claimExpiredProfiles(limit: number): Promise<AssistantBrowserProfileRow[]> {
    const claimed: AssistantBrowserProfileRow[] = [];
    for (const row of this.rows.values()) {
      if (claimed.length >= limit) break;
      if (
        row.status === "active" &&
        row.expiresAt !== null &&
        row.expiresAt.getTime() < Date.now()
      ) {
        row.status = "expired";
        row.liveUrl = null;
        claimed.push({ ...row, status: "expired", liveUrl: null });
      }
    }
    return claimed;
  }
}

class FakeBrowserlessSessionPort implements BrowserlessSessionPort {
  readonly startLoginCalls: Array<{
    loginUrl: string;
    profileKey: string;
    reconnectTimeoutMs: number;
    capabilityPolicy: PersistentBrowserCapabilityPolicy;
    browserCredentialSecretId?: string;
  }> = [];
  readonly verifySessionCalls: Array<{
    providerSessionId: string;
    capabilityPolicy: PersistentBrowserCapabilityPolicy;
    browserCredentialSecretId?: string;
  }> = [];
  readonly deletedSessions: string[] = [];
  readonly openLiveCalls: Array<{
    providerSessionId: string;
    targetUrl: string;
    capabilityPolicy: PersistentBrowserCapabilityPolicy;
    browserCredentialSecretId?: string;
  }> = [];
  private loginCounter = 0;
  verifySessionShouldFail = false;
  startLoginShouldFail = false;
  openLiveShouldFail = false;

  async startLogin(input: {
    loginUrl: string;
    profileKey: string;
    reconnectTimeoutMs: number;
    capabilityPolicy: PersistentBrowserCapabilityPolicy;
    browserCredentialSecretId?: string;
  }) {
    if (this.startLoginShouldFail) {
      throw new Error("Browser login could not be started.");
    }
    this.startLoginCalls.push(input);
    this.loginCounter += 1;
    const suffix = String(this.loginCounter);
    return {
      providerSessionId: `mock-session:${suffix}`,
      liveUrl: `https://browserless.test/live/${suffix}`
    };
  }

  async verifySession(input: {
    providerSessionId: string;
    capabilityPolicy: PersistentBrowserCapabilityPolicy;
    browserCredentialSecretId?: string;
  }): Promise<{ ok: true }> {
    this.verifySessionCalls.push(input);
    if (this.verifySessionShouldFail) {
      throw new Error("Browser session is not reachable.");
    }
    return { ok: true };
  }

  async openLive(input: {
    providerSessionId: string;
    targetUrl: string;
    capabilityPolicy: PersistentBrowserCapabilityPolicy;
    browserCredentialSecretId?: string;
  }): Promise<{ liveUrl: string }> {
    this.openLiveCalls.push(input);
    if (this.openLiveShouldFail) {
      throw new Error("Browser live view could not be opened.");
    }
    return { liveUrl: `https://browserless.test/live/reopen/${input.providerSessionId}` };
  }

  async deleteSession(
    providerSessionId: string,
    input?: { browserCredentialSecretId?: string }
  ): Promise<void> {
    this.deletedSessions.push(
      JSON.stringify({
        providerSessionId,
        browserCredentialSecretId: input?.browserCredentialSecretId
      })
    );
  }
}

function buildService(input: {
  repository: InMemoryAssistantBrowserProfileRepository;
  browserlessPort: FakeBrowserlessSessionPort;
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
    input.browserlessPort,
    prisma as never,
    resolveEffectiveSubscriptionStateService as never
  );
}

function expectedPersistentCapabilityPolicy(
  assistantId: string,
  profileKey: string
): PersistentBrowserCapabilityPolicy {
  return {
    scope: "persistent_profile",
    profileIdentity: {
      assistantId,
      profileKey
    },
    stealth: true,
    proxy: {
      mode: "sticky_residential",
      provider: "browserless_builtin",
      server: null
    }
  };
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

  test("reads plan billing hint when present", () => {
    assert.equal(resolveBrowserProfileTtlDays({ browserProfileTtlDays: 90 }), 90);
    // Scale plan (90d) is operator-configured in plan catalog; seed only ships starter_trial.
  });
});

describe("AssistantBrowserProfileService", () => {
  test("startLogin reuses an active profile for the same originHost via openLive", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "active-lavka",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "lavka",
      displayName: "Яндекс Лавка",
      loginUrl: "https://lavka.yandex.ru/cart",
      originHost: "lavka.yandex.ru",
      providerSessionId: "session-lavka",
      liveUrl: null,
      status: "active",
      lastUsedAt: null,
      expiresAt: null
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({ repository, browserlessPort });

    const result = await service.startLogin({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      displayName: "Яндекс Лавка новый",
      loginUrl: "https://lavka.yandex.ru/cart"
    });

    assert.equal(result.profileId, "active-lavka");
    assert.equal(result.profileKey, "lavka");
    assert.equal(result.status, "active");
    assert.equal(browserlessPort.startLoginCalls.length, 0);
    assert.equal(browserlessPort.openLiveCalls.length, 1);
    assert.equal(browserlessPort.openLiveCalls[0]?.providerSessionId, "session-lavka");
    assert.equal(
      (await repository.listByAssistant("assistant-1")).length,
      1,
      "must not create a duplicate profile row"
    );
  });

  test("startLogin reuses pending profile for the same originHost instead of creating a new session row", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "stale-pending-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "old-pending",
      displayName: "Old Pending",
      loginUrl: "https://crm.example/old-login",
      originHost: "crm.example",
      providerSessionId: "stale-session-1",
      liveUrl: "https://browserless.test/live/old-pending",
      originatingChatId: null,
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({ repository, browserlessPort });

    const result = await service.startLogin({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      displayName: "CRM",
      loginUrl: "https://crm.example/login"
    });

    assert.equal(result.profileId, "stale-pending-1");
    assert.equal(result.profileKey, "old-pending");
    assert.equal(browserlessPort.startLoginCalls.length, 1);
    assert.deepEqual(
      browserlessPort.deletedSessions.map((entry) => JSON.parse(entry)),
      [
        {
          providerSessionId: "stale-session-1",
          browserCredentialSecretId: resolveBrowserToolCredentialSecretId()
        }
      ]
    );
    assert.equal((await repository.listByAssistant("assistant-1")).length, 1);
  });

  test("startLogin creates pending profile with deduped profileKey", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "existing-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "bitrix24-crm",
      displayName: "Bitrix24 CRM",
      loginUrl: "https://old.example/login",
      originHost: "old.example",
      providerSessionId: "old-session",
      liveUrl: null,
      status: "active",
      lastUsedAt: null,
      expiresAt: null
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({ repository, browserlessPort });

    const result = await service.startLogin({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      displayName: "Bitrix24 CRM",
      loginUrl: "https://crm.example/login"
    });

    assert.equal(result.profileKey, "bitrix24-crm-1");
    assert.equal(result.status, "pending_login");
    assert.match(result.liveUrl, /^https:\/\/browserless\.test\/live\//);
    assert.equal(browserlessPort.startLoginCalls.length, 1);
    assert.deepEqual(
      browserlessPort.startLoginCalls[0]?.capabilityPolicy,
      expectedPersistentCapabilityPolicy("assistant-1", "bitrix24-crm-1")
    );
    const created = await repository.findById(result.profileId);
    assert.equal(created?.liveUrl, result.liveUrl);
  });

  test("startLogin passes plan TTL reconnect timeout to browserless port", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({ repository, browserlessPort, ttlDays: 90 });

    await service.startLogin({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      displayName: "CRM",
      loginUrl: "https://crm.example/login"
    });

    assert.equal(browserlessPort.startLoginCalls.length, 1);
    assert.equal(browserlessPort.startLoginCalls[0]?.reconnectTimeoutMs, 90 * 24 * 60 * 60 * 1000);
  });

  test("startLogin removes stale pending profiles in other chats before creating a new one", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "stale-pending-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "old-pending",
      displayName: "Old Pending",
      loginUrl: "https://shop.example/old-login",
      originHost: "shop.example",
      providerSessionId: "stale-session-1",
      liveUrl: "https://browserless.test/live/old-pending",
      originatingChatId: null,
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({ repository, browserlessPort });

    await service.startLogin({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      displayName: "Bitrix",
      loginUrl: "https://bitrix.example/login"
    });

    assert.deepEqual(
      browserlessPort.deletedSessions.map((entry) => JSON.parse(entry)),
      [
        {
          providerSessionId: "stale-session-1",
          browserCredentialSecretId: resolveBrowserToolCredentialSecretId()
        }
      ]
    );
    assert.equal(await repository.findById("stale-pending-1"), null);
    const pending = (await repository.listByAssistant("assistant-1")).filter(
      (row) => row.status === "pending_login"
    );
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.originHost, "bitrix.example");
  });

  test("startLogin reuses same-chat pending profile and drops duplicate origin rows", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "pending-chat-a",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm-a",
      displayName: "CRM A",
      loginUrl: "https://crm.example/a-login",
      originHost: "crm.example",
      providerSessionId: "session-chat-a",
      liveUrl: "https://browserless.test/live/a",
      originatingChatId: "chat-a",
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    repository.seed({
      id: "pending-chat-b",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm-b",
      displayName: "CRM B",
      loginUrl: "https://crm.example/b-login",
      originHost: "crm.example",
      providerSessionId: "session-chat-b",
      liveUrl: "https://browserless.test/live/b",
      originatingChatId: "chat-b",
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({ repository, browserlessPort });

    await service.startLogin({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      displayName: "CRM A retry",
      loginUrl: "https://crm.example/a-login",
      originatingChatId: "chat-a"
    });

    const deletedProviderSessionIds = browserlessPort.deletedSessions
      .map((entry) => JSON.parse(entry).providerSessionId as string)
      .sort();
    assert.deepEqual(deletedProviderSessionIds, ["session-chat-a", "session-chat-b"]);
    assert.notEqual(await repository.findById("pending-chat-a"), null);
    assert.equal(await repository.findById("pending-chat-b"), null);
    const pending = (await repository.listByAssistant("assistant-1")).filter(
      (row) => row.status === "pending_login"
    );
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.id, "pending-chat-a");
  });

  test("resolveProfileForTool returns pending login state for existing pending profiles", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "pending-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "pending",
      displayName: "Pending",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-pending",
      liveUrl: "https://browserless.test/live/pending",
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    repository.seed({
      id: "expired-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "expired",
      displayName: "Expired",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-expired",
      liveUrl: null,
      status: "expired",
      lastUsedAt: null,
      expiresAt: new Date("2026-01-01T00:00:00.000Z")
    });
    repository.seed({
      id: "active-expired-at-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "active-expired-at",
      displayName: "Active but past expiresAt",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-active-expired-at",
      liveUrl: null,
      status: "active",
      lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z")
    });
    const service = buildService({
      repository,
      browserlessPort: new FakeBrowserlessSessionPort()
    });

    assert.deepEqual(
      await service.resolveProfileForTool({ assistantId: "assistant-1", profileKey: "missing" }),
      {
        ok: false,
        reason: "browser_profile_not_found"
      }
    );
    assert.deepEqual(
      await service.resolveProfileForTool({ assistantId: "assistant-1", profileKey: "pending" }),
      {
        ok: false,
        reason: "browser_profile_pending_login",
        pendingBrowserLogin: {
          profileId: "pending-1",
          profileKey: "pending",
          displayName: "Pending",
          liveUrl: "https://browserless.test/live/pending",
          loginUrl: "https://crm.example/login"
        }
      }
    );
  });

  test("resolveProfileForTool reopens stale pending profiles for re-auth on the same row", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "pending-stale-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "pending-stale",
      displayName: "Pending stale",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-pending-stale",
      liveUrl: "https://browserless.test/live/stale",
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    browserlessPort.verifySessionShouldFail = true;
    const service = buildService({ repository, browserlessPort });

    assert.deepEqual(
      await service.resolveProfileForTool({
        assistantId: "assistant-1",
        profileKey: "pending-stale"
      }),
      {
        ok: false,
        reason: "browser_profile_needs_user_reauth",
        pendingBrowserLogin: {
          profileId: "pending-stale-1",
          profileKey: "pending-stale",
          displayName: "Pending stale",
          liveUrl: "https://browserless.test/live/1",
          loginUrl: "https://crm.example/login"
        }
      }
    );
    const updated = await repository.findById("pending-stale-1");
    assert.equal(updated?.status, "pending_login");
    assert.equal(updated?.providerSessionId, "mock-session:1");
    assert.equal(updated?.liveUrl, "https://browserless.test/live/1");
  });

  test("resolveProfileForTool reopens expired profiles for re-auth on the same row", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "expired-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "expired",
      displayName: "Expired",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-expired",
      liveUrl: null,
      status: "expired",
      lastUsedAt: null,
      expiresAt: new Date("2026-01-01T00:00:00.000Z")
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({ repository, browserlessPort });

    assert.deepEqual(
      await service.resolveProfileForTool({ assistantId: "assistant-1", profileKey: "expired" }),
      {
        ok: false,
        reason: "browser_profile_needs_user_reauth",
        pendingBrowserLogin: {
          profileId: "expired-1",
          profileKey: "expired",
          displayName: "Expired",
          liveUrl: "https://browserless.test/live/1",
          loginUrl: "https://crm.example/login"
        }
      }
    );
    const updated = await repository.findById("expired-1");
    assert.equal(updated?.status, "pending_login");
    assert.equal(updated?.providerSessionId, "mock-session:1");
    assert.equal(updated?.liveUrl, "https://browserless.test/live/1");
  });

  test("resolveProfileForTool reopens active profiles whose ttl already elapsed", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "active-expired-at-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "active-expired-at",
      displayName: "Active but past expiresAt",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-active-expired-at",
      liveUrl: null,
      status: "active",
      lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z")
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({ repository, browserlessPort });

    assert.deepEqual(
      await service.resolveProfileForTool({
        assistantId: "assistant-1",
        profileKey: "active-expired-at"
      }),
      {
        ok: false,
        reason: "browser_profile_needs_user_reauth",
        pendingBrowserLogin: {
          profileId: "active-expired-at-1",
          profileKey: "active-expired-at",
          displayName: "Active but past expiresAt",
          liveUrl: "https://browserless.test/live/1",
          loginUrl: "https://crm.example/login"
        }
      }
    );
  });

  test("completeLogin transitions pending profile to active with plan TTL and clears liveUrl", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    const pending = repository.seed({
      id: "pending-complete-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-crm",
      liveUrl: "https://browserless.test/live/crm",
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({
      repository,
      browserlessPort: browserlessPort,
      ttlDays: 90
    });

    const before = Date.now();
    const result = await service.completeLogin({
      profileId: pending.id,
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });
    const after = Date.now();

    assert.equal(browserlessPort.verifySessionCalls.length, 1);
    assert.equal(browserlessPort.verifySessionCalls[0]?.providerSessionId, "session-crm");
    assert.deepEqual(
      browserlessPort.verifySessionCalls[0]?.capabilityPolicy,
      expectedPersistentCapabilityPolicy("assistant-1", "crm")
    );
    assert.equal(result.profile.status, "active");
    assert.notEqual(result.profile.lastUsedAt, null);
    assert.notEqual(result.profile.expiresAt, null);
    const expiresAtMs = Date.parse(result.profile.expiresAt!);
    const expectedMin = before + 90 * 24 * 60 * 60 * 1000;
    const expectedMax = after + 90 * 24 * 60 * 60 * 1000;
    assert.ok(expiresAtMs >= expectedMin - 1000);
    assert.ok(expiresAtMs <= expectedMax + 1000);
    const updated = await repository.findById(pending.id);
    assert.equal(updated?.liveUrl, null);
  });

  test("completeLogin refreshes pending login when browser session verify fails", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    const pending = repository.seed({
      id: "pending-verify-fail-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-unreachable",
      liveUrl: "https://browserless.test/live/crm",
      originatingChatId: null,
      status: "pending_login",
      lastUsedAt: null,
      expiresAt: null
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    browserlessPort.verifySessionShouldFail = true;
    const service = buildService({ repository, browserlessPort });

    await assert.rejects(
      () =>
        service.completeLogin({
          profileId: pending.id,
          assistantId: "assistant-1",
          workspaceId: "workspace-1"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.match(error.message, /needs re-authentication/i);
        return true;
      }
    );

    const updated = await repository.findById(pending.id);
    assert.equal(updated?.status, "pending_login");
    assert.equal(updated?.providerSessionId, "mock-session:1");
    assert.equal(updated?.liveUrl, "https://browserless.test/live/1");
  });

  test("startLogin persists originatingChatId on pending profile", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({ repository, browserlessPort });

    const result = await service.startLogin({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originatingChatId: "chat-42"
    });

    const created = await repository.findById(result.profileId);
    assert.equal(created?.originatingChatId, "chat-42");
  });

  test("resolveProfileForTool returns provider session for active profile", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "active-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-active",
      liveUrl: null,
      status: "active",
      lastUsedAt: new Date("2026-07-05T10:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z")
    });
    const service = buildService({
      repository,
      browserlessPort: new FakeBrowserlessSessionPort()
    });

    assert.deepEqual(
      await service.resolveProfileForTool({ assistantId: "assistant-1", profileKey: "crm" }),
      {
        ok: true,
        providerSessionId: "session-active",
        profileId: "active-1",
        capabilityPolicy: expectedPersistentCapabilityPolicy("assistant-1", "crm")
      }
    );
  });

  test("reconnectLogin deletes and restarts session with browser credential secret", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    const active = repository.seed({
      id: "active-reconnect-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-reconnect-old",
      liveUrl: null,
      status: "active",
      lastUsedAt: new Date("2026-07-05T10:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z")
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = buildService({ repository, browserlessPort });
    const browserCredentialSecretId = resolveBrowserToolCredentialSecretId();

    const result = await service.reconnectLogin({
      profileId: active.id,
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      browserCredentialSecretId
    });

    assert.equal(result.status, "pending_login");
    assert.deepEqual(
      browserlessPort.startLoginCalls[0]?.capabilityPolicy,
      expectedPersistentCapabilityPolicy("assistant-1", "crm")
    );
    assert.deepEqual(
      browserlessPort.deletedSessions.map((entry) => JSON.parse(entry)),
      [
        {
          providerSessionId: "session-reconnect-old",
          browserCredentialSecretId
        }
      ]
    );
    assert.equal(browserlessPort.startLoginCalls.length, 1);
    assert.equal(
      browserlessPort.startLoginCalls[0]?.browserCredentialSecretId,
      browserCredentialSecretId
    );
  });
});
