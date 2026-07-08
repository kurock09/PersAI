import { Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  DEFAULT_RUNTIME_BROWSER_MAX_CHARS,
  DEFAULT_RUNTIME_BROWSER_VIEWPORT_WIDTH,
  DEFAULT_RUNTIME_BROWSER_VIEWPORT_HEIGHT,
  MAX_RUNTIME_BROWSER_EXTRACT_ITEMS,
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
  type ProviderGatewayBrowserActionRequest,
  type ProviderGatewayToolCall,
  type RuntimeBrowserOperation,
  type RuntimeBrowserRequest,
  type RuntimeBrowserToolResult,
  type RuntimeOutputArtifact,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import {
  ProviderGatewayClientService,
  ProviderGatewayHttpError
} from "./provider-gateway.client.service";
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
  // ADR-139: Browserless persistent sessions are single-consumer. Serialize
  // profile-backed page actions per providerSessionId so overlapping model
  // tool calls wait for the previous BQL chain instead of racing and surfacing
  // 429/502 as immediate browser_failed retries.
  private readonly persistentBrowserActionTail = new Map<string, Promise<void>>();
  private static readonly BROWSER_TRANSPORT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

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
      if (request.action === "open_live") {
        return await this.executeOpenLive(params, request, providerId, policy, credential);
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
      // This catch previously discarded the real failure reason entirely —
      // the model-facing result only ever said "browser_failed" with a
      // generic warning, and nothing was logged, so a live 400/502 report
      // from a real test session had zero trace in `kubectl logs` on either
      // runtime or provider-gateway (ADR-139 D12: found only by noticing an
      // unrelated same-shaped BadRequestException from a different subsystem
      // and reasoning backward — this call site itself was silent).
      this.logger.warn(
        `[browser-action] failed action=${request.action} url=${request.url} profile=${
          request.profile !== undefined && request.profile !== null && request.profile.length > 0
            ? "set"
            : "none"
        }: ${warning}`
      );
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
      this.logger.warn(`[browser-action] list_profiles failed: ${warning}`);
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
        pendingBrowserLogin: {
          ...pendingBrowserLogin,
          completionMode: "login"
        }
      },
      artifacts: [],
      isError: false
    };
  }

  private async executeOpenLive(
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
    const profileKey = request.profile?.trim() ?? "";
    if (profileKey.length === 0) {
      return {
        payload: {
          toolCode: "browser",
          executionMode: "worker",
          provider: providerId,
          requestedAction: request.action,
          page: null,
          action: "skipped",
          reason: "invalid_arguments",
          warning: 'browser action "open_live" requires profile.'
        },
        artifacts: [],
        isError: true
      };
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

    const live = await this.persaiInternalApiClientService.openBrowserLive({
      assistantId: params.bundle.metadata.assistantId,
      workspaceId: params.bundle.metadata.workspaceId,
      profileKey,
      browserCredentialSecretId: credential.secretRef.id
    });

    const completionMode = live.status === "active" ? ("assist" as const) : ("login" as const);
    const pendingBrowserLogin = {
      profileId: live.profileId,
      profileKey: live.profileKey,
      displayName: live.displayName,
      liveUrl: live.liveUrl,
      loginUrl: live.loginUrl,
      completionMode
    };

    return {
      payload: {
        toolCode: "browser",
        executionMode: "worker",
        provider: providerId,
        requestedAction: request.action,
        page: null,
        action: "opened_live",
        reason: null,
        warning: null,
        login: {
          profileKey: live.profileKey,
          displayName: live.displayName,
          liveUrl: live.liveUrl,
          loginUrl: live.loginUrl,
          status: live.status
        },
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
    const optimizeForSpeed = request.optimizeForSpeed ?? (profileSessionId !== null ? true : null);
    this.logger.log(
      `[browser-action] action=${request.action} url=${request.url} profile=${
        profileSessionId !== null ? "set" : "none"
      } operations=${request.operations.length}`
    );
    const browserActionRequest: ProviderGatewayBrowserActionRequest = {
      action: request.action,
      url: request.url,
      maxChars: request.maxChars,
      operations: request.operations,
      timeoutMs: workerConfig?.timeoutMs ?? null,
      profileSessionId,
      capabilityPolicy,
      format: request.format ?? null,
      optimizeForSpeed,
      snapshotSelector: request.snapshotSelector ?? null,
      fullPage: request.fullPage ?? null,
      stayOnPage: request.stayOnPage ?? null,
      credential: {
        toolCode: "browser",
        secretId: credential.secretRef.id,
        providerId
      }
    };
    const providerResult =
      profileSessionId !== null
        ? await this.enqueuePersistentBrowserAction(profileSessionId, () =>
            this.browserActionWithTransportRetry(
              browserActionRequest,
              workerConfig === null ? undefined : { timeoutMs: workerConfig.timeoutMs }
            )
          )
        : await this.browserActionWithTransportRetry(
            browserActionRequest,
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
        : `Screenshot saved to workspace path "${artifact.storagePath}" (${String(DEFAULT_RUNTIME_BROWSER_VIEWPORT_WIDTH)}x${String(DEFAULT_RUNTIME_BROWSER_VIEWPORT_HEIGHT)} viewport). Use files.preview on that path to read click_at x,y coordinates, or files.attach to deliver it.`;
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
          extracted: providerResult.extracted,
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

  private enqueuePersistentBrowserAction<T>(
    providerSessionId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const sessionKey = providerSessionId.trim();
    const previous = this.persistentBrowserActionTail.get(sessionKey) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.persistentBrowserActionTail.set(sessionKey, tail);
    void tail.finally(() => {
      if (this.persistentBrowserActionTail.get(sessionKey) === tail) {
        this.persistentBrowserActionTail.delete(sessionKey);
      }
    });
    return result;
  }

  private async browserActionWithTransportRetry(
    input: Parameters<ProviderGatewayClientService["browserAction"]>[0],
    options?: Parameters<ProviderGatewayClientService["browserAction"]>[1]
  ): Promise<Awaited<ReturnType<ProviderGatewayClientService["browserAction"]>>> {
    for (
      let attempt = 0;
      attempt <= RuntimeBrowserToolService.BROWSER_TRANSPORT_RETRY_DELAYS_MS.length;
      attempt++
    ) {
      try {
        return await this.providerGatewayClientService.browserAction(input, options);
      } catch (error) {
        if (!(error instanceof ProviderGatewayHttpError)) {
          throw error;
        }
        const retryableStatus =
          error.httpStatus === 429 ||
          error.httpStatus === 502 ||
          error.httpStatus === 503 ||
          error.httpStatus === 408;
        if (!retryableStatus) {
          throw error;
        }
        if (attempt >= RuntimeBrowserToolService.BROWSER_TRANSPORT_RETRY_DELAYS_MS.length) {
          throw error;
        }
        const delayMs =
          RuntimeBrowserToolService.BROWSER_TRANSPORT_RETRY_DELAYS_MS[attempt] ?? 8000;
        this.logger.warn(
          `[browser-action] transport status=${String(error.httpStatus)} profileSession=${
            input.profileSessionId ?? "none"
          }, retrying in ${String(delayMs)}ms (attempt ${String(attempt + 1)}/${String(
            RuntimeBrowserToolService.BROWSER_TRANSPORT_RETRY_DELAYS_MS.length + 1
          )})`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return await this.providerGatewayClientService.browserAction(input, options);
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
    const stayOnPage =
      args.stayOnPage === undefined || args.stayOnPage === null
        ? null
        : typeof args.stayOnPage === "boolean"
          ? args.stayOnPage
          : null;
    if ("stayOnPage" in args && args.stayOnPage !== null && stayOnPage === null) {
      return new Error("browser stayOnPage must be a boolean when provided.");
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

    if (action === "open_live") {
      if (profile === null) {
        return new Error('browser action "open_live" requires profile.');
      }
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
    if (stayOnPage === true && profile === null) {
      return new Error("browser stayOnPage requires a saved profile.");
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
      fullPage,
      stayOnPage
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
          const matchIndex = this.readOptionalMatchIndex(row.matchIndex);
          if (matchIndex instanceof Error) {
            return matchIndex;
          }
          operations.push({ kind, selector, ...(matchIndex !== undefined ? { matchIndex } : {}) });
          break;
        }
        case "click_at": {
          const x = this.readViewportCoordinate(row.x);
          const y = this.readViewportCoordinate(row.y);
          if (x instanceof Error) {
            return x;
          }
          if (y instanceof Error) {
            return y;
          }
          operations.push({ kind, x, y });
          break;
        }
        case "type": {
          const selector = this.asNonEmptyString(row.selector);
          if (selector === null || typeof row.text !== "string") {
            return new Error("browser type operation requires selector and text.");
          }
          const matchIndex = this.readOptionalMatchIndex(row.matchIndex);
          if (matchIndex instanceof Error) {
            return matchIndex;
          }
          operations.push({
            kind,
            selector,
            text: row.text,
            ...(matchIndex !== undefined ? { matchIndex } : {})
          });
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
          const matchIndex = this.readOptionalMatchIndex(row.matchIndex);
          if (matchIndex instanceof Error) {
            return matchIndex;
          }
          operations.push({
            kind,
            selector,
            value: row.value,
            ...(matchIndex !== undefined ? { matchIndex } : {})
          });
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
          const matchIndex = this.readOptionalMatchIndex(row.matchIndex);
          if (matchIndex instanceof Error) {
            return matchIndex;
          }
          if (
            selector === null ||
            ("timeoutMs" in row && row.timeoutMs !== null && timeoutMs === null)
          ) {
            return new Error("browser wait_for_selector operation is invalid.");
          }
          operations.push({
            kind,
            selector,
            timeoutMs,
            ...(matchIndex !== undefined ? { matchIndex } : {})
          });
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
          const matchIndex = this.readOptionalMatchIndex(row.matchIndex);
          if (matchIndex instanceof Error) {
            return matchIndex;
          }
          if (row.selector !== undefined && row.selector !== null) {
            const selector = this.asNonEmptyString(row.selector);
            if (selector === null) {
              return new Error("browser scroll operation selector must be a non-empty string.");
            }
            operations.push({
              kind,
              selector,
              ...(matchIndex !== undefined ? { matchIndex } : {})
            });
          } else {
            operations.push({
              kind,
              selector: null,
              ...(matchIndex !== undefined ? { matchIndex } : {})
            });
          }
          break;
        }
        case "goto": {
          const gotoUrl = this.asHttpUrl(row.url);
          if (gotoUrl === null) {
            return new Error("browser goto operation requires a valid http(s) url.");
          }
          operations.push({ kind, url: gotoUrl });
          break;
        }
        case "hover": {
          const selector = this.asNonEmptyString(row.selector);
          if (selector === null) {
            return new Error("browser hover operation requires selector.");
          }
          const matchIndex = this.readOptionalMatchIndex(row.matchIndex);
          if (matchIndex instanceof Error) {
            return matchIndex;
          }
          operations.push({ kind, selector, ...(matchIndex !== undefined ? { matchIndex } : {}) });
          break;
        }
        case "extract": {
          const selector = this.asNonEmptyString(row.selector);
          if (selector === null) {
            return new Error("browser extract operation requires selector.");
          }
          const maxItems =
            row.maxItems === undefined || row.maxItems === null
              ? null
              : Number.isInteger(row.maxItems) &&
                  Number(row.maxItems) > 0 &&
                  Number(row.maxItems) <= MAX_RUNTIME_BROWSER_EXTRACT_ITEMS
                ? Number(row.maxItems)
                : null;
          if (row.maxItems !== undefined && row.maxItems !== null && maxItems === null) {
            return new Error("browser extract operation maxItems is out of range.");
          }
          operations.push({ kind, selector, maxItems });
          break;
        }
      }
    }
    return operations;
  }

  private readOptionalMatchIndex(value: unknown): number | null | undefined | Error {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (!Number.isInteger(value) || Number(value) < 0) {
      return new Error("browser operation matchIndex must be null or a non-negative integer.");
    }
    return Number(value);
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

  private readViewportCoordinate(value: unknown): number | Error {
    if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 10_000) {
      return new Error("browser click_at operation requires integer x and y between 0 and 10000.");
    }
    return Number(value);
  }
}
