import assert from "node:assert/strict";
import { STABLE_PREFIX_BUDGET_CHARS } from "@persai/runtime-contract";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextMessage,
  RuntimeBundleSkillScenario,
  RuntimeSkillDecisionState,
  RuntimeTodoItem
} from "@persai/runtime-contract";
import type { AssistantRuntimeEnabledSkillSummary } from "@persai/runtime-bundle";
import type { AcceptedRuntimeTurn } from "../src/modules/turns/turn-acceptance.service";
import { buildTurnExecutionHarness, createRuntimeTurnRequest } from "./turn-execution.service.test";

/**
 * ADR-130 Slice 1 (D7) — real cross-turn stable-prefix cache guard.
 *
 * This guard runs the REAL turn-execution assembly path (`createTurn` →
 * `buildProviderRequest` / `buildSystemPrompt` / volatile-prefix splicing) TWICE
 * over the SAME materialized bundle but with DIFFERENT volatile inputs (active
 * scenario step, chat plan + derived reminders, presence/time). It then asserts
 * the runtime-owned D7 invariants:
 *
 *   1. The cached `systemPrompt` (stable prefix) and its `ordinary_prompt.v1`
 *      cache token are BYTE-IDENTICAL across the two turns despite the volatile
 *      differences.
 *   2. The volatile blocks (`active_scenario`, `chat_plan`, `system_reminder`)
 *      are spliced into the request messages as `cacheRole:"volatile_context"`,
 *      ordered ahead of the base user question, and NEVER folded into the cached
 *      `systemPrompt`; presence rides in `developerInstructions`, also outside
 *      the prefix.
 *   3. The two turns genuinely differ in their volatile content (so the byte
 *      equality above is a real invariance result, not two identical builds).
 *
 * Enabled-skills budget-at-scale is intentionally NOT re-checked here — that is
 * owned by the api-side materialization test. The only budget assertion retained
 * runs against the REAL assembled prefix using the shared constant.
 */

const ACTIVE_SKILL_ID = "skill-guard";
const ACTIVE_SKILL_NAME = "Guarded Skill";

function makeScenario(
  key: string,
  displayName: string,
  directive: string
): RuntimeBundleSkillScenario {
  return {
    key,
    displayName,
    description: `${displayName} scenario`,
    iconEmoji: null,
    intentExamples: [],
    steps: [
      {
        number: 1,
        directive,
        recommendedToolCall: null,
        mayBeSkippedIf: null,
        negativeGuards: []
      }
    ],
    recommendedTools: [],
    exitCondition: `${displayName} exit condition reached.`
  };
}

const SCENARIO_A = makeScenario(
  "scenario-a",
  "Alpha Onboarding",
  "Draft the opening paragraph now."
);
const SCENARIO_B = makeScenario(
  "scenario-b",
  "Beta Recovery",
  "Summarize the failure timeline now."
);

function activeDecision(scenario: RuntimeBundleSkillScenario): RuntimeSkillDecisionState {
  return {
    status: "active",
    activeSkillId: ACTIVE_SKILL_ID,
    activeSkillName: ACTIVE_SKILL_NAME,
    activeScenarioKey: scenario.key,
    activeScenarioDisplayName: scenario.displayName,
    topicSummary: null
  };
}

function makeChatPlanResult(
  id: string,
  content: string,
  status: RuntimeTodoItem["status"]
): { block: ProviderGatewayTextMessage; todos: readonly RuntimeTodoItem[] } {
  const todos: RuntimeTodoItem[] = [{ id, parentId: null, content, status }];
  const block: ProviderGatewayTextMessage = {
    role: "user",
    content: `<persai_chat_plan>\n- [${status}] ${content} (${id})\n</persai_chat_plan>`,
    cacheRole: "volatile_context",
    volatileKind: "chat_plan"
  };
  return { block, todos };
}

interface CapturedTurn {
  systemPrompt: string;
  promptCacheKey: string;
  developerInstructions: string;
  messages: ProviderGatewayTextMessage[];
}

async function runTurn(
  harness: ReturnType<typeof buildTurnExecutionHarness>,
  bundleHash: string,
  volatile: {
    scenario: RuntimeBundleSkillScenario;
    chatPlan: { block: ProviderGatewayTextMessage; todos: readonly RuntimeTodoItem[] };
    presenceBlock: string;
  }
): Promise<CapturedTurn> {
  const { service, providerGatewayClient, turnContextHydrationService, turnAcceptanceService } =
    harness;

  turnContextHydrationService.presenceBlock = volatile.presenceBlock;
  turnContextHydrationService.chatPlanBlockResults = [volatile.chatPlan];

  const request = createRuntimeTurnRequest();
  request.bundle.bundleHash = bundleHash;
  request.skillStateContext = { decision: activeDecision(volatile.scenario) };
  (turnAcceptanceService.result as AcceptedRuntimeTurn).receipt.bundleHash = bundleHash;

  providerGatewayClient.calls.length = 0;
  await service.createTurn(request);

  const mainTurn = providerGatewayClient.calls.at(-1) as
    | ProviderGatewayTextGenerateRequest
    | undefined;
  assert.ok(mainTurn, "the turn must have issued at least one provider request");

  return {
    systemPrompt: mainTurn.systemPrompt ?? "",
    promptCacheKey: mainTurn.promptCache?.key ?? "",
    developerInstructions: mainTurn.developerInstructions ?? "",
    messages: mainTurn.messages as ProviderGatewayTextMessage[]
  };
}

function contentToString(content: ProviderGatewayTextMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content);
}

function collectVolatileKinds(messages: ProviderGatewayTextMessage[]): string[] {
  return messages
    .filter((message) => message.cacheRole === "volatile_context")
    .map((message) => message.volatileKind ?? "unknown");
}

function buildReplayHistoryMessages(toolResultText: string): ProviderGatewayTextMessage[] {
  return [
    {
      role: "user",
      content: "Earlier question"
    },
    {
      role: "assistant",
      content: "Earlier answer",
      priorToolExchanges: [
        {
          toolCall: {
            id: "prior-call-1",
            name: "knowledge_search",
            arguments: { query: "refund policy" }
          },
          toolResult: {
            toolCallId: "prior-call-1",
            name: "knowledge_search",
            content: toolResultText,
            isError: false
          }
        }
      ]
    },
    {
      role: "user",
      content: "hello runtime"
    }
  ];
}

export async function runPromptCacheStablePrefixGuardTest(): Promise<void> {
  const harness = buildTurnExecutionHarness();
  const entry = harness.bundleRegistry.entry;
  assert.ok(entry, "harness must expose a materialized bundle entry");

  // Inject a single enabled skill carrying two scenarios so the real
  // active-scenario / system-reminder resolvers produce genuine volatile blocks
  // that differ per turn. The bundle (and therefore the compiled stable prefix)
  // is shared across both turns; only the *chosen* scenario is volatile.
  const enabledSkill: AssistantRuntimeEnabledSkillSummary = {
    id: ACTIVE_SKILL_ID,
    name: ACTIVE_SKILL_NAME,
    description: "Guard skill for cache-discipline testing.",
    category: "work",
    tags: ["alpha"],
    iconEmoji: null,
    body: "",
    guardrails: [],
    examples: [],
    scenarios: [SCENARIO_A, SCENARIO_B]
  };
  entry.parsedBundle.skills = { enabled: [enabledSkill] };
  const bundleHash = entry.bundle.bundleHash;

  const turnA = await runTurn(harness, bundleHash, {
    scenario: SCENARIO_A,
    chatPlan: makeChatPlanResult("todo-a1", "Draft the intro section", "in_progress"),
    presenceBlock: "It is 14:31 in Europe/Tbilisi; the user is active right now."
  });
  const turnB = await runTurn(harness, bundleHash, {
    scenario: SCENARIO_B,
    chatPlan: makeChatPlanResult("todo-b1", "Review the appendix tables", "pending"),
    presenceBlock: "It is 09:02 in Europe/Tbilisi; the user has been idle for 3 hours."
  });

  // ── (1) Stable prefix + cache token are byte-identical across turns ────────
  assert.ok(turnA.systemPrompt.length > 0, "the assembled stable prefix must be non-empty");
  assert.equal(
    turnA.systemPrompt,
    turnB.systemPrompt,
    "cached systemPrompt (stable prefix) must be byte-identical across turns that differ only in volatile inputs"
  );
  assert.match(
    turnA.promptCacheKey,
    /^ps1:oc:[a-f0-9]{32}:b\d{2}$/,
    "the main-turn cache token must be the ordinary stable-prefix token"
  );
  assert.equal(
    turnA.promptCacheKey,
    turnB.promptCacheKey,
    "stable-prefix cache token must be identical across turns"
  );

  // ── (2) Volatile inputs genuinely differed → the guard is not tautological ─
  const volatileMessagesA = turnA.messages
    .filter((m) => m.cacheRole === "volatile_context")
    .map((m) => contentToString(m.content))
    .join("\n");
  const volatileMessagesB = turnB.messages
    .filter((m) => m.cacheRole === "volatile_context")
    .map((m) => contentToString(m.content))
    .join("\n");
  assert.notEqual(
    volatileMessagesA,
    volatileMessagesB,
    "the two turns must carry genuinely different volatile blocks (otherwise byte-stability is trivial)"
  );
  assert.notEqual(
    turnA.developerInstructions,
    turnB.developerInstructions,
    "presence/time volatile input must actually differ across the two turns"
  );

  // ── (3) Volatile splicing + ordering + no leakage into the cached prefix ───
  const volatileStringsByTurn: Array<{ turn: CapturedTurn; strings: string[] }> = [
    {
      turn: turnA,
      strings: [
        SCENARIO_A.steps[0]!.directive,
        SCENARIO_A.displayName,
        "Draft the intro section",
        "todo-a1",
        "14:31"
      ]
    },
    {
      turn: turnB,
      strings: [
        SCENARIO_B.steps[0]!.directive,
        SCENARIO_B.displayName,
        "Review the appendix tables",
        "todo-b1",
        "09:02"
      ]
    }
  ];

  for (const { turn, strings } of volatileStringsByTurn) {
    // Volatile blocks are spliced into messages as volatile_context, ordered
    // active_scenario → chat_plan → system_reminder(s), ahead of the base user
    // question — never inside the cached systemPrompt.
    const kinds = collectVolatileKinds(turn.messages);
    assert.ok(
      kinds.includes("active_scenario"),
      "active scenario must be present as a volatile_context message"
    );
    assert.ok(
      kinds.includes("chat_plan"),
      "chat plan must be present as a volatile_context message"
    );
    assert.ok(
      kinds.includes("system_reminder"),
      "system reminder(s) must be present as volatile_context messages"
    );
    assert.equal(kinds[0], "active_scenario", "active_scenario must lead the volatile prefix");
    assert.equal(
      kinds[1],
      "chat_plan",
      "chat_plan must follow the active scenario in the volatile prefix"
    );
    assert.ok(
      kinds.slice(2).every((kind) => kind === "system_reminder"),
      "system reminders must trail the volatile prefix"
    );

    const lastVolatileIndex = turn.messages.reduce(
      (acc, message, index) => (message.cacheRole === "volatile_context" ? index : acc),
      -1
    );
    const baseUserIndex = turn.messages.findIndex(
      (message) =>
        message.cacheRole !== "volatile_context" &&
        message.role === "user" &&
        contentToString(message.content).includes("hello runtime")
    );
    assert.ok(baseUserIndex >= 0, "the base user question must remain in the request");
    assert.ok(
      lastVolatileIndex < baseUserIndex,
      "all volatile blocks must be spliced before the current user question"
    );

    // The cached stable prefix must contain none of this turn's volatile content.
    for (const value of strings) {
      assert.ok(
        !turn.systemPrompt.includes(value),
        `stable prefix must not contain volatile string: ${value}`
      );
    }
  }

  // Presence must ride in developerInstructions (outside the cached prefix).
  assert.ok(
    turnA.developerInstructions.includes("14:31"),
    "presence/time must be projected into developerInstructions, outside the cached prefix"
  );
  assert.ok(
    !turnA.systemPrompt.includes("14:31"),
    "presence/time must never appear inside the cached stable prefix"
  );

  // ── (4) Retained budget assertion runs against the REAL assembled prefix ───
  assert.ok(
    turnA.systemPrompt.length <= STABLE_PREFIX_BUDGET_CHARS,
    "assembled stable prefix must stay within the shared STABLE_PREFIX_BUDGET_CHARS budget"
  );

  // ── (5) Prior tool-exchange replay stays in the tail only ─────────────────
  harness.turnContextHydrationService.messages = buildReplayHistoryMessages("replay-alpha");
  const replayTurnA = await runTurn(harness, bundleHash, {
    scenario: SCENARIO_A,
    chatPlan: makeChatPlanResult("todo-r1", "Reuse prior tool output", "in_progress"),
    presenceBlock: "It is 15:00 in Europe/Tbilisi; the user is active right now."
  });
  harness.turnContextHydrationService.messages = buildReplayHistoryMessages("replay-alpha");
  const replayTurnARepeat = await runTurn(harness, bundleHash, {
    scenario: SCENARIO_A,
    chatPlan: makeChatPlanResult("todo-r1", "Reuse prior tool output", "in_progress"),
    presenceBlock: "It is 15:00 in Europe/Tbilisi; the user is active right now."
  });
  harness.turnContextHydrationService.messages = buildReplayHistoryMessages("replay-beta");
  const replayTurnB = await runTurn(harness, bundleHash, {
    scenario: SCENARIO_A,
    chatPlan: makeChatPlanResult("todo-r1", "Reuse prior tool output", "in_progress"),
    presenceBlock: "It is 15:00 in Europe/Tbilisi; the user is active right now."
  });

  assert.equal(
    replayTurnA.systemPrompt,
    replayTurnB.systemPrompt,
    "changing prior tool-exchange replay must not change the cached stable prefix"
  );
  assert.equal(
    replayTurnA.promptCacheKey,
    replayTurnB.promptCacheKey,
    "changing prior tool-exchange replay must not change the stable-prefix cache key"
  );
  assert.deepEqual(
    replayTurnA.messages,
    replayTurnARepeat.messages,
    "identical prior tool-exchange replay state must build byte-identical tail messages"
  );
  assert.notDeepEqual(
    replayTurnA.messages,
    replayTurnB.messages,
    "different prior tool-exchange replay content must stay confined to the message tail"
  );
  assert.ok(
    !replayTurnA.systemPrompt.includes("replay-alpha") &&
      !replayTurnB.systemPrompt.includes("replay-beta"),
    "replayed tool results must never leak into the cached stable prefix"
  );
  const replayAssistantMessageA = replayTurnA.messages.find(
    (message) =>
      message.role === "assistant" && contentToString(message.content) === "Earlier answer"
  );
  const replayAssistantMessageB = replayTurnB.messages.find(
    (message) =>
      message.role === "assistant" && contentToString(message.content) === "Earlier answer"
  );
  assert.equal(
    replayAssistantMessageA?.priorToolExchanges?.[0]?.toolResult.content,
    "replay-alpha"
  );
  assert.equal(replayAssistantMessageB?.priorToolExchanges?.[0]?.toolResult.content, "replay-beta");
}

if (process.argv[1] && process.argv[1].endsWith("prompt-cache-stable-prefix-guard.test.ts")) {
  runPromptCacheStablePrefixGuardTest().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
