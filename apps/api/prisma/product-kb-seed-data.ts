export type ProductKbSeedTextEntry = {
  key: string;
  title: string;
  body: string;
  category: string;
  locale: string;
  tags: string[];
  locator: string;
};

export const PRODUCT_KB_SEED_TEXT_ENTRIES: ProductKbSeedTextEntry[] = [
  {
    key: "persai-product-overview",
    title: "PersAI Product Overview",
    body: "PersAI is a SaaS platform for personal AI assistants. Each user gets a persistent assistant that can be configured, published, updated, reset, and used across supported surfaces instead of starting every chat from zero. The assistant is treated as a governed product entity with lifecycle, memory policy, tool policy, channels, quotas, runtime state, and admin visibility. PersAI is assistant-first, multi-surface, tools-capable, memory-aware, and operationally manageable rather than a thin chat wrapper over a single model prompt.",
    category: "product_baseline",
    locale: "en-US",
    tags: ["product", "overview", "baseline"],
    locator: "product-kb:overview"
  },
  {
    key: "persai-product-principles",
    title: "PersAI Product Principles",
    body: "PersAI follows a draft-and-publish lifecycle instead of uncontrolled live prompt mutation. The platform keeps backend-first governance for lifecycle, ownership, quotas, secrets, rollout, audit, and admin operations while the runtime handles behavior execution and conversational flow. The product is designed to feel human and continuous without hiding important system truth such as publish/apply status, memory controls, quota boundaries, reset semantics, and meaningful degradation. Supported product surfaces currently center on web control, web chat, and Telegram, with future channel expansion planned.",
    category: "product_baseline",
    locale: "en-US",
    tags: ["product", "principles", "baseline"],
    locator: "product-kb:principles"
  }
];
