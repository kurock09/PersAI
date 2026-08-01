import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeEmailSendRequest,
  RuntimeEmailSendToolResult,
  RuntimeOutputArtifact,
  RuntimeToolPolicy
} from "@persai/runtime-contract";
import {
  PersaiInternalApiClientService,
  type SendAssistantEmailOutcome
} from "./persai-internal-api.client.service";
import {
  executeRuntimeToolContractDescribe,
  isToolContractDescribeCall
} from "./runtime-tool-contract-describe";

const EMAIL_SEND_TOOL_CODE = "email_send" as const;

// Same recipient-shape check the API side uses in
// `internal-runtime-email-send.service.ts` — reject malformed addresses here
// so the model gets a precise `invalid_arguments` reason instead of a
// generic failure round-tripping through the internal API.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

// ADR-169 — the internal API returns a bare reason code and never guidance
// copy, so the Russian sentence the model relays verbatim lives here. Each
// skip reason has a different concrete fix; a single string would tell a user
// who hit the provider's daily limit to reconnect a working mailbox.
const SKIP_GUIDANCE_BY_REASON: Record<string, string> = {
  mailbox_not_connected:
    "Подключите почтовый ящик в Настройках → Интеграции → Email, затем повторите отправку.",
  mailbox_token_invalid:
    "Доступ к почтовому ящику отозван. Переподключите его в Настройках → Интеграции → Email.",
  provider_daily_limit_reached:
    "Достигнут суточный лимит отправки у почтового провайдера. Повторите отправку позже."
};

const DEFAULT_SKIP_GUIDANCE =
  "Проверьте подключение почтового ящика в Настройках → Интеграции → Email.";

export interface RuntimeEmailSendToolExecutionResult {
  payload: RuntimeEmailSendToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeEmailSendToolService {
  private readonly logger = new Logger(RuntimeEmailSendToolService.name);

  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    requestId: string;
    chatId?: string | null;
  }): Promise<RuntimeEmailSendToolExecutionResult> {
    if (isToolContractDescribeCall(params.toolCall.arguments)) {
      return executeRuntimeToolContractDescribe({
        bundle: params.bundle,
        toolCode: EMAIL_SEND_TOOL_CODE
      }) as unknown as RuntimeEmailSendToolExecutionResult;
    }

    const request = this.readEmailSendArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      this.logger.warn(
        `[email-send] requestId=${params.requestId} skipped reason=invalid_arguments: ${request.message}`
      );
      return {
        payload: {
          toolCode: EMAIL_SEND_TOOL_CODE,
          executionMode: "worker",
          to: this.asNonEmptyString(params.toolCall.arguments.to),
          subject: this.asNonEmptyString(params.toolCall.arguments.subject),
          action: "skipped",
          reason: "invalid_arguments",
          warning: request.message
        },
        artifacts: [],
        isError: true
      };
    }

    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, EMAIL_SEND_TOOL_CODE);
    if (policy === null) {
      return {
        payload: {
          toolCode: EMAIL_SEND_TOOL_CODE,
          executionMode: "worker",
          to: request.to,
          subject: request.subject,
          action: "skipped",
          reason: "tool_unavailable",
          warning: null
        },
        artifacts: [],
        isError: false
      };
    }

    // ADR-168 D6 — reuse the existing shared daily-limit mechanism exactly as
    // `browser` and `tts` do. No second counter, no email-specific quota table.
    const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
      assistantId: params.bundle.metadata.assistantId,
      toolCode: EMAIL_SEND_TOOL_CODE,
      dailyCallLimit: policy.dailyCallLimit
    });
    if (!quotaOutcome.allowed) {
      return {
        payload: {
          toolCode: EMAIL_SEND_TOOL_CODE,
          executionMode: "worker",
          to: request.to,
          subject: request.subject,
          action: "skipped",
          reason: quotaOutcome.code,
          guidance: quotaOutcome.message,
          warning: null
        },
        artifacts: [],
        isError: false
      };
    }

    try {
      const outcome = await this.persaiInternalApiClientService.sendAssistantEmail({
        workspaceId: params.bundle.metadata.workspaceId,
        assistantId: params.bundle.metadata.assistantId,
        chatId: params.chatId ?? null,
        requestId: params.requestId,
        to: request.to,
        subject: request.subject,
        body: request.body
      });
      return this.mapSendOutcome(request, outcome);
    } catch (error) {
      const warning = error instanceof Error ? error.message : "Email send failed.";
      this.logger.warn(`[email-send] requestId=${params.requestId} failed: ${warning}`);
      return {
        payload: {
          toolCode: EMAIL_SEND_TOOL_CODE,
          executionMode: "worker",
          to: request.to,
          subject: request.subject,
          action: "failed",
          reason: "email_send_error",
          warning
        },
        artifacts: [],
        isError: true
      };
    }
  }

  private mapSendOutcome(
    request: RuntimeEmailSendRequest,
    outcome: SendAssistantEmailOutcome
  ): RuntimeEmailSendToolExecutionResult {
    if (outcome.status === "sent") {
      return {
        payload: {
          toolCode: EMAIL_SEND_TOOL_CODE,
          executionMode: "worker",
          to: request.to,
          subject: request.subject,
          action: "sent",
          reason: null,
          messageId: outcome.messageId
        },
        artifacts: [],
        isError: false
      };
    }
    if (outcome.status === "skipped") {
      return {
        payload: {
          toolCode: EMAIL_SEND_TOOL_CODE,
          executionMode: "worker",
          to: request.to,
          subject: request.subject,
          action: "skipped",
          reason: outcome.reason,
          guidance: SKIP_GUIDANCE_BY_REASON[outcome.reason] ?? DEFAULT_SKIP_GUIDANCE
        },
        artifacts: [],
        isError: false
      };
    }
    return {
      payload: {
        toolCode: EMAIL_SEND_TOOL_CODE,
        executionMode: "worker",
        to: request.to,
        subject: request.subject,
        action: "failed",
        reason: outcome.reason,
        warning: outcome.message ?? null
      },
      artifacts: [],
      isError: true
    };
  }

  private readEmailSendArguments(args: Record<string, unknown>): RuntimeEmailSendRequest | Error {
    const allowedKeys = new Set(["action", "to", "subject", "body"]);
    const unknownKeys = Object.keys(args).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
      return new Error(
        `Unexpected arguments: ${unknownKeys.join(", ")}. email_send accepts exactly one plain-text recipient — no cc, bcc, recipient lists, attachments, or html.`
      );
    }
    if (args.action !== undefined && args.action !== null && args.action !== "describe") {
      return new Error('action must be "describe" when provided.');
    }
    if (Array.isArray(args.to)) {
      return new Error("to must be exactly one recipient email address, not an array.");
    }
    const to = this.asNonEmptyString(args.to);
    if (to === null) {
      return new Error("to must be a non-empty recipient email address.");
    }
    if (!EMAIL_REGEX.test(to)) {
      return new Error("to must be a valid email address.");
    }
    const subject = this.asNonEmptyString(args.subject);
    if (subject === null) {
      return new Error("subject must be a non-empty string.");
    }
    const body = this.asNonEmptyString(args.body);
    if (body === null) {
      return new Error("body must be a non-empty string.");
    }
    return { toolCode: EMAIL_SEND_TOOL_CODE, to, subject, body };
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

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
