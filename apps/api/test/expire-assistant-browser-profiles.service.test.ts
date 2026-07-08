import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  AssistantBrowserProfileStatus,
  LocalBrowserBridgeDeviceKind
} from "@persai/runtime-contract";
import { ExpireAssistantBrowserProfilesService } from "../src/modules/workspace-management/application/expire-assistant-browser-profiles.service";
import type {
  AssistantBrowserProfileRepository,
  AssistantBrowserProfileRow
} from "../src/modules/workspace-management/domain/assistant-browser-profile.repository";

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

  async updatePendingLogin(): Promise<void> {
    return undefined;
  }

  async activate(): Promise<void> {
    return undefined;
  }

  async updateBridgeSessionRef(): Promise<void> {
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
        const bridgeSessionRef = row.bridgeSessionRef;
        row.status = "expired";
        row.bridgeSessionRef = null;
        claimed.push({ ...row, status: "expired", bridgeSessionRef });
      }
    }
    return claimed;
  }
}

class FakeBrowserBridgeRelayService {
  readonly dispatches: Array<{
    assistantId: string;
    workspaceId: string;
    bridgeDeviceId?: string | null;
    command: { commandId: string; profileKey: string; action: string };
  }> = [];

  dispatchCommand(input: {
    assistantId: string;
    workspaceId: string;
    bridgeDeviceId?: string | null;
    command: { commandId: string; profileKey: string; action: string };
  }) {
    this.dispatches.push(input);
    return {
      accepted: true as const,
      commandId: input.command.commandId,
      bridgeDeviceId: input.bridgeDeviceId ?? "bridge-device-1"
    };
  }
}

describe("ExpireAssistantBrowserProfilesService", () => {
  test("marks past-due active profiles expired and dispatches bridge close", async () => {
    const repository = new InMemoryAssistantBrowserProfileRepository();
    repository.seed({
      id: "expired-profile-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileKey: "crm",
      displayName: "CRM",
      loginUrl: "https://crm.example/login",
      originHost: "crm.example",
      bridgeSessionRef: "bridge-device-1",
      bridgeClientKind: "extension" as LocalBrowserBridgeDeviceKind,
      originatingChatId: null,
      status: "active" as AssistantBrowserProfileStatus,
      lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z")
    });
    const relay = new FakeBrowserBridgeRelayService();
    const service = new ExpireAssistantBrowserProfilesService(repository, relay as never);

    const result = await service.executeBatch(10);

    assert.equal(result.expired, 1);
    const updated = await repository.findById("expired-profile-1");
    assert.equal(updated?.status, "expired");
    assert.equal(updated?.bridgeSessionRef, null);
    assert.equal(relay.dispatches.length, 1);
    assert.equal(relay.dispatches[0]?.bridgeDeviceId, "bridge-device-1");
    assert.equal(relay.dispatches[0]?.command.action, "close_view");
  });
});
