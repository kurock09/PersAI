import { Injectable } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  DEFAULT_RUNTIME_BROWSER_MAX_CHARS,
  MAX_RUNTIME_BROWSER_MAX_CHARS,
  MAX_RUNTIME_BROWSER_OPERATIONS,
  MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS,
  MIN_RUNTIME_BROWSER_MAX_CHARS,
  PERSAI_RUNTIME_BROWSER_OPERATION_KINDS,
  type PersaiRuntimeBrowserAction,
  type PersaiRuntimeBrowserProviderId,
  type ProviderGatewayToolCall,
  type RuntimeBrowserOperation,
  type RuntimeBrowserRequest,
  type RuntimeBrowserToolResult,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";

export interface RuntimeBrowserToolExecutionResult {
  payload: RuntimeBrowserToolResult;
  isError: boolean;
}

@Injectable()
export class RuntimeBrowserToolService {
  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
  }): Promise<RuntimeBrowserToolExecutionResult> {
    const request = this.readBrowserArguments(params.bundle, params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: {
          toolCode: "browser",
          executionMode: "worker",
          provider: null,
          requestedAction: "snapshot",
          page: null,
          action: "skipped",
          reason: "invalid_arguments",
          warning: request.message
        },
        isError: true
      };
    }

    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, "browser");
    if (policy === null) {
      return {
        payload: {
          toolCode: "browser",
          executionMode: "worker",
          provider: null,
          requestedAction: request.action,
          page: null,
          action: "skipped",
          reason: "tool_unavailable",
          warning: null
        },
        isError: false
      };
    }

    const credential = this.resolveConfiguredCredentialRef(params.bundle, "browser");
    if (credential === null) {
      return {
        payload: {
          toolCode: "browser",
          executionMode: "worker",
          provider: null,
          requestedAction: request.action,
          page: null,
          action: "skipped",
          reason: "credential_not_configured",
          warning: null
        },
        isError: false
      };
    }

    const providerId = this.resolveBrowserProviderId(params.bundle, credential.providerId ?? null);
    if (providerId === null) {
      return {
        payload: {
          toolCode: "browser",
          executionMode: "worker",
          provider: null,
          requestedAction: request.action,
          page: null,
          action: "skipped",
          reason: "provider_unavailable",
          warning: "Selected browser provider is not supported by the current native runtime."
        },
        isError: false
      };
    }

    try {
      if (policy.dailyCallLimit !== null) {
        const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
          assistantId: params.bundle.metadata.assistantId,
          toolCode: "browser",
          dailyCallLimit: policy.dailyCallLimit
        });
        if (!quotaOutcome.allowed) {
          return {
            payload: {
              toolCode: "browser",
              executionMode: "worker",
              provider: providerId,
              requestedAction: request.action,
              page: null,
              action: "skipped",
              reason: quotaOutcome.code,
              warning: quotaOutcome.message
            },
            isError: false
          };
        }
      }

      const workerConfig = this.resolveWorkerToolConfig(params.bundle, "browser");
      const providerResult = await this.providerGatewayClientService.browserAction(
        {
          action: request.action,
          url: request.url,
          maxChars: request.maxChars,
          operations: request.operations,
          timeoutMs: workerConfig?.timeoutMs ?? null,
          credential: {
            toolCode: "browser",
            secretId: credential.secretRef.id,
            providerId
          }
        },
        workerConfig === null ? undefined : { timeoutMs: workerConfig.timeoutMs }
      );
      return {
        payload: {
          toolCode: "browser",
          executionMode: "worker",
          provider: providerResult.provider,
          requestedAction: request.action,
          page: {
            initialUrl: providerResult.initialUrl,
            finalUrl: providerResult.finalUrl,
            title: providerResult.title,
            content: providerResult.content,
            truncated: providerResult.truncated,
            elements: providerResult.elements,
            provider: providerResult.provider,
            observedAt: providerResult.observedAt,
            tookMs: providerResult.tookMs,
            warning: providerResult.warning,
            externalContent: providerResult.externalContent
          },
          action: request.action === "snapshot" ? "snapshot" : "acted",
          reason: null,
          warning: providerResult.warning
        },
        isError: false
      };
    } catch (error) {
      const warning = error instanceof Error ? error.message : "Browser action failed.";
      return {
        payload: {
          toolCode: "browser",
          executionMode: "worker",
          provider: providerId,
          requestedAction: request.action,
          page: null,
          action: "skipped",
          reason: "browser_failed",
          warning
        },
        isError: true
      };
    }
  }

  private readBrowserArguments(
    bundle: AssistantRuntimeBundle,
    args: Record<string, unknown>
  ): RuntimeBrowserRequest | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) => key !== "action" && key !== "url" && key !== "maxChars" && key !== "operations"
    );
    const action =
      typeof args.action === "string" &&
      bundle.runtime.browser.actions.includes(args.action as PersaiRuntimeBrowserAction)
        ? (args.action as PersaiRuntimeBrowserAction)
        : null;
    const url = this.asHttpUrl(args.url);
    const maxChars =
      args.maxChars === undefined || args.maxChars === null
        ? null
        : Number.isInteger(args.maxChars) &&
            Number(args.maxChars) >= MIN_RUNTIME_BROWSER_MAX_CHARS &&
            Number(args.maxChars) <= MAX_RUNTIME_BROWSER_MAX_CHARS
          ? Number(args.maxChars)
          : null;
    const operations = this.readOperations(args.operations);
    if (
      unknownKeys.length > 0 ||
      action === null ||
      url === null ||
      ("maxChars" in args && args.maxChars !== null && maxChars === null) ||
      operations instanceof Error
    ) {
      return new Error(
        "browser arguments must include action, url, optional maxChars, and optional operations."
      );
    }
    if (action === "snapshot" && operations.length > 0) {
      return new Error('browser action "snapshot" must not include operations.');
    }
    if (action === "act" && operations.length === 0) {
      return new Error('browser action "act" requires at least one operation.');
    }
    return {
      toolCode: "browser",
      action,
      url,
      maxChars: maxChars ?? DEFAULT_RUNTIME_BROWSER_MAX_CHARS,
      operations
    };
  }

  private readOperations(value: unknown): RuntimeBrowserOperation[] | Error {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value) || value.length > MAX_RUNTIME_BROWSER_OPERATIONS) {
      return new Error("browser operations must be an array with a bounded number of steps.");
    }
    const operations: RuntimeBrowserOperation[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return new Error("browser operations must be objects.");
      }
      const row = entry as Record<string, unknown>;
      const kind = row.kind;
      if (
        typeof kind !== "string" ||
        !PERSAI_RUNTIME_BROWSER_OPERATION_KINDS.includes(
          kind as (typeof PERSAI_RUNTIME_BROWSER_OPERATION_KINDS)[number]
        )
      ) {
        return new Error("browser operation kind is invalid.");
      }
      switch (kind) {
        case "click": {
          const selector = this.asNonEmptyString(row.selector);
          if (selector === null) {
            return new Error("browser click operation requires selector.");
          }
          operations.push({ kind, selector });
          break;
        }
        case "type": {
          const selector = this.asNonEmptyString(row.selector);
          if (selector === null || typeof row.text !== "string") {
            return new Error("browser type operation requires selector and text.");
          }
          operations.push({ kind, selector, text: row.text });
          break;
        }
        case "press": {
          const key = this.asNonEmptyString(row.key);
          if (key === null) {
            return new Error("browser press operation requires key.");
          }
          operations.push({ kind, key });
          break;
        }
        case "select_option": {
          const selector = this.asNonEmptyString(row.selector);
          if (selector === null || typeof row.value !== "string") {
            return new Error("browser select_option operation requires selector and value.");
          }
          operations.push({ kind, selector, value: row.value });
          break;
        }
        case "wait_for_selector": {
          const selector = this.asNonEmptyString(row.selector);
          const timeoutMs =
            row.timeoutMs === undefined || row.timeoutMs === null
              ? null
              : Number.isInteger(row.timeoutMs) &&
                  Number(row.timeoutMs) >= 0 &&
                  Number(row.timeoutMs) <= MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS
                ? Number(row.timeoutMs)
                : null;
          if (
            selector === null ||
            ("timeoutMs" in row && row.timeoutMs !== null && timeoutMs === null)
          ) {
            return new Error("browser wait_for_selector operation is invalid.");
          }
          operations.push({ kind, selector, timeoutMs });
          break;
        }
        case "wait_for_timeout": {
          const timeoutMs =
            Number.isInteger(row.timeoutMs) &&
            Number(row.timeoutMs) >= 0 &&
            Number(row.timeoutMs) <= MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS
              ? Number(row.timeoutMs)
              : null;
          if (timeoutMs === null) {
            return new Error("browser wait_for_timeout operation requires timeoutMs.");
          }
          operations.push({ kind, timeoutMs });
          break;
        }
      }
    }
    return operations;
  }

  private resolveAllowedWorkerToolPolicy(
    bundle: AssistantRuntimeBundle,
    toolCode: string
  ): RuntimeToolPolicy | null {
    const policy =
      bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
    if (
      policy === null ||
      policy.visibleToModel !== true ||
      policy.enabled !== true ||
      policy.usageRule !== "allowed" ||
      policy.executionMode !== "worker"
    ) {
      return null;
    }
    return policy;
  }

  private resolveConfiguredCredentialRef(
    bundle: AssistantRuntimeBundle,
    toolCode: string
  ): AssistantRuntimeBundleToolCredentialRef | null {
    const credential = bundle.governance.toolCredentialRefs[toolCode] ?? null;
    if (credential === null || credential.configured !== true) {
      return null;
    }
    return credential;
  }

  private resolveBrowserProviderId(
    bundle: AssistantRuntimeBundle,
    providerId: string | null
  ): PersaiRuntimeBrowserProviderId | null {
    const resolved = providerId ?? bundle.runtime.browser.defaultProviderId;
    return bundle.runtime.browser.providerIds.includes(resolved as PersaiRuntimeBrowserProviderId)
      ? (resolved as PersaiRuntimeBrowserProviderId)
      : null;
  }

  private resolveWorkerToolConfig(bundle: AssistantRuntimeBundle, toolCode: string) {
    return bundle.runtime.workerTools.tools.find((entry) => entry.toolCode === toolCode) ?? null;
  }

  private asHttpUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
