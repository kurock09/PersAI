/**
 * ADR-109 Slice 7 — unit tests for ReadWorkspaceVideoPersonaService.
 *
 * Assertions:
 *  1. Returns full persona when (workspaceId, personaId) match and not archived.
 *  2. Returns null when personaId not found.
 *  3. Returns null when persona belongs to a different workspace (fail-closed isolation).
 *  4. Returns null when persona is archived.
 *  5. Returns the populated heygenAvatarId (always populated post-E12; asserts non-null).
 */

import assert from "node:assert/strict";
import { ReadWorkspaceVideoPersonaService } from "../src/modules/workspace-management/application/heygen/read-workspace-video-persona.service";
import type {
  WorkspaceVideoPersonaRecord,
  WorkspaceVideoPersonaRepository
} from "../src/modules/workspace-management/domain/workspace-video-persona.repository";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_WORKSPACE_ID = "00000000-0000-0000-0000-000000000099";
const PERSONA_ID = "persona-00000000-0001";
const AVATAR_ID = "ava-cached-e12-001";

function makePersonaRecord(
  overrides: Partial<WorkspaceVideoPersonaRecord> = {}
): WorkspaceVideoPersonaRecord {
  return {
    id: PERSONA_ID,
    workspaceId: WORKSPACE_ID,
    displayName: "Anya",
    displayNameLower: "anya",
    portraitImageUrl: "/api/persona-portrait/ws/pid/hash.jpg",
    portraitImageStorageKey: "workspaces/ws/personas/pid/portrait/current",
    heygenVoiceId: "en-US-Amy-HeyGen",
    heygenVoiceLabel: "Amy",
    heygenAvatarId: AVATAR_ID,
    archived: false,
    archivedAt: null,
    createdAt: new Date("2026-06-05T00:00:00.000Z"),
    updatedAt: new Date("2026-06-05T00:00:00.000Z"),
    ...overrides
  };
}

class FakePersonaRepository implements WorkspaceVideoPersonaRepository {
  private rows: WorkspaceVideoPersonaRecord[] = [];

  seed(rows: WorkspaceVideoPersonaRecord[]): void {
    this.rows = rows;
  }

  async findById(
    workspaceId: string,
    personaId: string
  ): Promise<WorkspaceVideoPersonaRecord | null> {
    return this.rows.find((r) => r.id === personaId && r.workspaceId === workspaceId) ?? null;
  }

  async countActiveForWorkspace(): Promise<number> {
    return 0;
  }
  async findActiveByLowerName(): Promise<WorkspaceVideoPersonaRecord | null> {
    return null;
  }
  async listActive(): Promise<WorkspaceVideoPersonaRecord[]> {
    return [];
  }
  async create(): Promise<WorkspaceVideoPersonaRecord> {
    throw new Error("create not used in read-only service tests");
  }
  async archive(): Promise<WorkspaceVideoPersonaRecord | null> {
    return null;
  }
}

export async function runReadWorkspaceVideoPersonaServiceTest(): Promise<void> {
  const repo = new FakePersonaRepository();
  const service = new ReadWorkspaceVideoPersonaService(repo as WorkspaceVideoPersonaRepository);

  // ── 1. Happy path: matching workspaceId, personaId, not archived ─────────
  repo.seed([makePersonaRecord()]);
  const found = await service.execute({ workspaceId: WORKSPACE_ID, personaId: PERSONA_ID });
  assert.ok(found !== null, "should return persona on happy path");
  assert.equal(found.id, PERSONA_ID);
  assert.equal(found.displayName, "Anya");
  assert.equal(found.heygenVoiceId, "en-US-Amy-HeyGen");
  assert.equal(found.heygenVoiceLabel, "Amy");
  assert.equal(found.portraitImageStorageKey, "workspaces/ws/personas/pid/portrait/current");

  // ── 2. Returns null when personaId not found ─────────────────────────────
  repo.seed([makePersonaRecord()]);
  const notFound = await service.execute({ workspaceId: WORKSPACE_ID, personaId: "no-such-id" });
  assert.equal(notFound, null, "should return null for unknown personaId");

  // ── 3. Returns null when persona belongs to a different workspace ─────────
  repo.seed([makePersonaRecord({ workspaceId: OTHER_WORKSPACE_ID })]);
  // Repository findById already filters by workspaceId, so it returns null for cross-workspace.
  const crossWorkspace = await service.execute({
    workspaceId: WORKSPACE_ID,
    personaId: PERSONA_ID
  });
  assert.equal(crossWorkspace, null, "should return null for cross-workspace persona lookup");

  // ── 4. Returns null when persona is archived ──────────────────────────────
  repo.seed([
    makePersonaRecord({ archived: true, archivedAt: new Date("2026-06-05T01:00:00.000Z") })
  ]);
  const archived = await service.execute({ workspaceId: WORKSPACE_ID, personaId: PERSONA_ID });
  assert.equal(archived, null, "should return null for archived persona");

  // ── 5. heygenAvatarId is non-null (always populated post-E12) ─────────────
  repo.seed([makePersonaRecord({ heygenAvatarId: AVATAR_ID })]);
  const withAvatar = await service.execute({ workspaceId: WORKSPACE_ID, personaId: PERSONA_ID });
  assert.ok(withAvatar !== null);
  assert.equal(typeof withAvatar.heygenAvatarId, "string");
  assert.ok(withAvatar.heygenAvatarId.length > 0, "heygenAvatarId must be non-empty (post-E12)");
  assert.equal(withAvatar.heygenAvatarId, AVATAR_ID);

  console.log("read-workspace-video-persona.service.test: 5/5 assertions PASS");
}

runReadWorkspaceVideoPersonaServiceTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
