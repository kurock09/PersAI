import {
  Catch,
  ArgumentsHost,
  HttpException,
  type ExceptionFilter,
  HttpStatus
} from "@nestjs/common";
import { ApiErrorHttpException, type ApiErrorCategory, type ApiErrorObject } from "./api-error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim().length > 0) {
        return item.trim();
      }
    }
  }
  return null;
}

function defaultCategoryForStatus(status: number): ApiErrorCategory {
  if (status === 400) return "validation";
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 409 || status === 429) return "conflict";
  if (status >= 500) return "infra";
  return "unknown";
}

function defaultCodeForStatus(status: number): string {
  if (status === 400) return "validation_error";
  if (status === 401) return "auth_required";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "internal_error";
  return "unknown_error";
}

function normalizeHttpException(exception: HttpException): {
  status: number;
  error: ApiErrorObject;
} {
  if (exception instanceof ApiErrorHttpException) {
    return {
      status: exception.getStatus(),
      error: exception.errorObject
    };
  }

  const status = exception.getStatus();
  const response = exception.getResponse();
  if (isRecord(response)) {
    const nestedError = isRecord(response.error) ? response.error : null;
    const message =
      firstString(nestedError?.message) ??
      firstString(response.message) ??
      exception.message ??
      "Request failed.";
    const code =
      firstString(nestedError?.code) ?? firstString(response.code) ?? defaultCodeForStatus(status);
    const categoryValue =
      firstString(nestedError?.category) ??
      firstString(response.category) ??
      defaultCategoryForStatus(status);
    const category =
      categoryValue === "validation" ||
      categoryValue === "auth" ||
      categoryValue === "forbidden" ||
      categoryValue === "conflict" ||
      categoryValue === "infra" ||
      categoryValue === "unknown"
        ? categoryValue
        : defaultCategoryForStatus(status);
    const details = isRecord(nestedError?.details)
      ? nestedError.details
      : isRecord(response.details)
        ? response.details
        : undefined;
    return {
      status,
      error: {
        code,
        category,
        message,
        ...(details ? { details } : {})
      }
    };
  }

  return {
    status,
    error: {
      code: defaultCodeForStatus(status),
      category: defaultCategoryForStatus(status),
      message: exception.message || "Request failed."
    }
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();
    const request = ctx.getRequest<{ requestId?: string | null }>();

    const normalized =
      exception instanceof HttpException
        ? normalizeHttpException(exception)
        : {
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            error: {
              code: "internal_error",
              category: "infra" as const,
              message: exception instanceof Error ? exception.message : "Unexpected server error."
            }
          };

    response.status(normalized.status).json({
      requestId: request?.requestId ?? null,
      error: normalized.error
    });
  }
}
