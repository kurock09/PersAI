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
    activeScenarioDisplayName: null,
    topicSummary: "persai landing copy"
  });

  // ADR-118: persistFromTurnRouting is read-only. Even if turnRouting.skillState
  // disagrees with the DB, the DB wins — because the tool path is the single writer
  // and may have updated the DB during the same turn.
  chatStateById.set("chat-active", {
    skillDecisionState: {
      status: "active",
      activeSkillId: "skill-diet",
      activeSkillName: "Диетолог",
      activeScenarioKey: null,
      activeScenarioDisplayName: null,
      topicSummary: "nutrition"
    }
  });
  const staleEcho = await service.persistFromTurnRouting({
    chatId: "chat-active",
    turnRouting: {
      skillState: {
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        activeScenarioKey: null,
        activeScenarioDisplayName: null,
        topicSummary: null
      }
    }
  });
  assert.equal(
    chatUpdates.length,
    0,
    "persistFromTurnRouting must not write even when turnRouting disagrees with DB"
  );
  assert.deepEqual(
    staleEcho.skillDecisionState,
    {
      status: "active",
      activeSkillId: "skill-diet",
      activeSkillName: "Диетолог",
      activeScenarioKey: null,
      activeScenarioDisplayName: null,
      topicSummary: "nutrition"
    },
    "persistFromTurnRouting must return the freshest DB state, not the stale turnRouting echo"
  );

  const skipUndefinedResult = await service.persistFromTurnRouting({
    chatId: "chat-active",
    turnRouting: {}
  });
  assert.equal(chatUpdates.length, 0);
  assert.deepEqual(skipUndefinedResult.skillDecisionState, {
    status: "active",
    activeSkillId: "skill-diet",
    activeSkillName: "Диетолог",
    activeScenarioKey: null,
    activeScenarioDisplayName: null,
    topicSummary: "nutrition"
  });

  // ADR-118: persistDecisionState is the single authoritative writer.
  // It persists the new state AND clears mismatching retrieval cache.
  const engageResult = await service.persistDecisionState({
    chatId: "chat-active",
    nextState: {
      status: "active",
      activeSkillId: "skill-finance",
      activeSkillName: "Accountant",
      activeScenarioKey: "monthly_close",
      activeScenarioDisplayName: "Month-end close",
      topicSummary: "quarterly tax categories"
    }
  });
  assert.equal(chatUpdates.length, 1, "persistDecisionState must write to DB");
  assert.deepEqual(engageResult.skillDecisionState, {
    status: "active",
    activeSkillId: "skill-finance",
    activeSkillName: "Accountant",
    activeScenarioKey: "monthly_close",
    activeScenarioDisplayName: "Month-end close",
    topicSummary: "quarterly tax categories"
  });
  assert.deepEqual(clearedForChats.at(-1), {
    chatId: "chat-active",
    activeSkillId: "skill-finance"
  });

  // After tool engage write, persistFromTurnRouting must return the new active state
  // even if turnRouting echoes the original (stale) inactive snapshot.
  const postEngageRead = await service.persistFromTurnRouting({
    chatId: "chat-active",
    turnRouting: {
      skillState: {
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        activeScenarioKey: null,
        activeScenarioDisplayName: null,
        topicSummary: null
      }
    }
  });
  assert.equal(chatUpdates.length, 1, "post-turn read must not generate additional writes");
  assert.deepEqual(postEngageRead.skillDecisionState, {
    status: "active",
    activeSkillId: "skill-finance",
    activeSkillName: "Accountant",
    activeScenarioKey: "monthly_close",
    activeScenarioDisplayName: "Month-end close",
    topicSummary: "quarterly tax categories"
  });

  // Release path: persistDecisionState with inactive nextState clears retrieval cache (activeSkillId=null).
  const releaseResult = await service.persistDecisionState({
    chatId: "chat-active",
    nextState: {
      status: "inactive",
      activeSkillId: null,
      activeSkillName: null,
      activeScenarioKey: null,
      activeScenarioDisplayName: null,
      topicSummary: "quarterly tax categories"
    }
  });
  assert.equal(chatUpdates.length, 2);
  assert.deepEqual(releaseResult.skillDecisionState, {
    status: "inactive",
    activeSkillId: null,
    activeSkillName: null,
    activeScenarioKey: null,
    activeScenarioDisplayName: null,
    topicSummary: "quarterly tax categories"
  });
  assert.deepEqual(clearedForChats.at(-1), {
    chatId: "chat-active",
    activeSkillId: null
  });
}

void run();
