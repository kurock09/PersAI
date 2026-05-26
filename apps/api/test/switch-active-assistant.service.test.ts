import assert from "node:assert/strict";
import { SwitchActiveAssistantService } from "../src/modules/workspace-management/application/switch-active-assistant.service";
import type {
  ResolveActiveAssistantService,
  ResolvedActiveAssistantContext
} from "../src/modules/workspace-management/application/resolve-active-assistant.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
  const updates: Array<{
    where: { id: string };
    data: { activeAssistantId: string };
  }> = [];
  const resolvedContext: ResolvedActiveAssistantContext = {
    userId: "user-1",
    workspaceId: "ws-1",
    workspaceMemberId: "member-1",
    assistantId: "assistant-2",
    assistant: {
      id: "assistant-2",
      userId: "user-1",
      workspaceId: "ws-1",
      draftDisplayName: null,
      draftInstructions: null,
      draftTraits: null,
      draftAvatarEmoji: null,
      draftAvatarUrl: null,
      draftAssistantGender: null,
      draftVoiceProfile: null,
      draftArchetypeKey: null,
      draftUpdatedAt: null,
      applyStatus: "not_requested",
      applyTargetVersionId: null,
      applyAppliedVersionId: null,
      applyRequestedAt: null,
      applyStartedAt: null,
      applyFinishedAt: null,
      applyErrorCode: null,
      applyErrorMessage: null,
      configDirtyAt: null,
      createdAt: new Date("2026-05-26T14:00:00.000Z"),
      updatedAt: new Date("2026-05-26T14:00:00.000Z")
    },
    plan: null,
    assistantLimit: {
      maxAssistants: 3
    }
  };

  const service = new SwitchActiveAssistantService(
    {
      async execute(input: { userId: string; assistantId?: string | null }) {
        assert.deepEqual(input, {
          userId: "user-1",
          assistantId: "assistant-2"
        });
        return resolvedContext;
      }
    } as Pick<ResolveActiveAssistantService, "execute"> as ResolveActiveAssistantService,
    {
      workspaceMember: {
        async update(input: { where: { id: string }; data: { activeAssistantId: string } }) {
          updates.push(input);
          return null;
        }
      }
    } as unknown as WorkspaceManagementPrismaService
  );

  const result = await service.execute({
    userId: "user-1",
    assistantId: "assistant-2"
  });

  assert.equal(result.assistantId, "assistant-2");
  assert.deepEqual(updates, [
    {
      where: { id: "member-1" },
      data: { activeAssistantId: "assistant-2" }
    }
  ]);
}

void run();
