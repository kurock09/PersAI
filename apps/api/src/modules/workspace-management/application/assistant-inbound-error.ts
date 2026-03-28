import { HttpStatus } from "@nestjs/common";
import {
  ApiErrorHttpException,
  type ApiErrorCategory,
  type ApiErrorObject
} from "../../platform-core/interface/http/api-error";
import { AssistantRuntimeAdapterError } from "./assistant-runtime-adapter.types";

export type AssistantInboundFailurePayload = {
  code: string;
  message: string;
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

function normalizeRuntimeAdapterError(error: AssistantRuntimeAdapterError): {
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
  if (error instanceof AssistantRuntimeAdapterError) {
    const normalized = normalizeRuntimeAdapterError(error);
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

export function toAssistantInboundFailurePayload(error: unknown): AssistantInboundFailurePayload {
  const normalized = toAssistantInboundHttpException(error);
  return {
    code: normalized.errorObject.code,
    message: normalized.errorObject.message
  };
}
