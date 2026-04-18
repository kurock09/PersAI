import assert from "node:assert/strict";
import { ReadAssistantKnowledgeService } from "../src/modules/workspace-management/application/read-assistant-knowledge.service";

type KnowledgeChunkRow = {
  assistantId: string;
  knowledgeSourceId: string;
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  knowledgeSource: {
    id: string;
    assistantId: string;
    namespace: "assistant_user_workspace";
    status: "ready" | "processing";
    displayName: string | null;
    originalFilename: string;
    mimeType: string;
  };
};

type GlobalKnowledgeChunkRow = {
  workspaceId: string;
  globalKnowledgeSourceId: string;
  scope: "product" | "skill";
  sourceVersion: number;
  chunkIndex: number;
  locator: string | null;
  content: string;
  embeddingModelKey: string | null;
  embeddingVector: unknown;
  globalKnowledgeSource: {
    id: string;
    workspaceId: string;
    status: "ready" | "processing";
    displayName: string | null;
    originalFilename: string;
    mimeType: string;
  };
};

type MemoryRegistryRow = {
  id: string;
  assistantId: string;
  chatId: string | null;
  relatedUserMessageId: string | null;
  relatedAssistantMessageId: string | null;
  summary: string;
  sourceType: "web_chat" | "memory_write";
  sourceLabel: string | null;
  createdAt: Date;
  forgottenAt: Date | null;
};

type ChatMessageRow = {
  id: string;
  chatId: string;
  assistantId: string;
  author: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
  chat: {
    id: string;
    surface: "web" | "telegram";
    surfaceThreadKey: string;
    title: string | null;
    archivedAt: Date | null;
  };
};

type AssistantRow = {
  id: string;
  userId: string;
  workspaceId: string;
  applyAppliedVersionId: string | null;
  governance: {
    assistantPlanOverrideCode: string | null;
    quotaPlanCode: string | null;
  } | null;
};

type MaterializedPresetRow = {
  assistantId: string;
  publishedVersionId: string;
  layersDocument: string;
  runtimeBundleDocument: string | null;
  createdAt: Date;
};

type BootstrapPresetRow = {
  id: string;
  template: string;
  updatedAt: Date;
};

type PlanCatalogKnowledgeRow = {
  code: string;
  displayName: string;
  description: string | null;
  status: "active" | "inactive";
  isTrialPlan: boolean;
  trialDurationDays: number | null;
  updatedAt: Date;
  entitlement: {
    schemaVersion: number;
    capabilities: unknown;
    toolClasses: unknown;
    channelsAndSurfaces: unknown;
    mediaClasses: unknown;
    limitsPermissions: unknown;
  } | null;
  toolActivations: Array<{
    activationStatus: "active" | "inactive";
    dailyCallLimit: number | null;
    tool: {
      code: string;
      displayName: string;
      description: string | null;
      toolClass: string;
      capabilityGroup: string;
    };
  }>;
  isDefaultFirstRegistrationPlan?: boolean;
};

type ToolCatalogKnowledgeRow = {
  code: string;
  displayName: string;
  description: string | null;
  toolClass: string;
  capabilityGroup: string;
  status: "active" | "inactive";
  updatedAt: Date;
};

type WorkspaceSubscriptionKnowledgeRow = {
  workspaceId: string;
  planCode: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
};

const rows: KnowledgeChunkRow[] = [
  {
    assistantId: "assistant-1",
    knowledgeSourceId: "source-1",
    sourceVersion: 1,
    chunkIndex: 0,
    locator: "p1",
    content: "PersAI pricing overview for product positioning and quota explanations.",
    knowledgeSource: {
      id: "source-1",
      assistantId: "assistant-1",
      namespace: "assistant_user_workspace",
      status: "ready",
      displayName: "Pricing Notes",
      originalFilename: "pricing.txt",
      mimeType: "text/plain"
    }
  },
  {
    assistantId: "assistant-1",
    knowledgeSourceId: "source-1",
    sourceVersion: 1,
    chunkIndex: 1,
    locator: "p2",
    content:
      "Quota limits stay separate for media uploads and knowledge storage so billing stays predictable.",
    knowledgeSource: {
      id: "source-1",
      assistantId: "assistant-1",
      namespace: "assistant_user_workspace",
      status: "ready",
      displayName: "Pricing Notes",
      originalFilename: "pricing.txt",
      mimeType: "text/plain"
    }
  },
  {
    assistantId: "assistant-1",
    knowledgeSourceId: "source-2",
    sourceVersion: 1,
    chunkIndex: 0,
    locator: "sec-1",
    content: "Reset assistant removes uploaded knowledge sources and durable memory facts.",
    knowledgeSource: {
      id: "source-2",
      assistantId: "assistant-1",
      namespace: "assistant_user_workspace",
      status: "ready",
      displayName: null,
      originalFilename: "reset-policy.md",
      mimeType: "text/markdown"
    }
  },
  {
    assistantId: "assistant-1",
    knowledgeSourceId: "source-3",
    sourceVersion: 1,
    chunkIndex: 0,
    locator: "draft-1",
    content: "This processing row should not be searchable.",
    knowledgeSource: {
      id: "source-3",
      assistantId: "assistant-1",
      namespace: "assistant_user_workspace",
      status: "processing",
      displayName: "Draft",
      originalFilename: "draft.txt",
      mimeType: "text/plain"
    }
  },
  {
    assistantId: "assistant-1",
    knowledgeSourceId: "source-4",
    sourceVersion: 1,
    chunkIndex: 0,
    locator: "appendix",
    content:
      "Appendix pricing briefing repeats the same pricing note over and over so ranking should prefer the concise Pricing Notes source for the same query.",
    knowledgeSource: {
      id: "source-4",
      assistantId: "assistant-1",
      namespace: "assistant_user_workspace",
      status: "ready",
      displayName: "Misc Appendix",
      originalFilename: "appendix-pricing.txt",
      mimeType: "text/plain"
    }
  },
  {
    assistantId: "assistant-1",
    knowledgeSourceId: "source-4",
    sourceVersion: 1,
    chunkIndex: 1,
    locator: "appendix",
    content:
      "Appendix pricing briefing repeats the same pricing note over and over so ranking should prefer the concise Pricing Notes source for the same query.",
    knowledgeSource: {
      id: "source-4",
      assistantId: "assistant-1",
      namespace: "assistant_user_workspace",
      status: "ready",
      displayName: "Misc Appendix",
      originalFilename: "appendix-pricing.txt",
      mimeType: "text/plain"
    }
  }
];

const globalKnowledgeRows: GlobalKnowledgeChunkRow[] = [
  {
    workspaceId: "workspace-1",
    globalKnowledgeSourceId: "global-source-1",
    scope: "skill",
    sourceVersion: 1,
    chunkIndex: 0,
    locator: "sync-guide#1",
    content: "Connector sync cadence keeps uploaded skill knowledge fresh across reindex runs.",
    embeddingModelKey: null,
    embeddingVector: null,
    globalKnowledgeSource: {
      id: "global-source-1",
      workspaceId: "workspace-1",
      status: "ready",
      displayName: "Skill Sync Guide",
      originalFilename: "skill-sync-guide.md",
      mimeType: "text/markdown"
    }
  },
  {
    workspaceId: "workspace-1",
    globalKnowledgeSourceId: "global-source-1",
    scope: "skill",
    sourceVersion: 1,
    chunkIndex: 1,
    locator: "sync-guide#2",
    content:
      "Admins can upload skill knowledge and trigger reindex when connector configuration changes.",
    embeddingModelKey: null,
    embeddingVector: null,
    globalKnowledgeSource: {
      id: "global-source-1",
      workspaceId: "workspace-1",
      status: "ready",
      displayName: "Skill Sync Guide",
      originalFilename: "skill-sync-guide.md",
      mimeType: "text/markdown"
    }
  }
];

const memoryRows: MemoryRegistryRow[] = [
  {
    id: "memory-1",
    assistantId: "assistant-1",
    chatId: null,
    relatedUserMessageId: null,
    relatedAssistantMessageId: null,
    summary: "User prefers concise answers and short bullet lists.",
    sourceType: "memory_write",
    sourceLabel: "Memory write: preference",
    createdAt: new Date("2026-04-14T18:45:00.000Z"),
    forgottenAt: null
  },
  {
    id: "memory-2",
    assistantId: "assistant-1",
    chatId: "chat-1",
    relatedUserMessageId: "message-1",
    relatedAssistantMessageId: null,
    summary: "Billing contact discussed annual quota limits in a previous web chat.",
    sourceType: "web_chat",
    sourceLabel: "Web chat",
    createdAt: new Date("2026-04-14T17:00:00.000Z"),
    forgottenAt: null
  },
  {
    id: "memory-3",
    assistantId: "assistant-1",
    chatId: "chat-3",
    relatedUserMessageId: "message-6",
    relatedAssistantMessageId: null,
    summary:
      "Renewal notes need a quota explanation that separates knowledge storage from media uploads.",
    sourceType: "web_chat",
    sourceLabel: "Renewal notes",
    createdAt: new Date("2026-04-14T19:15:00.000Z"),
    forgottenAt: null
  }
];

const chatRows: ChatMessageRow[] = [
  {
    id: "message-1",
    chatId: "chat-1",
    assistantId: "assistant-1",
    author: "user",
    content: "We should explain PersAI quota limits to enterprise customers.",
    createdAt: new Date("2026-04-14T10:00:00.000Z"),
    chat: {
      id: "chat-1",
      surface: "web",
      surfaceThreadKey: "thread-1",
      title: "Billing follow-up",
      archivedAt: null
    }
  },
  {
    id: "message-2",
    chatId: "chat-1",
    assistantId: "assistant-1",
    author: "assistant",
    content: "Annual billing keeps media uploads and knowledge storage quotas separate.",
    createdAt: new Date("2026-04-14T10:01:00.000Z"),
    chat: {
      id: "chat-1",
      surface: "web",
      surfaceThreadKey: "thread-1",
      title: "Billing follow-up",
      archivedAt: null
    }
  },
  {
    id: "message-3",
    chatId: "chat-1",
    assistantId: "assistant-1",
    author: "user",
    content: "Also add onboarding notes for the Telegram owner claim flow.",
    createdAt: new Date("2026-04-14T10:02:00.000Z"),
    chat: {
      id: "chat-1",
      surface: "web",
      surfaceThreadKey: "thread-1",
      title: "Billing follow-up",
      archivedAt: null
    }
  },
  {
    id: "message-4",
    chatId: "chat-1",
    assistantId: "assistant-1",
    author: "assistant",
    content: "I can reuse the Telegram onboarding checklist from our previous rollout.",
    createdAt: new Date("2026-04-14T10:03:00.000Z"),
    chat: {
      id: "chat-1",
      surface: "web",
      surfaceThreadKey: "thread-1",
      title: "Billing follow-up",
      archivedAt: null
    }
  },
  {
    id: "message-5",
    chatId: "chat-2",
    assistantId: "assistant-1",
    author: "user",
    content: "The Gazprom PDF OCR summary looked good in Telegram.",
    createdAt: new Date("2026-04-13T09:00:00.000Z"),
    chat: {
      id: "chat-2",
      surface: "telegram",
      surfaceThreadKey: "telegram-thread-1",
      title: null,
      archivedAt: new Date("2026-04-13T11:00:00.000Z")
    }
  },
  {
    id: "message-6",
    chatId: "chat-3",
    assistantId: "assistant-1",
    author: "assistant",
    content:
      "Renewal notes: quota explanation should separate knowledge storage from media uploads.",
    createdAt: new Date("2026-04-14T10:04:00.000Z"),
    chat: {
      id: "chat-3",
      surface: "telegram",
      surfaceThreadKey: "telegram-thread-2",
      title: "Renewal notes",
      archivedAt: null
    }
  }
];

const assistantRows: AssistantRow[] = [
  {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    applyAppliedVersionId: "version-1",
    governance: {
      assistantPlanOverrideCode: null,
      quotaPlanCode: "starter"
    }
  }
];

const materializedPresetRows: MaterializedPresetRow[] = [
  {
    assistantId: "assistant-1",
    publishedVersionId: "version-1",
    layersDocument:
      "# SOUL\nAssistant should answer concisely.\n\n# TOOLS\nKnowledge search is available for product and subscription answers.",
    runtimeBundleDocument:
      "runtime.knowledgeAccess exposes document, memory, chat, preset, subscription, and global sources.",
    createdAt: new Date("2026-04-14T12:00:00.000Z")
  }
];

const bootstrapPresetRows: BootstrapPresetRow[] = [
  {
    id: "soul",
    template: "# SOUL.md\n\nYou are {{assistant_name}}.\nRespond with calm concise answers.",
    updatedAt: new Date("2026-04-10T08:00:00.000Z")
  },
  {
    id: "tools",
    template: "# TOOLS.md\n\n{{tools_catalog_block}}",
    updatedAt: new Date("2026-04-10T08:00:00.000Z")
  }
];

const workspaceSubscriptionRows: WorkspaceSubscriptionKnowledgeRow[] = [
  {
    workspaceId: "workspace-1",
    planCode: "pro",
    status: "active",
    trialEndsAt: null,
    currentPeriodEndsAt: new Date("2026-05-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false
  }
];

const planCatalogRows: PlanCatalogKnowledgeRow[] = [
  {
    code: "starter",
    displayName: "Starter",
    description: "Entry plan for lightweight personal assistant usage.",
    status: "active",
    isTrialPlan: true,
    trialDurationDays: 14,
    updatedAt: new Date("2026-04-12T09:00:00.000Z"),
    isDefaultFirstRegistrationPlan: true,
    entitlement: {
      schemaVersion: 1,
      capabilities: [{ key: "assistant_memory", allowed: true }],
      toolClasses: [{ key: "utility", allowed: true }],
      channelsAndSurfaces: [{ key: "web_chat", allowed: true }],
      mediaClasses: [],
      limitsPermissions: [{ key: "knowledge_storage_bytes", limit: 10485760 }]
    },
    toolActivations: [
      {
        activationStatus: "active",
        dailyCallLimit: null,
        tool: {
          code: "web_search",
          displayName: "Web Search",
          description: "Provider-backed external web lookup tool.",
          toolClass: "cost_driving",
          capabilityGroup: "knowledge"
        }
      }
    ]
  },
  {
    code: "pro",
    displayName: "Pro",
    description: "Paid plan for broader tool access and larger assistant knowledge usage.",
    status: "active",
    isTrialPlan: false,
    trialDurationDays: null,
    updatedAt: new Date("2026-04-14T09:00:00.000Z"),
    entitlement: {
      schemaVersion: 1,
      capabilities: [
        { key: "assistant_memory", allowed: true },
        { key: "assistant_knowledge", allowed: true }
      ],
      toolClasses: [
        { key: "utility", allowed: true },
        { key: "cost_driving", allowed: true }
      ],
      channelsAndSurfaces: [
        { key: "web_chat", allowed: true },
        { key: "telegram", allowed: true }
      ],
      mediaClasses: [{ key: "image_generation", allowed: true }],
      limitsPermissions: [
        { key: "knowledge_storage_bytes", limit: 1073741824 },
        { key: "active_web_chats", limit: 20 }
      ]
    },
    toolActivations: [
      {
        activationStatus: "active",
        dailyCallLimit: 40,
        tool: {
          code: "web_search",
          displayName: "Web Search",
          description: "Provider-backed external web lookup tool.",
          toolClass: "cost_driving",
          capabilityGroup: "knowledge"
        }
      },
      {
        activationStatus: "active",
        dailyCallLimit: 20,
        tool: {
          code: "browser",
          displayName: "Browser",
          description: "Interactive browser access for complex pages.",
          toolClass: "cost_driving",
          capabilityGroup: "knowledge"
        }
      },
      {
        activationStatus: "active",
        dailyCallLimit: null,
        tool: {
          code: "scheduled_action",
          displayName: "Scheduled Action",
          description: "Schedule reminders and assistant follow-ups.",
          toolClass: "utility",
          capabilityGroup: "workspace_ops"
        }
      }
    ]
  }
];

const toolCatalogRows: ToolCatalogKnowledgeRow[] = [
  {
    code: "web_search",
    displayName: "Web Search",
    description: "Provider-backed external web lookup tool.",
    toolClass: "cost_driving",
    capabilityGroup: "knowledge",
    status: "active",
    updatedAt: new Date("2026-04-14T09:00:00.000Z")
  },
  {
    code: "browser",
    displayName: "Browser",
    description: "Automated browser for interactive page navigation and extraction.",
    toolClass: "cost_driving",
    capabilityGroup: "knowledge",
    status: "active",
    updatedAt: new Date("2026-04-14T09:00:00.000Z")
  },
  {
    code: "scheduled_action",
    displayName: "Scheduled Action",
    description: "Schedule reminders and hidden assistant follow-ups.",
    toolClass: "utility",
    capabilityGroup: "workspace_ops",
    status: "active",
    updatedAt: new Date("2026-04-14T09:00:00.000Z")
  }
];

function containsInsensitive(content: string, term: string): boolean {
  return content.toLowerCase().includes(term.toLowerCase());
}

function matchesIdPredicate(
  value: string,
  predicate: { equals?: string; lt?: string; gt?: string } | undefined
): boolean {
  if (!predicate) {
    return true;
  }
  if (predicate.equals !== undefined && value !== predicate.equals) {
    return false;
  }
  if (predicate.lt !== undefined && value >= predicate.lt) {
    return false;
  }
  if (predicate.gt !== undefined && value <= predicate.gt) {
    return false;
  }
  return true;
}

function matchesDatePredicate(
  value: Date,
  predicate: { equals?: Date; lt?: Date; gt?: Date } | undefined
): boolean {
  if (!predicate) {
    return true;
  }
  if (predicate.equals !== undefined && value.getTime() !== predicate.equals.getTime()) {
    return false;
  }
  if (predicate.lt !== undefined && value.getTime() >= predicate.lt.getTime()) {
    return false;
  }
  if (predicate.gt !== undefined && value.getTime() <= predicate.gt.getTime()) {
    return false;
  }
  return true;
}

function sortChatRows(
  entries: ChatMessageRow[],
  orderBy: Array<{ createdAt?: "asc" | "desc"; id?: "asc" | "desc" }>
): ChatMessageRow[] {
  return [...entries].sort((left, right) => {
    for (const rule of orderBy) {
      if (rule.createdAt) {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        if (diff !== 0) {
          return rule.createdAt === "asc" ? diff : -diff;
        }
      }
      if (rule.id) {
        const diff = left.id.localeCompare(right.id);
        if (diff !== 0) {
          return rule.id === "asc" ? diff : -diff;
        }
      }
    }
    return 0;
  });
}

function sortKnowledgeRows(
  entries: KnowledgeChunkRow[],
  orderBy: Array<{
    knowledgeSourceId?: "asc" | "desc";
    sourceVersion?: "asc" | "desc";
    chunkIndex?: "asc" | "desc";
  }>
): KnowledgeChunkRow[] {
  return [...entries].sort((left, right) => {
    for (const rule of orderBy) {
      if (rule.knowledgeSourceId) {
        const diff = left.knowledgeSourceId.localeCompare(right.knowledgeSourceId);
        if (diff !== 0) {
          return rule.knowledgeSourceId === "asc" ? diff : -diff;
        }
      }
      if (rule.sourceVersion) {
        const diff = left.sourceVersion - right.sourceVersion;
        if (diff !== 0) {
          return rule.sourceVersion === "asc" ? diff : -diff;
        }
      }
      if (rule.chunkIndex) {
        const diff = left.chunkIndex - right.chunkIndex;
        if (diff !== 0) {
          return rule.chunkIndex === "asc" ? diff : -diff;
        }
      }
    }
    return 0;
  });
}

function sortGlobalKnowledgeRows(
  entries: GlobalKnowledgeChunkRow[],
  orderBy: Array<{
    globalKnowledgeSourceId?: "asc" | "desc";
    sourceVersion?: "asc" | "desc";
    chunkIndex?: "asc" | "desc";
  }>
): GlobalKnowledgeChunkRow[] {
  return [...entries].sort((left, right) => {
    for (const rule of orderBy) {
      if (rule.globalKnowledgeSourceId) {
        const diff = left.globalKnowledgeSourceId.localeCompare(right.globalKnowledgeSourceId);
        if (diff !== 0) {
          return rule.globalKnowledgeSourceId === "asc" ? diff : -diff;
        }
      }
      if (rule.sourceVersion) {
        const diff = left.sourceVersion - right.sourceVersion;
        if (diff !== 0) {
          return rule.sourceVersion === "asc" ? diff : -diff;
        }
      }
      if (rule.chunkIndex) {
        const diff = left.chunkIndex - right.chunkIndex;
        if (diff !== 0) {
          return rule.chunkIndex === "asc" ? diff : -diff;
        }
      }
    }
    return 0;
  });
}

function sortMemoryRows(
  entries: MemoryRegistryRow[],
  orderBy: Array<{ createdAt?: "asc" | "desc"; id?: "asc" | "desc" }>
): MemoryRegistryRow[] {
  return [...entries].sort((left, right) => {
    for (const rule of orderBy) {
      if (rule.createdAt) {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        if (diff !== 0) {
          return rule.createdAt === "asc" ? diff : -diff;
        }
      }
      if (rule.id) {
        const diff = left.id.localeCompare(right.id);
        if (diff !== 0) {
          return rule.id === "asc" ? diff : -diff;
        }
      }
    }
    return 0;
  });
}

async function run(): Promise<void> {
  const prisma = {
    assistantKnowledgeSourceChunk: {
      findMany: async ({
        where,
        take,
        orderBy
      }: {
        where: Record<string, unknown>;
        take?: number;
        orderBy?: Array<{
          knowledgeSourceId?: "asc" | "desc";
          sourceVersion?: "asc" | "desc";
          chunkIndex?: "asc" | "desc";
        }>;
      }) => {
        const filtered = rows.filter((row) => {
          if (row.assistantId !== where.assistantId) {
            return false;
          }
          const sourceWhere = where.knowledgeSource as Record<string, unknown> | undefined;
          if (sourceWhere) {
            if (row.knowledgeSource.assistantId !== sourceWhere.assistantId) {
              return false;
            }
            if (row.knowledgeSource.namespace !== sourceWhere.namespace) {
              return false;
            }
            if (row.knowledgeSource.status !== sourceWhere.status) {
              return false;
            }
          }
          if (where.knowledgeSourceId && row.knowledgeSourceId !== where.knowledgeSourceId) {
            return false;
          }
          if (where.sourceVersion && row.sourceVersion !== where.sourceVersion) {
            return false;
          }
          if (typeof where.chunkIndex === "number" && row.chunkIndex !== where.chunkIndex) {
            return false;
          }
          if (
            where.chunkIndex &&
            typeof where.chunkIndex === "object" &&
            where.chunkIndex !== null &&
            ("gte" in where.chunkIndex || "lte" in where.chunkIndex)
          ) {
            const bounds = where.chunkIndex as { gte?: number; lte?: number };
            if (bounds.gte !== undefined && row.chunkIndex < bounds.gte) {
              return false;
            }
            if (bounds.lte !== undefined && row.chunkIndex > bounds.lte) {
              return false;
            }
          }
          if (Array.isArray(where.OR)) {
            return where.OR.some((entry) => {
              const contentWhere = (entry as { content?: { contains?: string } }).content;
              if (typeof contentWhere?.contains === "string") {
                return containsInsensitive(row.content, contentWhere.contains);
              }

              const locatorWhere = (entry as { locator?: { contains?: string } }).locator;
              return typeof locatorWhere?.contains === "string" && row.locator !== null
                ? containsInsensitive(row.locator, locatorWhere.contains)
                : false;
            });
          }
          return true;
        });
        const sorted = Array.isArray(orderBy) ? sortKnowledgeRows(filtered, orderBy) : filtered;
        return typeof take === "number" ? sorted.slice(0, take) : sorted;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) => {
          if (row.assistantId !== where.assistantId) {
            return false;
          }
          if (row.knowledgeSourceId !== where.knowledgeSourceId) {
            return false;
          }
          if (row.sourceVersion !== where.sourceVersion) {
            return false;
          }
          if (row.chunkIndex !== where.chunkIndex) {
            return false;
          }
          const sourceWhere = where.knowledgeSource as Record<string, unknown> | undefined;
          if (!sourceWhere) {
            return true;
          }
          return (
            row.knowledgeSource.assistantId === sourceWhere.assistantId &&
            row.knowledgeSource.namespace === sourceWhere.namespace &&
            row.knowledgeSource.status === sourceWhere.status
          );
        }) ?? null
    },
    globalKnowledgeSourceChunk: {
      findMany: async ({
        where,
        take,
        orderBy
      }: {
        where: Record<string, unknown>;
        take?: number;
        orderBy?: Array<{
          globalKnowledgeSourceId?: "asc" | "desc";
          sourceVersion?: "asc" | "desc";
          chunkIndex?: "asc" | "desc";
        }>;
      }) => {
        const filtered = globalKnowledgeRows.filter((row) => {
          if (where.workspaceId !== undefined && row.workspaceId !== where.workspaceId) {
            return false;
          }
          if (
            where.globalKnowledgeSourceId !== undefined &&
            row.globalKnowledgeSourceId !== where.globalKnowledgeSourceId
          ) {
            return false;
          }
          if (where.sourceVersion !== undefined && row.sourceVersion !== where.sourceVersion) {
            return false;
          }
          if (
            typeof where.embeddingModelKey === "string" &&
            row.embeddingModelKey !== where.embeddingModelKey
          ) {
            return false;
          }
          if (typeof where.chunkIndex === "number" && row.chunkIndex !== where.chunkIndex) {
            return false;
          }
          if (
            where.chunkIndex &&
            typeof where.chunkIndex === "object" &&
            where.chunkIndex !== null &&
            ("gte" in where.chunkIndex || "lte" in where.chunkIndex)
          ) {
            const bounds = where.chunkIndex as { gte?: number; lte?: number };
            if (bounds.gte !== undefined && row.chunkIndex < bounds.gte) {
              return false;
            }
            if (bounds.lte !== undefined && row.chunkIndex > bounds.lte) {
              return false;
            }
          }
          const sourceWhere = where.globalKnowledgeSource as Record<string, unknown> | undefined;
          if (sourceWhere) {
            if (
              sourceWhere.workspaceId !== undefined &&
              row.globalKnowledgeSource.workspaceId !== sourceWhere.workspaceId
            ) {
              return false;
            }
            if (
              sourceWhere.status !== undefined &&
              row.globalKnowledgeSource.status !== sourceWhere.status
            ) {
              return false;
            }
          }
          if (Array.isArray(where.OR)) {
            return where.OR.some((entry) => {
              const contentWhere = (entry as { content?: { contains?: string } }).content;
              if (typeof contentWhere?.contains === "string") {
                return containsInsensitive(row.content, contentWhere.contains);
              }

              const locatorWhere = (entry as { locator?: { contains?: string } }).locator;
              return typeof locatorWhere?.contains === "string" && row.locator !== null
                ? containsInsensitive(row.locator, locatorWhere.contains)
                : false;
            });
          }
          return true;
        });
        const sorted = Array.isArray(orderBy)
          ? sortGlobalKnowledgeRows(filtered, orderBy)
          : filtered;
        return typeof take === "number" ? sorted.slice(0, take) : sorted;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        globalKnowledgeRows.find((row) => {
          if (where.workspaceId !== undefined && row.workspaceId !== where.workspaceId) {
            return false;
          }
          if (
            where.globalKnowledgeSourceId !== undefined &&
            row.globalKnowledgeSourceId !== where.globalKnowledgeSourceId
          ) {
            return false;
          }
          if (where.sourceVersion !== undefined && row.sourceVersion !== where.sourceVersion) {
            return false;
          }
          if (typeof where.chunkIndex === "number" && row.chunkIndex !== where.chunkIndex) {
            return false;
          }
          const sourceWhere = where.globalKnowledgeSource as Record<string, unknown> | undefined;
          if (!sourceWhere) {
            return true;
          }
          if (
            sourceWhere.workspaceId !== undefined &&
            row.globalKnowledgeSource.workspaceId !== sourceWhere.workspaceId
          ) {
            return false;
          }
          if (
            sourceWhere.status !== undefined &&
            row.globalKnowledgeSource.status !== sourceWhere.status
          ) {
            return false;
          }
          return true;
        }) ?? null
    },
    assistantMemoryRegistryItem: {
      findMany: async ({
        where,
        take,
        orderBy
      }: {
        where: Record<string, unknown>;
        take?: number;
        orderBy?: Array<{ createdAt?: "asc" | "desc"; id?: "asc" | "desc" }>;
      }) => {
        const filtered = memoryRows.filter((row) => {
          if (row.assistantId !== where.assistantId) {
            return false;
          }
          if (row.forgottenAt !== (where.forgottenAt ?? null)) {
            return false;
          }
          if (Array.isArray(where.OR)) {
            return where.OR.some((entry) => {
              const summaryWhere = (entry as { summary?: { contains?: string } }).summary;
              if (typeof summaryWhere?.contains === "string") {
                return containsInsensitive(row.summary, summaryWhere.contains);
              }

              const sourceLabelWhere = (entry as { sourceLabel?: { contains?: string } })
                .sourceLabel;
              return typeof sourceLabelWhere?.contains === "string" && row.sourceLabel !== null
                ? containsInsensitive(row.sourceLabel, sourceLabelWhere.contains)
                : false;
            });
          }
          return true;
        });
        const sorted = Array.isArray(orderBy) ? sortMemoryRows(filtered, orderBy) : filtered;
        return typeof take === "number" ? sorted.slice(0, take) : sorted;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        memoryRows.find((row) => {
          return (
            row.id === where.id &&
            row.assistantId === where.assistantId &&
            row.forgottenAt === (where.forgottenAt ?? null)
          );
        }) ?? null
    },
    assistantChatMessage: {
      findMany: async ({
        where,
        take,
        orderBy
      }: {
        where: Record<string, unknown>;
        take?: number;
        orderBy?: Array<{ createdAt?: "asc" | "desc"; id?: "asc" | "desc" }>;
      }) => {
        const filtered = chatRows.filter((row) => {
          if (row.assistantId !== where.assistantId) {
            return false;
          }
          if (where.chatId !== undefined && row.chatId !== where.chatId) {
            return false;
          }
          const authorWhere = where.author as { in?: string[] } | undefined;
          if (Array.isArray(authorWhere?.in) && !authorWhere.in.includes(row.author)) {
            return false;
          }
          if (Array.isArray(where.OR)) {
            return where.OR.some((entry) => {
              const contentWhere = (entry as { content?: { contains?: string } }).content;
              if (typeof contentWhere?.contains === "string") {
                return containsInsensitive(row.content, contentWhere.contains);
              }

              const createdAtWhere = (
                entry as { createdAt?: { equals?: Date; lt?: Date; gt?: Date } }
              ).createdAt;
              const idWhere = (entry as { id?: { equals?: string; lt?: string; gt?: string } }).id;
              return (
                matchesDatePredicate(row.createdAt, createdAtWhere) &&
                matchesIdPredicate(row.id, idWhere)
              );
            });
          }
          return true;
        });
        const sorted = Array.isArray(orderBy) ? sortChatRows(filtered, orderBy) : filtered;
        return typeof take === "number" ? sorted.slice(0, take) : sorted;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        chatRows.find((row) => {
          if (row.assistantId !== where.assistantId) {
            return false;
          }
          if (where.chatId !== undefined && row.chatId !== where.chatId) {
            return false;
          }
          if (where.id !== undefined && row.id !== where.id) {
            return false;
          }
          const authorWhere = where.author as { in?: string[] } | undefined;
          if (Array.isArray(authorWhere?.in) && !authorWhere.in.includes(row.author)) {
            return false;
          }
          return true;
        }) ?? null
    },
    assistant: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        assistantRows.find((row) => row.id === where.id) ?? null
    },
    assistantMaterializedSpec: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        materializedPresetRows.find((row) => {
          return (
            row.assistantId === where.assistantId &&
            row.publishedVersionId === where.publishedVersionId
          );
        }) ?? null
    },
    promptTemplate: {
      findMany: async () => bootstrapPresetRows
    },
    workspaceSubscription: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        workspaceSubscriptionRows.find((row) => row.workspaceId === where.workspaceId) ?? null
    },
    planCatalogPlan: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        planCatalogRows.find((row) => {
          if (where.code !== undefined) {
            return row.code === where.code;
          }
          if (where.isDefaultFirstRegistrationPlan !== undefined) {
            return (
              row.isDefaultFirstRegistrationPlan === where.isDefaultFirstRegistrationPlan &&
              row.status === where.status
            );
          }
          return false;
        }) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        planCatalogRows.filter((row) => {
          if (where.status !== undefined) {
            return row.status === where.status;
          }
          return true;
        })
    },
    toolCatalogTool: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        toolCatalogRows.filter((row) => {
          if (where.status !== undefined) {
            return row.status === where.status;
          }
          return true;
        })
    }
  };

  const service = new ReadAssistantKnowledgeService(
    prisma as never,
    {
      generateEmbeddings: async () => [null]
    } as never,
    {
      resolveAssistantEmbeddingModelKey: async () => null,
      resolveAssistantRetrievalModelKey: async () => null,
      resolveAssistantRetrievalPolicy: async () => ({
        defaultMaxResults: 5,
        maxMaxResults: 8,
        lexicalCandidateLimit: 60,
        vectorCandidateLimit: 240,
        knowledgeFetchWindowRadius: 1,
        chatFetchWindowRadius: 2,
        fetchMaxChars: 6000,
        helperEnabled: true,
        helperCandidateLimit: 6,
        helperMaxOutputTokens: 220,
        embeddingSearchEnabled: true
      })
    } as never,
    {
      rerankCandidates: async () => null
    } as never,
    {
      recordSearch: async () => undefined,
      recordFetch: async () => undefined
    } as never
  );

  const hits = await service.searchDocuments({
    assistantId: "assistant-1",
    query: "quota pricing",
    maxResults: 3
  });
  assert.ok(hits.length >= 2);
  assert.equal(hits[0]?.source, "document");
  assert.equal(hits[0]?.referenceId, "source-1:1:0");
  assert.equal(hits[0]?.title, "Pricing Notes");
  assert.ok((hits[0]?.snippet ?? "").toLowerCase().includes("quota"));

  const titleBoostHits = await service.searchDocuments({
    assistantId: "assistant-1",
    query: "pricing notes",
    maxResults: 2
  });
  assert.equal(titleBoostHits[0]?.referenceId, "source-1:1:0");

  const dedupedAppendixHits = await service.searchDocuments({
    assistantId: "assistant-1",
    query: "appendix pricing",
    maxResults: 3
  });
  assert.equal(
    dedupedAppendixHits.filter(
      (hit) =>
        (hit.metadata as { knowledgeSourceId?: string } | null)?.knowledgeSourceId === "source-4"
    ).length,
    1
  );

  const fetched = await service.fetchDocument({
    assistantId: "assistant-1",
    referenceId: "source-1:1:1"
  });
  assert.ok(fetched);
  assert.equal(fetched?.source, "document");
  assert.equal(fetched?.title, "Pricing Notes");
  assert.ok((fetched?.content ?? "").includes("PersAI pricing overview"));
  assert.ok((fetched?.content ?? "").includes("knowledge storage"));

  const memoryHits = await service.search({
    assistantId: "assistant-1",
    source: "memory",
    query: "concise answers",
    maxResults: 2
  });
  assert.equal(memoryHits.length, 1);
  assert.equal(memoryHits[0]?.source, "memory");
  assert.equal(memoryHits[0]?.referenceId, "memory:memory-1");
  assert.equal(memoryHits[0]?.title, "Memory write: preference");

  const recentMemoryHits = await service.search({
    assistantId: "assistant-1",
    source: "memory",
    query: "quota explanation",
    maxResults: 3
  });
  assert.equal(recentMemoryHits[0]?.referenceId, "memory:memory-3");

  const memoryFetched = await service.fetch({
    assistantId: "assistant-1",
    source: "memory",
    referenceId: "memory:memory-1"
  });
  assert.equal(memoryFetched?.source, "memory");
  assert.equal(memoryFetched?.content, "User prefers concise answers and short bullet lists.");

  const chatHits = await service.search({
    assistantId: "assistant-1",
    source: "chat",
    query: "knowledge storage quotas",
    maxResults: 2
  });
  assert.ok(chatHits.length >= 1);
  assert.equal(chatHits[0]?.source, "chat");
  assert.equal(chatHits[0]?.referenceId, "chat:chat-1:message:message-2");
  assert.equal(chatHits[0]?.title, "Billing follow-up");
  assert.equal(chatHits[0]?.locator, "chat:chat-1#message:message-2");

  const recentChatHits = await service.search({
    assistantId: "assistant-1",
    source: "chat",
    query: "quota explanation",
    maxResults: 3
  });
  assert.equal(recentChatHits[0]?.referenceId, "chat:chat-3:message:message-6");

  const telegramChatHits = await service.search({
    assistantId: "assistant-1",
    source: "chat",
    query: "gazprom pdf",
    maxResults: 2
  });
  assert.equal(telegramChatHits[0]?.title, "Telegram chat");

  const chatFetched = await service.fetch({
    assistantId: "assistant-1",
    source: "chat",
    referenceId: "chat:chat-1:message:message-2"
  });
  assert.equal(chatFetched?.source, "chat");
  assert.ok((chatFetched?.content ?? "").includes("User: We should explain PersAI quota limits"));
  assert.ok(
    (chatFetched?.content ?? "").includes(
      "Assistant: Annual billing keeps media uploads and knowledge storage quotas separate."
    )
  );
  assert.ok((chatFetched?.content ?? "").includes("Telegram owner claim flow"));

  const presetHits = await service.search({
    assistantId: "assistant-1",
    source: "preset",
    query: "knowledge search product answers",
    maxResults: 3
  });
  assert.equal(presetHits[0]?.source, "preset");
  assert.equal(presetHits[0]?.referenceId, "preset:current:layers");

  const presetFetched = await service.fetch({
    assistantId: "assistant-1",
    source: "preset",
    referenceId: "preset:current:runtime-bundle"
  });
  assert.equal(presetFetched?.source, "preset");
  assert.ok((presetFetched?.content ?? "").includes("subscription"));
  assert.ok((presetFetched?.content ?? "").includes("global sources"));

  const subscriptionHits = await service.search({
    assistantId: "assistant-1",
    source: "subscription",
    query: "browser daily limit plan code",
    maxResults: 2
  });
  assert.equal(subscriptionHits[0]?.source, "subscription");
  assert.equal(subscriptionHits[0]?.referenceId, "subscription:current");

  const subscriptionFetched = await service.fetch({
    assistantId: "assistant-1",
    source: "subscription",
    referenceId: "subscription:current"
  });
  assert.equal(subscriptionFetched?.source, "subscription");
  assert.ok((subscriptionFetched?.content ?? "").includes("Plan code: pro"));
  assert.ok((subscriptionFetched?.content ?? "").includes("Browser (browser): active, 20/day"));

  const globalHits = await service.search({
    assistantId: "assistant-1",
    source: "global",
    query: "persistent assistant platform",
    maxResults: 3
  });
  assert.equal(globalHits[0]?.source, "global");
  assert.equal(globalHits[0]?.referenceId, "global:product:overview");

  const globalPlanHits = await service.search({
    assistantId: "assistant-1",
    source: "global",
    query: "knowledge storage larger assistant knowledge",
    maxResults: 3
  });
  assert.equal(
    globalPlanHits.some((hit) => hit.referenceId === "global:plan:pro"),
    true
  );

  const uploadedGlobalHits = await service.search({
    assistantId: "assistant-1",
    source: "global",
    query: "connector sync cadence",
    maxResults: 3
  });
  assert.equal(uploadedGlobalHits[0]?.referenceId, "global-uploaded:global-source-1:1:0");
  assert.equal(uploadedGlobalHits[0]?.title, "Skill Sync Guide");

  const globalFetched = await service.fetch({
    assistantId: "assistant-1",
    source: "global",
    referenceId: "global:tool:browser"
  });
  assert.equal(globalFetched?.source, "global");
  assert.ok((globalFetched?.content ?? "").includes("interactive page navigation"));

  const uploadedGlobalFetched = await service.fetch({
    assistantId: "assistant-1",
    source: "global",
    referenceId: "global-uploaded:global-source-1:1:0"
  });
  assert.equal(uploadedGlobalFetched?.source, "global");
  assert.ok((uploadedGlobalFetched?.content ?? "").includes("Connector sync cadence"));
  assert.ok((uploadedGlobalFetched?.content ?? "").includes("Admins can upload skill knowledge"));

  const missing = await service.fetchDocument({
    assistantId: "assistant-1",
    referenceId: "source-1:9:9"
  });
  assert.equal(missing, null);

  const parsedMemorySearch = service.parseSearchInput({
    assistantId: "assistant-1",
    source: "memory",
    query: "quota"
  });
  assert.equal(parsedMemorySearch.source, "memory");
  const parsedChatSearch = service.parseSearchInput({
    assistantId: "assistant-1",
    source: "chat",
    query: "quota"
  });
  assert.equal(parsedChatSearch.source, "chat");
  const parsedSubscriptionSearch = service.parseSearchInput({
    assistantId: "assistant-1",
    source: "subscription",
    query: "plan"
  });
  assert.equal(parsedSubscriptionSearch.source, "subscription");
  const parsedGlobalFetch = service.parseFetchInput({
    assistantId: "assistant-1",
    source: "global",
    referenceId: "global:product:overview"
  });
  assert.equal(parsedGlobalFetch.source, "global");
  assert.throws(
    () =>
      service.parseSearchInput({
        assistantId: "assistant-1",
        source: "database",
        query: "quota"
      }),
    /Only document, memory, chat, preset, subscription, and global knowledge search/
  );
  assert.throws(
    () =>
      service.parseFetchInput({
        assistantId: "assistant-1",
        source: "database",
        referenceId: "source-1:1:1"
      }),
    /Only document, memory, chat, preset, subscription, and global knowledge fetch/
  );
}

void run();
