import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  AutoSkillRoutingStateService,
  createInactiveSkillDecisionState
} from "../src/modules/workspace-management/application/auto-skill-routing-state.service";

async function run(): Promise<void> {
  const chatUpdates: Array<Record<string, unknown>> = [];
  const chatStateById = new Map<
    string,
    {
      skillDecisionState: Record<string, unknown> | null;
    }
  >();
  const clearedForChats: Array<{ chatId: string; activeSkillId: string | null }> = [];
  const service = new AutoSkillRoutingStateService(
    {
      assistantChat: {
        findUnique: async ({ where }: { where: { id: string } }) => ({
          skillDecisionState: chatStateById.get(where.id)?.skillDecisionState ?? null
        }),
        update: async (input: Record<string, unknown>) => {
          chatUpdates.push(input);
          const where = input.where as { id: string };
          const data = input.data as {
            skillDecisionState?: Record<string, unknown> | null | typeof Prisma.DbNull;
          };
          const nextState =
            data.skillDecisionState === Prisma.DbNull || data.skillDecisionState === undefined
              ? null
              : (data.skillDecisionState as Record<string, unknown> | null);
          chatStateById.set(where.id, {
            skillDecisionState: nextState
          });
          return null;
        }
      }
    } as never,
    {
      clearForChatWhenSkillMismatches: async (input: {
        chatId: string;
        activeSkillId: string | null;
      }) => {
        clearedForChats.push(input);
      }
    } as never
  );

  const inactiveSeed = createInactiveSkillDecisionState({ topicSummary: "persai landing copy" });
  assert.deepEqual(inactiveSeed, {
    status: "inactive",
    activeSkillId: null,
    activeSkillName: null,
    activeScenarioKey: null,
    topicSummary: "persai landing copy"
  });

  chatStateById.set("chat-active", {
    skillDecisionState: {
      status: "active",
      activeSkillId: "skill-diet",
      activeSkillName: "Диетолог",
      activeScenarioKey: null,
      topicSummary: "nutrition"
    }
  });
  const updatesBeforeNoChange = chatUpdates.length;
  const noChangeResult = await service.persistFromTurnRouting({
    chatId: "chat-active",
    turnRouting: {
      skillState: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        activeScenarioKey: null,
        topicSummary: "nutrition"
      }
    }
  });
  assert.equal(chatUpdates.length, updatesBeforeNoChange);
  assert.deepEqual(noChangeResult.skillDecisionState, {
    status: "active",
    activeSkillId: "skill-diet",
    activeSkillName: "Диетолог",
    activeScenarioKey: null,
    topicSummary: "nutrition"
  });

  const skipUndefinedResult = await service.persistFromTurnRouting({
    chatId: "chat-active",
    turnRouting: {}
  });
  assert.equal(chatUpdates.length, updatesBeforeNoChange);
  assert.deepEqual(skipUndefinedResult.skillDecisionState, {
    status: "active",
    activeSkillId: "skill-diet",
    activeSkillName: "Диетолог",
    activeScenarioKey: null,
    topicSummary: "nutrition"
  });

  const switchResult = await service.persistFromTurnRouting({
    chatId: "chat-active",
    turnRouting: {
      skillState: {
        status: "active",
        activeSkillId: "skill-finance",
        activeSkillName: "Accountant",
        activeScenarioKey: null,
        topicSummary: "quarterly tax categories"
      }
    }
  });
  assert.equal(chatUpdates.length, updatesBeforeNoChange + 1);
  assert.deepEqual(switchResult.skillDecisionState, {
    status: "active",
    activeSkillId: "skill-finance",
    activeSkillName: "Accountant",
    activeScenarioKey: null,
    topicSummary: "quarterly tax categories"
  });
  assert.deepEqual(clearedForChats.at(-1), {
    chatId: "chat-active",
    activeSkillId: "skill-finance"
  });

  chatStateById.set("chat-inactive", { skillDecisionState: null });
  const updatesBeforeActivation = chatUpdates.length;
  await service.persistFromSkillCheckResult({
    chatId: "chat-inactive",
    result: {
      requestId: "request-1",
      skillState: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        activeScenarioKey: null,
        topicSummary: "nutrition"
      }
    }
  });
  assert.equal(chatUpdates.length, updatesBeforeActivation + 1);
  assert.deepEqual(chatStateById.get("chat-inactive")?.skillDecisionState, {
    status: "active",
    activeSkillId: "skill-diet",
    activeSkillName: "Диетолог",
    activeScenarioKey: null,
    topicSummary: "nutrition"
  });
  assert.deepEqual(clearedForChats.at(-1), {
    chatId: "chat-inactive",
    activeSkillId: "skill-diet"
  });

  const updatesBeforeNullize = chatUpdates.length;
  await service.persistFromSkillCheckResult({
    chatId: "chat-inactive",
    result: {
      requestId: "request-2",
      skillState: null
    }
  });
  assert.equal(chatUpdates.length, updatesBeforeNullize + 1);
  assert.equal(chatStateById.get("chat-inactive")?.skillDecisionState, null);
  assert.deepEqual(clearedForChats.at(-1), {
    chatId: "chat-inactive",
    activeSkillId: null
  });
}

void run();
