import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { WorkspaceVideoPersonasController } from "../src/modules/workspace-management/interface/http/workspace-video-personas.controller";

async function run(): Promise<void> {
  const controller = new WorkspaceVideoPersonasController(
    {
      async listPersonas() {
        return { personas: [], limit: 3, creationVcoinCost: 0 };
      },
      async updatePersona(input: {
        workspaceId: string;
        personaId: string;
        displayName: string;
        heygenVoiceId?: string;
        clonedVoiceId?: string | null;
      }) {
        assert.equal(input.workspaceId, "workspace-1");
        assert.equal(input.personaId, "persona-1");
        assert.equal(input.displayName, "Updated persona");
        assert.equal(input.heygenVoiceId, "voice-2");
        assert.equal(input.clonedVoiceId, "clone-1");
        return {
          persona: {
            id: "persona-1",
            displayName: "Updated persona",
            portraitImageUrl: "/portrait.jpg",
            heygenVoiceId: "voice-2",
            heygenVoiceLabel: "Updated voice",
            clonedVoiceId: "clone-1",
            clonedVoiceDisplayName: "Brand Voice",
            createdAt: "2026-06-06T12:00:00.000Z"
          }
        };
      }
    } as never,
    {
      async getVoiceCatalogForWorkspace(workspaceId: string) {
        assert.equal(workspaceId, "workspace-1");
        return {
          voices: [
            {
              voiceId: "voice-1",
              label: "Demo voice",
              previewAudioUrl: null,
              language: null,
              gender: null,
              providerMetadata: null
            }
          ]
        };
      }
    } as never,
    {
      async resolveMembership(userId: string) {
        assert.equal(userId, "user-1");
        return {
          workspaceId: "workspace-1",
          workspaceMemberId: "member-1",
          activeAssistantId: null
        };
      }
    } as never
  );

  const reqWithNullWorkspace = {
    requestId: "req-1",
    workspaceId: null,
    resolvedAppUser: { id: "user-1" }
  } as never;

  const voiceCatalog = await controller.getVoiceCatalog(reqWithNullWorkspace, "workspace-1");
  assert.equal(voiceCatalog.provider, "heygen");
  assert.equal(voiceCatalog.voices.length, 1);
  assert.equal(voiceCatalog.voices[0]?.voiceId, "voice-1");

  await assert.rejects(
    () => controller.getVoiceCatalog(reqWithNullWorkspace, "workspace-2"),
    (error: unknown) =>
      error instanceof UnauthorizedException &&
      error.message.includes("requested workspace does not match")
  );

  const updated = await controller.updatePersona(reqWithNullWorkspace, "workspace-1", "persona-1", {
    displayName: "Updated persona",
    heygenVoiceId: "voice-2",
    clonedVoiceId: "clone-1"
  });
  assert.equal(updated.persona.id, "persona-1");
  assert.equal(updated.persona.heygenVoiceId, "voice-2");
  assert.equal(updated.persona.clonedVoiceId, "clone-1");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
