import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantBrowserProfileStatus } from "@persai/runtime-contract";
import { ExpireAssistantBrowserProfilesService } from "../src/modules/workspace-management/application/expire-assistant-browser-profiles.service";
import type {
  AssistantBrowserProfileRepository,
  AssistantBrowserProfileRow
} from "../src/modules/workspace-management/domain/assistant-browser-profile.repository";
import type { BrowserlessSessionPort } from "../src/modules/workspace-management/application/browserless-session.port";
import { resolveBrowserToolCredentialSecretId } from "../src/modules/workspace-management/application/tool-credential-settings";

class InMemoryAssistantBrowserProfileRepository implements AssistantBrowserProfileRepository {
  private rows = new Map<string, AssistantBrowserProfileRow>();

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

  async findByAssistantAndKey(): Promise<AssistantBrowserProfileRow | null> {
    return null;
  }

  async findById(id: string): Promise<AssistantBrowserProfileRow | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async listByAssistant(): Promise<AssistantBrowserProfileRow[]> {
    return [];
  }

  async listProfileKeysWithPrefix(): Promise<string[]> {
    return [];
  }

  async findMostRecentPendingLogin(): Promise<AssistantBrowserProfileRow | null> {
    return null;
  }

  async findMostRecentPendingLoginForChat(): Promise<AssistantBrowserProfileRow | null> {
    return null;
  }

  async create(): Promise<AssistantBrowserProfileRow> {
    throw new Error("not implemented");
  }

  async updateStatus(): Promise<void> {
    return undefined;
  }

  async updatePendingLoginSession(): Promise<void> {
    return undefined;
  }

  async clearLiveUrl(): Promise<void> {
    return undefined;
  }

  async touch(): Promise<void> {
    return undefined;
  }

  async markExpired(): Promise<void> {
    return undefined;
  }

  async deleteById(): Promise<boolean> {
    return false;
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
  readonly deletedSessions: Array<{
    providerSessionId: string;
    browserCredentialSecretId?: string;
  }> = [];

  async startLogin(): Promise<{ providerSessionId: string; liveUrl: string }> {
    throw new Error("not implemented");
  }

  async verifySession(): Promise<{ ok: true }> {
    return { ok: true };
  }

  async deleteSession(
    providerSessionId: string,
    input?: { browserCredentialSecretId?: string }
  ): Promise<void> {
    this.deletedSessions.push({
      providerSessionId,
      browserCredentialSecretId: input?.browserCredentialSecretId
    });
  }
}

describe("ExpireAssistantBrowserProfilesService", () => {
  test("marks past-due active profiles expired and deletes provider sessions", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "expired-profile-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      providerSessionId: "session-expired-1",
      liveUrl: null,
      originatingChatId: null,
      status: "active" as AssistantBrowserProfileStatus,
      lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z")
    });
    const browserlessPort = new FakeBrowserlessSessionPort();
    const service = new ExpireAssistantBrowserProfilesService(repository, browserlessPort);

    const result = await service.executeBatch(10);

    assert.equal(result.expired, 1);
    const updated = await repository.findById("expired-profile-1");
    assert.equal(updated?.status, "expired");
    assert.deepEqual(browserlessPort.deletedSessions, [
      {
        providerSessionId: "session-expired-1",
        browserCredentialSecretId: resolveBrowserToolCredentialSecretId()
      }
    ]);
  });
});
