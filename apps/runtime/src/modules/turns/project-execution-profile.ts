import type { RuntimeTurnStreamEvent, RuntimeTurnRequest } from "@persai/runtime-contract";

export function isProjectChatMode(request: RuntimeTurnRequest): boolean {
  return request.chatMode === "project";
}

export const PROJECT_EXECUTION_DEVELOPER_CONTRACT = [
  "## Project execution contract",
  "This turn runs in project analysis mode. Nothing is pre-fetched for you: retrieval is pull-first. You have the project files (read on demand with the files tool) plus knowledge_search and knowledge_fetch. Work in bounded staged passes inside the native tool loop:",
  "1. plan — understand the request, list the relevant project files, Skill knowledge, and KB sources you will need, and whether web/browser is required; keep the internal plan concise.",
  "2. gather — locate first, then read: run knowledge_search to find candidate references (snippets + ids), then knowledge_fetch the exact excerpt you need; read project files with the files tool when the answer is in an attached file; use web/browser when local context does not answer the user's real task.",
  "3. analyze — compare requirements, documents, norms, and assumptions; note conflicts, omissions, ambiguities, and outdated references.",
  "4. replan — only when material gaps remain; gather missing sources or narrower file/excerpt sections within the plan tool budgets.",
  "5. synthesize — deliver the final user-facing answer with sources cited, confidence stated, and residual gaps called out.",
  "Do not expose raw hidden chain-of-thought. Respect per-turn tool caps and loop limits from the effective plan.",
  "One local file or one retrieved excerpt is not proof of sufficiency, and a single snippet is not the same as the source — fetch the excerpt before relying on it. Do not synthesize from a single source: if the current context is procedural, partial, outdated, or off-target for the actual engineering/business question, continue with narrower follow-up lookup or external verification instead of answering early."
].join("\n");

type ProjectStreamIdentity = {
  requestId: string;
  sessionId: string;
};

export function createProjectModeBootstrapStreamEvents(
  identity: ProjectStreamIdentity
): RuntimeTurnStreamEvent[] {
  return [
    {
      type: "project_activity",
      requestId: identity.requestId,
      sessionId: identity.sessionId,
      stage: "plan",
      status: "started",
      summary: "Reviewing local context and planning the next step",
      sourceClass: "knowledge"
    }
  ];
}

export function createProjectModeReplanStreamEvents(input: {
  identity: ProjectStreamIdentity;
  pass: number;
}): RuntimeTurnStreamEvent[] {
  const detail = `Follow-up pass ${String(input.pass)} is gathering the next missing piece of evidence.`;
  return [
    {
      type: "project_activity",
      requestId: input.identity.requestId,
      sessionId: input.identity.sessionId,
      stage: "replan",
      status: "started",
      summary: "Gathering more evidence",
      detail
    }
  ];
}

export function createProjectModeSynthesisStreamEvents(
  identity: ProjectStreamIdentity
): RuntimeTurnStreamEvent[] {
  return [
    {
      type: "project_activity",
      requestId: identity.requestId,
      sessionId: identity.sessionId,
      stage: "synthesize",
      status: "started",
      summary: "Preparing the final answer"
    }
  ];
}
