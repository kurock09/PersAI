import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  MAX_RUNTIME_BROWSER_MAX_CHARS,
  MAX_RUNTIME_BROWSER_OPERATIONS,
  MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS,
  PERSAI_RUNTIME_BROWSER_OPERATION_KINDS,
  PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES,
  type ProviderGatewayToolDefinition,
  type PersaiRuntimeBrowserProviderId,
  type RuntimeKnowledgeAccessSourceConfig,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";

export interface RuntimeNativeToolProjection {
  tools: ProviderGatewayToolDefinition[];
  knowledgeSearchSources: RuntimeKnowledgeAccessSourceConfig[];
  knowledgeFetchSources: RuntimeKnowledgeAccessSourceConfig[];
}

const WEB_FETCH_MAX_CHARS_CAP = 50_000;
const WEB_SEARCH_MAX_COUNT = 20;
const REMINDER_CONTEXT_MESSAGES_MAX = 10;

export function projectRuntimeNativeTools(
  bundle: AssistantRuntimeBundle,
  options?: { allowModelToolExposure?: boolean }
): RuntimeNativeToolProjection {
  if (options?.allowModelToolExposure === false) {
    return {
      tools: [],
      knowledgeSearchSources: [],
      knowledgeFetchSources: []
    };
  }

  // T15-3a keeps ordinary model-visible knowledge/system-helper families gated off
  // until real PersAI-native executors exist for them.
  const projectedTools: ProviderGatewayToolDefinition[] = [
    createSummarizeContextToolDefinition(bundle),
    createCompactContextToolDefinition(bundle)
  ];
  const webSearchPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "web_search");
  const webSearchCredential = resolveConfiguredCredentialRef(bundle, "web_search");
  if (
    webSearchPolicy !== null &&
    webSearchCredential !== null &&
    supportsCurrentNativeWebSearchProvider(webSearchCredential.providerId ?? null)
  ) {
    projectedTools.push(createWebSearchToolDefinition());
  }
  const webFetchPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "web_fetch");
  const webFetchCredential = resolveConfiguredCredentialRef(bundle, "web_fetch");
  if (webFetchPolicy !== null && webFetchCredential !== null) {
    projectedTools.push(createWebFetchToolDefinition());
  }
  const browserPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "browser", "worker");
  const browserCredential = resolveConfiguredCredentialRef(bundle, "browser");
  if (
    browserPolicy !== null &&
    browserCredential !== null &&
    supportsCurrentNativeBrowserProvider(bundle, browserCredential.providerId ?? null)
  ) {
    projectedTools.push(createBrowserToolDefinition(bundle));
  }
  const scheduledActionPolicy = resolveAllowedModelVisibleToolPolicy(
    bundle,
    "scheduled_action",
    "worker"
  );
  if (scheduledActionPolicy !== null) {
    projectedTools.push(createScheduledActionToolDefinition());
  }

  return {
    tools: projectedTools,
    knowledgeSearchSources: [],
    knowledgeFetchSources: []
  };
}

function createSummarizeContextToolDefinition(
  bundle: AssistantRuntimeBundle
): ProviderGatewayToolDefinition {
  return {
    name: bundle.runtime.sharedCompaction.summarizeToolCode,
    description:
      "Create a concise shared-context summary for the current session without changing later-turn compaction state. Use when the user explicitly asks to summarize earlier context or when you need a temporary summary to continue reasoning.",
    inputSchema: createCompactionInputSchema()
  };
}

function createCompactContextToolDefinition(
  bundle: AssistantRuntimeBundle
): ProviderGatewayToolDefinition {
  return {
    name: bundle.runtime.sharedCompaction.compactToolCode,
    description:
      "Compress earlier session context into the durable shared compaction state for this conversation. Use when the user explicitly asks to compact/compress context or when context pressure blocks progress.",
    inputSchema: createCompactionInputSchema()
  };
}

function createCompactionInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      instructions: {
        type: "string",
        description: "Optional guidance about what the summary should preserve."
      }
    }
  };
}

function createWebSearchToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "web_search",
    description:
      "Search the public web through the currently configured search provider. Use this when you need sources or links about a topic and do not already have one exact URL to fetch.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Search query string."
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: WEB_SEARCH_MAX_COUNT,
          description: "Maximum number of search results to return."
        }
      }
    }
  };
}

function createWebFetchToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "web_fetch",
    description:
      "Fetch and extract the main content of a public webpage through the current web-fetch provider. Use this when you already know the exact URL and need page content, not a search results list.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "HTTP or HTTPS URL to fetch."
        },
        extractMode: {
          type: "string",
          enum: [...PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES],
          description: 'Return content as "markdown" (default) or "text".'
        },
        maxChars: {
          type: "integer",
          minimum: 100,
          maximum: WEB_FETCH_MAX_CHARS_CAP,
          description: "Maximum number of characters to return after extraction."
        }
      }
    }
  };
}

function createBrowserToolDefinition(
  bundle: AssistantRuntimeBundle
): ProviderGatewayToolDefinition {
  return {
    name: "browser",
    description:
      "Use a real browser for JavaScript-rendered or interactive pages when web_search or web_fetch are insufficient. Use action=snapshot to inspect a page and action=act only after the user explicitly wants page interaction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action", "url"],
      properties: {
        action: {
          type: "string",
          enum: [...bundle.runtime.browser.actions],
          description:
            'Use "snapshot" to inspect a page or "act" to perform bounded browser operations before returning a fresh snapshot.'
        },
        url: {
          type: "string",
          description: "HTTP or HTTPS URL to open in the browser."
        },
        maxChars: {
          type: "integer",
          minimum: 500,
          maximum: MAX_RUNTIME_BROWSER_MAX_CHARS,
          description: "Maximum number of page-text characters to return."
        },
        operations: {
          type: "array",
          maxItems: MAX_RUNTIME_BROWSER_OPERATIONS,
          description:
            'Required for action="act". Each step is one bounded browser operation using a CSS selector or keyboard input.',
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: {
                type: "string",
                enum: [...PERSAI_RUNTIME_BROWSER_OPERATION_KINDS]
              },
              selector: {
                type: "string",
                description: "CSS selector for click/type/select/wait_for_selector operations."
              },
              text: {
                type: "string",
                description: 'Text to type when kind="type".'
              },
              key: {
                type: "string",
                description: 'Keyboard key to press when kind="press", for example "Enter".'
              },
              value: {
                type: "string",
                description: 'Option value to select when kind="select_option".'
              },
              timeoutMs: {
                type: "integer",
                minimum: 0,
                maximum: MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS,
                description:
                  "Optional timeout for wait_for_selector or required delay for wait_for_timeout."
              }
            }
          }
        }
      }
    }
  };
}

function createScheduledActionToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "scheduled_action",
    description: [
      "Schedule actions for both user-visible reminders and hidden assistant follow-ups.",
      'Use audience="user" for reminders the user should actually see, for example reminders in a few hours, daily or weekly nudges, and deadlines.',
      'Use audience="assistant" for background checks and reasoning, for example coming back to a project or habit later, inspecting memory, and when available using knowledge_search or knowledge_fetch before deciding whether any gentle user-facing nudge is appropriate.',
      "Background assistant actions MUST NOT directly message the user.",
      'They are for checking progress or changes, noticing the user is already doing well and quietly doing nothing, or, when it is helpful and not pushy, scheduling a new scheduled_action with audience="user" and a short human-like message.',
      'Respect explicit "don\'t remind me" or paused/cancelled signals, avoid spamming multiple unsolicited reminders about the same thing, and phrase user-facing reminders as low-pressure offers rather than commands.',
      "For create, title, audience, and exactly one schedule are required: runAt, delayMs, everyMs, or cronExpr.",
      "Prefer taskId from an earlier list result when pausing, resuming, or cancelling; if taskId is unavailable, use titleMatch to resolve one current task by title."
    ].join(" "),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "pause", "resume", "cancel"],
          description: "Scheduled-action operation to perform."
        },
        audience: {
          type: "string",
          enum: ["user", "assistant"],
          description:
            'Required for create. Use "user" for a user-visible reminder and "assistant" for a hidden background assistant action.'
        },
        title: {
          type: "string",
          description: "Required for create. Human-readable scheduled-action title."
        },
        reminderText: {
          type: "string",
          description:
            'Optional action text. For audience="user" this is the message later delivered to the user. For audience="assistant" this becomes hidden follow-up guidance/context for the assistant.'
        },
        actionType: {
          type: "string",
          description:
            'Optional for audience="assistant". Short machine-readable action kind such as "follow_up" or "check_status".'
        },
        actionPayload: {
          type: "object",
          additionalProperties: true,
          description:
            'Optional for audience="assistant". Structured JSON payload with background-action parameters.'
        },
        taskId: {
          type: "string",
          description:
            "Preferred scheduled-action identifier for pause, resume, or cancel. Use the id returned by list or create."
        },
        titleMatch: {
          type: "string",
          description:
            "Fallback partial title match for pause, resume, or cancel when taskId is unavailable."
        },
        runAt: {
          type: "string",
          description:
            "Absolute future datetime in ISO format for a one-time scheduled action after the time has already been resolved."
        },
        delayMs: {
          type: "number",
          minimum: 1,
          description:
            "Relative delay in milliseconds for a one-time scheduled action. Prefer this for requests like 'in 5 minutes'."
        },
        everyMs: {
          type: "number",
          minimum: 1,
          description: "Recurring interval in milliseconds for a repeated scheduled action."
        },
        anchorAt: {
          type: "string",
          description: "Optional ISO anchor time for recurring interval schedules."
        },
        cronExpr: {
          type: "string",
          description: "Cron expression for recurring scheduled actions."
        },
        timezone: {
          type: "string",
          description: "Optional IANA timezone for cron-based schedules."
        },
        contextMessages: {
          type: "integer",
          minimum: 0,
          maximum: REMINDER_CONTEXT_MESSAGES_MAX,
          description:
            "Optional number of recent chat messages to snapshot into the scheduled action context."
        }
      }
    }
  };
}

function resolveAllowedModelVisibleToolPolicy(
  bundle: AssistantRuntimeBundle,
  toolCode: string,
  executionMode: RuntimeToolPolicy["executionMode"] = "inline"
): RuntimeToolPolicy | null {
  const policy =
    bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
  if (
    policy === null ||
    policy.visibleToModel !== true ||
    policy.enabled !== true ||
    policy.usageRule !== "allowed" ||
    policy.executionMode !== executionMode
  ) {
    return null;
  }
  return policy;
}

function resolveConfiguredCredentialRef(
  bundle: AssistantRuntimeBundle,
  toolCode: string
): AssistantRuntimeBundleToolCredentialRef | null {
  const credential = bundle.governance.toolCredentialRefs[toolCode] ?? null;
  if (credential === null || credential.configured !== true) {
    return null;
  }
  return credential;
}

function supportsCurrentNativeWebSearchProvider(providerId: string | null): boolean {
  return (
    providerId === null ||
    providerId === "tavily" ||
    providerId === "brave" ||
    providerId === "perplexity" ||
    providerId === "google"
  );
}

function supportsCurrentNativeBrowserProvider(
  bundle: AssistantRuntimeBundle,
  providerId: string | null
): boolean {
  return (
    providerId === null ||
    bundle.runtime.browser.providerIds.includes(providerId as PersaiRuntimeBrowserProviderId) ||
    providerId === bundle.runtime.browser.defaultProviderId
  );
}
