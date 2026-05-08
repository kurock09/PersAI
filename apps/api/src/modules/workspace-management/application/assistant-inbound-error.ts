import { HttpStatus } from "@nestjs/common";
import {
  ApiErrorHttpException,
  type ApiErrorCategory,
  type ApiErrorObject
} from "../../platform-core/interface/http/api-error";
import { AssistantRuntimeError } from "./assistant-runtime.facade";

export type AssistantInboundFailurePayload = {
  code: string;
  message: string;
  guidance: string | null;
};

function createApiError(
  status: number,
  code: string,
  category: ApiErrorCategory,
  message: string,
  details?: Record<string, unknown>
): ApiErrorHttpException {
  return new ApiErrorHttpException(status, {
    code,
    category,
    message,
    ...(details ? { details } : {})
  });
}

export function createAssistantInboundConflict(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ApiErrorHttpException {
  return createApiError(HttpStatus.CONFLICT, code, "conflict", message, details);
}

export function createAssistantInboundValidationError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ApiErrorHttpException {
  return createApiError(HttpStatus.BAD_REQUEST, code, "validation", message, details);
}

export function createAssistantInboundRateLimitError(
  message: string,
  details?: Record<string, unknown>
): ApiErrorHttpException {
  return createApiError(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", "conflict", message, details);
}

export function createAssistantInboundInfraError(
  code: string,
  message: string,
  status: number = HttpStatus.SERVICE_UNAVAILABLE,
  details?: Record<string, unknown>
): ApiErrorHttpException {
  return createApiError(status, code, "infra", message, details);
}

function normalizeRuntimeError(error: AssistantRuntimeError): {
  status: number;
  error: ApiErrorObject;
} {
  switch (error.code) {
    case "auth_failure":
      return {
        status: HttpStatus.BAD_GATEWAY,
        error: {
          code: "runtime_auth_failure",
          category: "infra",
          message: "Runtime authorization failed for this turn."
        }
      };
    case "timeout":
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        error: {
          code: "runtime_timeout",
          category: "infra",
          message: "The runtime timed out before completing this turn."
        }
      };
    case "runtime_degraded":
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        error: {
          code: "runtime_degraded",
          category: "infra",
          message: "Runtime is temporarily degraded."
        }
      };
    case "invalid_response":
      return {
        status: HttpStatus.BAD_GATEWAY,
        error: {
          code: "runtime_invalid_response",
          category: "infra",
          message: "Runtime returned an invalid response."
        }
      };
    case "compaction_unavailable":
      return {
        status: HttpStatus.CONFLICT,
        error: {
          code: "compaction_unavailable",
          category: "conflict",
          message: error.message
        }
      };
    case "runtime_unreachable":
    default:
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        error: {
          code: "runtime_unreachable",
          category: "infra",
          message: "Runtime is temporarily unreachable."
        }
      };
  }
}

export function toAssistantInboundHttpException(error: unknown): ApiErrorHttpException {
  if (error instanceof ApiErrorHttpException) {
    return error;
  }
  if (error instanceof AssistantRuntimeError) {
    const normalized = normalizeRuntimeError(error);
    return new ApiErrorHttpException(normalized.status, normalized.error);
  }
  if (error instanceof Error) {
    return createAssistantInboundInfraError("assistant_turn_failed", error.message);
  }
  return createAssistantInboundInfraError(
    "assistant_turn_failed",
    "Assistant turn failed unexpectedly."
  );
}

export function createWorkspaceStorageFullError(
  usedBytes: number,
  limitBytes: bigint | null
): ApiErrorHttpException {
  const usedMb = Math.round((usedBytes / 1_048_576) * 10) / 10;
  const limitMb =
    limitBytes !== null ? Math.round((Number(limitBytes) / 1_048_576) * 10) / 10 : null;
  return createApiError(
    HttpStatus.CONFLICT,
    "workspace_storage_full",
    "conflict",
    limitMb !== null
      ? `Workspace disk is full: ${usedMb} MB used out of ${limitMb} MB. Delete old chats or files to free space.`
      : "Workspace disk is full. Delete old chats or files to free space.",
    {
      usedMb,
      limitMb,
      userFacingGuidance: "Delete old chats or files to free space, then try again."
    }
  );
}

export function createMediaStorageQuotaExceededError(
  usedBytes: bigint,
  limitBytes: bigint | null
): ApiErrorHttpException {
  const usedMb = Math.round((Number(usedBytes) / 1_048_576) * 10) / 10;
  const limitMb =
    limitBytes !== null ? Math.round((Number(limitBytes) / 1_048_576) * 10) / 10 : null;
  return createApiError(
    HttpStatus.CONFLICT,
    "media_storage_quota_exceeded",
    "conflict",
    limitMb !== null
      ? `Media storage full: ${usedMb} MB used out of ${limitMb} MB.`
      : "Media storage quota exceeded.",
    {
      usedMb,
      limitMb,
      userFacingGuidance: "Delete old chats or files to free space, then try again."
    }
  );
}

export function createKnowledgeStorageQuotaExceededError(
  usedBytes: bigint,
  limitBytes: bigint | null
): ApiErrorHttpException {
  const usedMb = Math.round((Number(usedBytes) / 1_048_576) * 10) / 10;
  const limitMb =
    limitBytes !== null ? Math.round((Number(limitBytes) / 1_048_576) * 10) / 10 : null;
  return createApiError(
    HttpStatus.CONFLICT,
    "knowledge_storage_quota_exceeded",
    "conflict",
    limitMb !== null
      ? `Knowledge storage full: ${usedMb} MB used out of ${limitMb} MB.`
      : "Knowledge storage quota exceeded.",
    {
      usedMb,
      limitMb,
      userFacingGuidance:
        "Delete older knowledge-base documents or free assistant storage, then try again."
    }
  );
}

export function toAssistantInboundFailurePayload(error: unknown): AssistantInboundFailurePayload {
  const normalized = toAssistantInboundHttpException(error);
  const guidance = normalized.errorObject.details?.userFacingGuidance;
  return {
    code: normalized.errorObject.code,
    message: normalized.errorObject.message,
    guidance: typeof guidance === "string" && guidance.trim().length > 0 ? guidance : null
  };
}
