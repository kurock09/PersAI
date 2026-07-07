import { Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  DEFAULT_RUNTIME_BROWSER_MAX_CHARS,
  MAX_RUNTIME_BROWSER_MAX_CHARS,
  MAX_RUNTIME_BROWSER_OPERATIONS,
  MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS,
  type PersistentBrowserCapabilityPolicy,
  MIN_RUNTIME_BROWSER_MAX_CHARS,
  PERSAI_RUNTIME_BROWSER_OPERATION_KINDS,
  PERSAI_RUNTIME_BROWSER_SNAPSHOT_FORMATS,
  type PersaiRuntimeBrowserAction,
  type PersaiRuntimeBrowserProviderId,
  type PersaiRuntimeBrowserSnapshotFormat,
  type ProviderGatewayToolCall,
  type RuntimeBrowserOperation,
  type RuntimeBrowserRequest,
  type RuntimeBrowserToolResult,
  type RuntimeOutputArtifact,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import {
  executeRuntimeToolContractDescribe,
  isToolContractDescribeCall
} from "./runtime-tool-contract-describe";
import { writeRuntimeOutboundArtifact } from "./write-runtime-outbound-artifact";

export interface RuntimeBrowserToolExecutionResult {
  payload: RuntimeBrowserToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeBrowserToolService {
  private readonly logger = new Logger(RuntimeBrowserToolService.name);

  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    chatId?: string | null;
    sourceUserMessageText?: string | null;
    sourceUserMessageCreatedAt?: string | null;
  }): Promise<RuntimeBrowserToolExecutionResult> {
    if (isToolContractDescribeCall(params.toolCall.arguments)) {
      const described = executeRuntimeToolContractDescribe({
        bundle: params.bundle,
        toolCode: "browser"
      }) as unknown as RuntimeBrowserToolExecutionResult;
      return { ...described, artifacts: [] };
    }

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
        artifacts: [],
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
        artifacts: [],
        isError: false
      };
    }

    if (request.action === "list_profiles") {
      return this.executeListProfiles(params.bundle, request);
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
        artifacts: [],
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
        artifacts: [],
        isError: false
      };
    }

    try {
      if (request.action === "login") {
        return await this.executeLogin(params, request, providerId, policy, credential);
      }

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
          artifacts: [],
          isError: false
        };
      }

      return await this.executeBrowserPageAction(params, request, providerId, credential);
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
        artifacts: [],
        isError: true
      };
    }
  }

  private async executeListProfiles(
    bundle: AssistantRuntimeBundle,
    request: RuntimeBrowserRequest
  ): Promise<RuntimeBrowserToolExecutionResult> {
    try {
      const profiles = await this.persaiInternalApiClientService.listBrowserProfiles({
        assistantId: bundle.metadata.assistantId
      });
      return {
        payload: {
          toolCode: "browser",
          executionMode: "worker",
          provider: null,
          requestedAction: request.action,
          page: null,
          action: "listed_profiles",
          reason: null,
          warning: null,
          profiles
        },
        artifacts: [],
        isError: false
      };
    } catch (error) {
      const warning =
        error instanceof Error ? error.message : "Browser profiles could not be listed.";
      return {
        payload: {
          toolCode: "browser",
          executionMode: "worker",
          provider: null,
          requestedAction: request.action,
          page: null,
          action: "skipped",
          reason: "browser_failed",
          warning
        },
        artifacts: [],
        isError: true
      };
    }
  }

  private async executeLogin(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      chatId?: string | null;
    },
    request: RuntimeBrowserRequest,
    providerId: PersaiRuntimeBrowserProviderId,
    policy: RuntimeToolPolicy,
    credential: NonNullable<ReturnType<typeof this.resolveConfiguredCredentialRef>>
  ): Promise<RuntimeBrowserToolExecutionResult> {
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
        artifacts: [],
        isError: false
      };
    }

    const login = await this.persaiInternalApiClientService.startBrowserLogin({
      assistantId: params.bundle.metadata.assistantId,
      workspaceId: params.bundle.metadata.workspaceId,
      displayName: request.displayName ?? "",
      loginUrl: request.url,
      browserCredentialSecretId: credential.secretRef.id,
      originatingChatId: params.chatId ?? null
    });

    const pendingBrowserLogin = {
      profileId: login.profileId,
      profileKey: login.profileKey,
      displayName: login.displayName,
      liveUrl: login.liveUrl,
      loginUrl: login.loginUrl
    };

    return {
      payload: {
        toolCode: "browser",
        executionMode: "worker",
        provider: providerId,
        requestedAction: request.action,
        page: null,
        action: "login",
        reason: null,
        warning: null,
        login,
        pendingBrowserLogin
      },
      artifacts: [],
      isError: false
    };
  }

  private async executeBrowserPageAction(
    params: {
      bundle: AssistantRuntimeBundle;
      toolCall: ProviderGatewayToolCall;
      sessionId: string;
      chatId?: string | null;
      sourceUserMessageText?: string | null;
      sourceUserMessageCreatedAt?: string | null;
    },
    request: RuntimeBrowserRequest,
    providerId: PersaiRuntimeBrowserProviderId,
    credential: AssistantRuntimeBundleToolCredentialRef
  ): Promise<RuntimeBrowserToolExecutionResult> {
    let profileSessionId: string | null = null;
    let capabilityPolicy: PersistentBrowserCapabilityPolicy | null = null;
    const profileKey = request.profile?.trim() || null;
    if (profileKey !== null) {
      const resolved = await this.persaiInternalApiClientService.resolveBrowserProfile({
        assistantId: params.bundle.metadata.assistantId,
        profileKey
      });
      if (!resolved.ok) {
        return {
          payload: {
            toolCode: "browser",
            executionMode: "worker",
            provider: providerId,
            requestedAction: request.action,
            page: null,
            action: "skipped",
            reason: resolved.reason,
            warning: this.profileErrorWarning(resolved.reason),
            ...(resolved.pendingBrowserLogin === undefined
              ? {}
              : { pendingBrowserLogin: resolved.pendingBrowserLogin })
          },
          artifacts: [],
          isError: resolved.pendingBrowserLogin === undefined
        };
      }
      profileSessionId = resolved.providerSessionId;
      capabilityPolicy = resolved.capabilityPolicy;
    }

    const workerConfig = this.resolveWorkerToolConfig(params.bundle, "browser");
    const providerResult = await this.providerGatewayClientService.browserAction(
      {
        action: request.action,
        url: request.url,
        maxChars: request.maxChars,
        operations: request.operations,
        timeoutMs: workerConfig?.timeoutMs ?? null,
        profileSessionId,
        capabilityPolicy,
        format: request.format ?? null,
        optimizeForSpeed: request.optimizeForSpeed ?? null,
        snapshotSelector: request.snapshotSelector ?? null,
        fullPage: request.fullPage ?? null,
        credential: {
          toolCode: "browser",
          secretId: credential.secretRef.id,
          providerId
        }
      },
      workerConfig === null ? undefined : { timeoutMs: workerConfig.timeoutMs }
    );

    const artifacts: RuntimeOutputArtifact[] = [];
    let pageContent = providerResult.content;
    const binaryBase64 =
      typeof providerResult.pdfBase64 === "string" && providerResult.pdfBase64.trim().length > 0
        ? providerResult.pdfBase64.trim()
        : typeof providerResult.artifactBase64 === "string" &&
            providerResult.artifactBase64.trim().length > 0
          ? providerResult.artifactBase64.trim()
          : null;
    if (binaryBase64 !== null) {
      const mimeType = providerResult.artifactMimeType ?? "application/octet-stream";
      const isPdf = mimeType === "application/pdf";
      const artifact = await writeRuntimeOutboundArtifact({
        mediaObjectStorage: this.mediaObjectStorage,
        assistantId: params.bundle.metadata.assistantId,
        workspaceId: params.bundle.metadata.workspaceId,
        sessionId: params.sessionId,
        buffer: Buffer.from(binaryBase64, "base64"),
        mimeType,
        slugSourceText:
          providerResult.title?.trim() ||
          providerResult.finalUrl ||
          (isPdf ? "browser-pdf" : "browser-screenshot"),
        filenameHint: isPdf
          ? this.buildPdfFilenameHint(providerResult.title, providerResult.finalUrl)
          : this.buildImageFilenameHint(
              request.format,
              providerResult.title,
              providerResult.finalUrl
            ),
        kind: "file",
        sourceToolCode: "browser",
        billingFacts: providerResult.billingFacts ?? null,
        manifest: {
          persaiInternalApiClient: this.persaiInternalApiClientService,
          workspaceId: params.bundle.metadata.workspaceId,
          assistantId: params.bundle.metadata.assistantId,
          originChatId: params.chatId ?? null,
          sourceUserMessageText: params.sourceUserMessageText ?? null,
          sourceUserMessageCreatedAt: params.sourceUserMessageCreatedAt ?? null
        },
        logger: this.logger
      });
      artifacts.push(artifact);
      pageContent = isPdf
        ? `PDF snapshot saved to workspace path "${artifact.storagePath}". Attach it with files.attach using that path.`
        : `Screenshot saved to workspace path "${artifact.storagePath}". Attach it with files.attach using that path.`;
    }

    if (profileKey !== null) {
      try {
        await this.persaiInternalApiClientService.touchBrowserProfile({
          assistantId: params.bundle.metadata.assistantId,
          workspaceId: params.bundle.metadata.workspaceId,
          profileKey
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`browser_profile_touch_failed profileKey=${profileKey} reason=${detail}`);
      }
    }

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
          content: pageContent,
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
        warning: providerResult.warning,
        billingFacts: providerResult.billingFacts ?? null
      },
      artifacts,
      isError: false
    };
  }

  private profileErrorWarning(reason: string): string {
    switch (reason) {
      case "browser_profile_not_found":
        return "No saved browser profile matches that profileKey. Run browser login first.";
      case "browser_profile_expired":
        return "The saved browser profile is no longer usable. Run browser login again.";
      case "browser_profile_pending_login":
        return "This saved browser profile is still waiting for login completion. Reopen the product login prompt and press Done when finished.";
      case "browser_profile_needs_user_reauth":
        return "This saved browser profile needs user re-authentication. Reopen the product login prompt for this profile.";
      default:
        return "Browser profile could not be used.";
    }
  }

  private buildPdfFilenameHint(title: string | null, finalUrl: string): string | null {
    const fromTitle = title
      ?.trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (fromTitle !== undefined && fromTitle !== null && fromTitle.length > 0) {
      return `${fromTitle.slice(0, 80)}.pdf`;
    }
    try {
      const hostname = new URL(finalUrl).hostname.replace(/[^\w.-]+/g, "-");
      return hostname.length > 0 ? `${hostname}.pdf` : null;
    } catch {
      return null;
    }
  }

  private buildImageFilenameHint(
    format: RuntimeBrowserRequest["format"],
    title: string | null,
    finalUrl: string
  ): string | null {
    const ext =
      format === "jpeg" ? "jpg" : format === "webp" ? "webp" : format === "png" ? "png" : "png";
    const fromTitle = title
      ?.trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (fromTitle !== undefined && fromTitle !== null && fromTitle.length > 0) {
      return `${fromTitle.slice(0, 80)}.${ext}`;
    }
    try {
      const hostname = new URL(finalUrl).hostname.replace(/[^\w.-]+/g, "-");
      return hostname.length > 0 ? `${hostname}.${ext}` : null;
    } catch {
      return null;
    }
  }

  private readBrowserArguments(
    bundle: AssistantRuntimeBundle,
    args: Record<string, unknown>
  ): RuntimeBrowserRequest | Error {
    const action =
      typeof args.action === "string" &&
      bundle.runtime.browser.actions.includes(args.action as PersaiRuntimeBrowserAction)
        ? (args.action as PersaiRuntimeBrowserAction)
        : null;
    if (action === null) {
      return new Error("browser action must be one of the configured runtime browser actions.");
    }

    const profile =
      args.profile === undefined || args.profile === null
        ? null
        : this.asNonEmptyString(args.profile);
    if ("profile" in args && args.profile !== null && profile === null) {
      return new Error("browser profile must be a non-empty string when provided.");
    }

    const displayName =
      args.displayName === undefined || args.displayName === null
        ? null
        : this.asNonEmptyString(args.displayName);
    if ("displayName" in args && args.displayName !== null && displayName === null) {
      return new Error("browser displayName must be a non-empty string when provided.");
    }

    const format =
      args.format === undefined || args.format === null
        ? null
        : typeof args.format === "string" &&
            (PERSAI_RUNTIME_BROWSER_SNAPSHOT_FORMATS as readonly string[]).includes(args.format)
          ? (args.format as PersaiRuntimeBrowserSnapshotFormat)
          : null;
    if ("format" in args && args.format !== null && format === null) {
      return new Error(
        `browser format must be one of: ${PERSAI_RUNTIME_BROWSER_SNAPSHOT_FORMATS.join(", ")}.`
      );
    }
    if (action === "act" && format !== null && format !== "text") {
      return new Error('browser action "act" does not support non-text format.');
    }

    const optimizeForSpeed =
      args.optimizeForSpeed === undefined || args.optimizeForSpeed === null
        ? null
        : typeof args.optimizeForSpeed === "boolean"
          ? args.optimizeForSpeed
          : null;
    if ("optimizeForSpeed" in args && args.optimizeForSpeed !== null && optimizeForSpeed === null) {
      return new Error("browser optimizeForSpeed must be a boolean when provided.");
    }

    const snapshotSelector =
      args.snapshotSelector === undefined || args.snapshotSelector === null
        ? null
        : this.asNonEmptyString(args.snapshotSelector);
    if ("snapshotSelector" in args && args.snapshotSelector !== null && snapshotSelector === null) {
      return new Error("browser snapshotSelector must be a non-empty string when provided.");
    }
    const fullPage =
      args.fullPage === undefined || args.fullPage === null
        ? null
        : typeof args.fullPage === "boolean"
          ? args.fullPage
          : null;
    if ("fullPage" in args && args.fullPage !== null && fullPage === null) {
      return new Error("browser fullPage must be a boolean when provided.");
    }
    if (action === "snapshot" && snapshotSelector !== null && fullPage === true) {
      return new Error("browser snapshotSelector and fullPage cannot both be set.");
    }

    const url = action === "list_profiles" ? "" : this.asHttpUrl(args.url);
    const maxChars =
      args.maxChars === undefined || args.maxChars === null
        ? null
        : Number.isInteger(args.maxChars) &&
            Number(args.maxChars) >= MIN_RUNTIME_BROWSER_MAX_CHARS &&
            Number(args.maxChars) <= MAX_RUNTIME_BROWSER_MAX_CHARS
          ? Number(args.maxChars)
          : null;
    const operations = this.readOperations(args.operations);

    if (action === "login") {
      if (url === null || displayName === null) {
        return new Error('browser action "login" requires displayName and url.');
      }
      return {
        toolCode: "browser",
        action,
        url,
        displayName,
        maxChars: null,
        operations: [],
        profile,
        format,
        optimizeForSpeed,
        snapshotSelector,
        fullPage
      };
    }

    if (action === "list_profiles") {
      return {
        toolCode: "browser",
        action,
        url: "",
        maxChars: null,
        operations: [],
        profile,
        format,
        optimizeForSpeed,
        snapshotSelector,
        fullPage
      };
    }

    if (url === null) {
      return new Error("browser action requires a valid http(s) url.");
    }
    if ("maxChars" in args && args.maxChars !== null && maxChars === null) {
      return new Error("browser maxChars is out of range.");
    }
    if (operations instanceof Error) {
      return operations;
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
      operations,
      profile,
      displayName,
      format,
      optimizeForSpeed,
      snapshotSelector,
      fullPage
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
        case "scroll": {
          if (row.selector !== undefined && row.selector !== null) {
            const selector = this.asNonEmptyString(row.selector);
            if (selector === null) {
              return new Error("browser scroll operation selector must be a non-empty string.");
            }
            operations.push({ kind, selector });
          } else {
            operations.push({ kind, selector: null });
          }
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
