export type PersaiGlobalKnowledgeDocument = {
  referenceId: string;
  title: string;
  locator: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
};

export const PERSAI_GLOBAL_KNOWLEDGE_DOCUMENTS: PersaiGlobalKnowledgeDocument[] = [
  {
    referenceId: "global:product:overview",
    title: "PersAI Product Overview",
    locator: "product:overview",
    content: `PersAI is a SaaS platform for personal AI assistants. Each user gets a persistent assistant that can be configured, published, updated, reset, and used across supported surfaces instead of starting every chat from zero. The assistant is treated as a governed product entity with lifecycle, memory policy, tool policy, channels, quotas, runtime state, and admin visibility. PersAI is assistant-first, multi-surface, tools-capable, memory-aware, and operationally manageable rather than a thin chat wrapper over a single model prompt.`,
    metadata: {
      scope: "product",
      kind: "overview"
    }
  },
  {
    referenceId: "global:product:principles",
    title: "PersAI Product Principles",
    locator: "product:principles",
    content: `PersAI follows a draft-and-publish lifecycle instead of uncontrolled live prompt mutation. The platform keeps backend-first governance for lifecycle, ownership, quotas, secrets, rollout, audit, and admin operations while the runtime handles behavior execution and conversational flow. The product is designed to feel human and continuous without hiding important system truth such as publish/apply status, memory controls, quota boundaries, reset semantics, and meaningful degradation. Supported product surfaces currently center on web control, web chat, and Telegram, with future channel expansion planned.`,
    metadata: {
      scope: "product",
      kind: "principles"
    }
  }
];
