import type {
  RoutingLevel,
  RuntimeSkillDecisionState,
  RuntimeTurnStreamEvent,
  RuntimeTurnRequest
} from "@persai/runtime-contract";
import type {
  CreateDecisionInput,
  OrdinarySourcePriorityMode,
  TurnRetrievalPlan,
  TurnRouteDecision
} from "./turn-routing.service";

type ProjectPrecheckInput = {
  request: RuntimeTurnRequest;
  fallbackMode: TurnRouteDecision["executionMode"];
  policyMode: TurnRouteDecision["mode"];
  availableKnowledge: boolean;
  availableWeb: boolean;
  ordinarySourcePriorityMode: OrdinarySourcePriorityMode;
  productKnowledgeIntent: boolean;
  skillState: RuntimeSkillDecisionState | null;
  selectedSkillIds: string[];
};

export function isProjectChatMode(request: RuntimeTurnRequest): boolean {
  return request.chatMode === "project";
}

export function hasProjectDocumentContext(request: RuntimeTurnRequest): boolean {
  return request.message.attachments.some(
    (attachment) =>
      attachment.kind === "file" &&
      (attachment.mimeType.toLowerCase() === "application/pdf" ||
        (typeof attachment.fileRef === "string" && attachment.fileRef.trim().length > 0) ||
        attachment.objectKey.trim().length > 0)
  );
}

export const PROJECT_EXECUTION_DEVELOPER_CONTRACT = [
  "## Project execution contract",
  "This turn runs in project analysis mode. Work in bounded staged passes inside the existing native tool loop:",
  "1. plan — understand the request, list relevant project files, Skill packs, KB sources, and whether web/browser is needed; keep the internal plan concise.",
  "2. gather — read project files with the files tool when needed, run knowledge_search then knowledge_fetch for exact excerpts, and use web/browser when the current local context does not directly answer the user's real task.",
  "3. analyze — compare requirements, documents, norms, and assumptions; note conflicts, omissions, ambiguities, and outdated references.",
  "4. replan — only when material gaps remain; gather missing sources or narrower file sections within the plan tool budgets.",
  "5. synthesize — deliver the final user-facing answer with sources cited, confidence stated, and residual gaps called out.",
  "Do not expose raw hidden chain-of-thought. Prefer orchestrated retrieval context when present, then tools for follow-up lookup. Respect per-turn tool caps and loop limits from the effective plan.",
  "One local file or one retrieved excerpt is not proof of sufficiency. If the current context is procedural, partial, outdated, or off-target for the actual engineering/business question, continue with narrower follow-up lookup or external verification instead of synthesizing early."
].join("\n");

export function buildProjectModePrecheckDecision(input: ProjectPrecheckInput): CreateDecisionInput {
  const hasDocumentContext = hasProjectDocumentContext(input.request);
  const useSkills =
    input.selectedSkillIds.length > 0 &&
    input.skillState?.status === "active" &&
    typeof input.skillState.activeSkillId === "string" &&
    input.skillState.activeSkillId.trim().length > 0;
  const useUserKnowledge = input.availableKnowledge;
  const useProductKnowledge = input.availableKnowledge && input.productKnowledgeIntent;
  const useWeb = input.availableWeb;
  const retrievalPlan: TurnRetrievalPlan = {
    useSkills,
    selectedSkillIds: useSkills ? input.selectedSkillIds : [],
    useUserKnowledge,
    useProductKnowledge,
    useWeb,
    ordinarySourcePriorityMode: useSkills ? "not_applicable" : input.ordinarySourcePriorityMode,
    confidence: hasDocumentContext ? "high" : "medium",
    reasonCode: hasDocumentContext ? "project_mode_document_context" : "project_mode"
  };

  const deepMode = input.request.deepMode === true;
  const level: RoutingLevel = deepMode ? "deep" : "heavy";

  return {
    level,
    retrievalHint: useUserKnowledge || useProductKnowledge || useSkills,
    toolHints:
      useUserKnowledge || useProductKnowledge || useSkills ? "knowledge" : useWeb ? "web" : "none",
    confidence: "high",
    clarifyNeeded: false,
    fallbackMode: input.fallbackMode,
    reasonCode: retrievalPlan.reasonCode,
    retrievalPlan,
    source: "precheck",
    mode: input.policyMode,
    usage: null,
    skillState: input.skillState
  };
}

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

export function createProjectModePostRetrievalStreamEvents(input: {
  identity: ProjectStreamIdentity;
  retrievedItemCount: number;
  retrievalSourceCount: number;
}): RuntimeTurnStreamEvent[] {
  const detail =
    input.retrievedItemCount > 0
      ? `Loaded ${String(input.retrievedItemCount)} grounded excerpt(s) across ${String(input.retrievalSourceCount)} source class(es).`
      : "No direct grounded excerpt yet; keep gathering narrower local or external sources.";
  return [
    {
      type: "project_reasoning_summary",
      requestId: input.identity.requestId,
      sessionId: input.identity.sessionId,
      kind: "check",
      summary:
        input.retrievedItemCount > 0
          ? "Checking whether the gathered context actually answers the task."
          : "Local context is still thin, so the search may need to expand.",
      detail,
      ...(input.retrievedItemCount > 0
        ? {}
        : { sourceClass: "knowledge" as const, resultCount: input.retrievedItemCount })
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
