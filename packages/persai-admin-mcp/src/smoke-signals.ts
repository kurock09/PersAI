function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mapToolCall(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: row.name ?? null,
    iteration: row.iteration ?? null,
    ok: row.ok ?? null,
    toolCallId: row.toolCallId ?? null,
    executionMode: row.executionMode ?? null
  };
}

export function summarizeToolSignals(toolInvocations: unknown): {
  skill: Record<string, unknown>[];
  todo_write: Record<string, unknown>[];
  memory_write: Record<string, unknown>[];
  other: Record<string, unknown>[];
} {
  const rows = Array.isArray(toolInvocations) ? toolInvocations : [];
  const skill: Record<string, unknown>[] = [];
  const todo_write: Record<string, unknown>[] = [];
  const memory_write: Record<string, unknown>[] = [];
  const other: Record<string, unknown>[] = [];

  for (const item of rows) {
    const row = asRecord(item);
    if (row === null) {
      continue;
    }
    const mapped = mapToolCall(row);
    const name = String(row.name ?? "");
    if (name === "skill") {
      skill.push(mapped);
    } else if (name === "todo_write") {
      todo_write.push(mapped);
    } else if (name === "memory_write") {
      memory_write.push(mapped);
    } else {
      other.push(mapped);
    }
  }

  return { skill, todo_write, memory_write, other };
}

export function buildSkillActivationSummary(
  transport: unknown,
  chat: unknown
): Record<string, unknown> {
  const transportRow = asRecord(transport);
  const chatRow = asRecord(chat);
  const runtime = asRecord(transportRow?.runtime);
  const turnRouting = asRecord(runtime?.turnRouting);
  const chatSkillState = chatRow?.skillDecisionState ?? null;
  const routingSkillState = turnRouting?.skillState ?? null;
  const retrievalPlan = asRecord(turnRouting?.retrievalPlan);
  const chatSkill = asRecord(chatSkillState);
  const routingSkill = asRecord(routingSkillState);

  const activeSkillId = chatSkill?.activeSkillId ?? routingSkill?.activeSkillId ?? null;
  const activeScenarioKey = chatSkill?.activeScenarioKey ?? routingSkill?.activeScenarioKey ?? null;
  const status =
    chatSkill?.status === "active" || routingSkill?.status === "active"
      ? "active"
      : (chatSkill?.status ?? routingSkill?.status ?? "inactive");

  return {
    status,
    activeSkillId,
    activeSkillName: chatSkill?.activeSkillName ?? routingSkill?.activeSkillName ?? null,
    activeScenarioKey,
    activeScenarioDisplayName:
      chatSkill?.activeScenarioDisplayName ?? routingSkill?.activeScenarioDisplayName ?? null,
    topicSummary: chatSkill?.topicSummary ?? routingSkill?.topicSummary ?? null,
    engagementSummary: transportRow?.engagementSummary ?? null,
    retrievalPlan:
      retrievalPlan === null
        ? null
        : {
            useSkills: retrievalPlan.useSkills ?? null,
            selectedSkillIds: retrievalPlan.selectedSkillIds ?? [],
            reasonCode: retrievalPlan.reasonCode ?? null,
            confidence: retrievalPlan.confidence ?? null
          },
    chatSkillState: chatSkillState,
    turnRoutingSkillState: routingSkillState
  };
}

export function mapChatPlan(planPayload: unknown): Record<string, unknown> | null {
  const row = asRecord(planPayload);
  if (row === null) {
    return null;
  }
  const todos = Array.isArray(row.todos) ? row.todos : [];
  return {
    totalCount: row.totalCount ?? todos.length,
    windowed: row.windowed ?? false,
    todos: todos.map((item) => {
      const todo = asRecord(item);
      if (todo === null) {
        return item;
      }
      return {
        id: todo.id ?? null,
        content: todo.content ?? null,
        status: todo.status ?? null,
        parentId: todo.parentId ?? null
      };
    })
  };
}
