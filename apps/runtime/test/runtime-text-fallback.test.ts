import assert from "node:assert/strict";
import type { ProviderGatewayTextFailedEvent } from "@persai/runtime-contract";
import {
  ProviderGatewayHttpError,
  ProviderGatewayTimeoutError
} from "../src/modules/turns/provider-gateway.client.service";
import {
  isRetryableRuntimeTextFailure,
  isRetryableSameProviderTextStreamFailure,
  isRetryableRuntimeTextStreamFailure
} from "../src/modules/turns/runtime-text-fallback";

function createFailedEvent(
  event: Partial<ProviderGatewayTextFailedEvent> & Pick<ProviderGatewayTextFailedEvent, "code">
): ProviderGatewayTextFailedEvent {
  return {
    type: "failed",
    message: event.message ?? event.code,
    ...event
  };
}

export async function runRuntimeTextFallbackTest(): Promise<void> {
  assert.equal(isRetryableRuntimeTextFailure(new ProviderGatewayTimeoutError(15_000)), true);

  assert.equal(
    isRetryableRuntimeTextFailure(
      new ProviderGatewayHttpError(429, "Quota exceeded.", {
        providerErrorKind: "billing_quota",
        providerErrorCode: "insufficient_quota",
        providerErrorType: "billing_error",
        providerErrorStatus: 429
      })
    ),
    true
  );
  assert.equal(
    isRetryableRuntimeTextFailure(
      new ProviderGatewayHttpError(429, "Rate limited.", {
        providerErrorKind: "rate_limit",
        providerErrorCode: "rate_limit_exceeded",
        providerErrorType: "rate_limit_error",
        providerErrorStatus: 429
      })
    ),
    true
  );
  assert.equal(
    isRetryableRuntimeTextFailure(
      new ProviderGatewayHttpError(529, "Provider overloaded.", {
        providerErrorKind: "capacity",
        providerErrorCode: "overloaded_error",
        providerErrorType: "overloaded_error",
        providerErrorStatus: 529
      })
    ),
    true
  );
  assert.equal(
    isRetryableRuntimeTextFailure(
      new ProviderGatewayHttpError(401, "Invalid API key.", {
        providerErrorKind: "provider_auth",
        providerErrorCode: "invalid_api_key",
        providerErrorType: "authentication_error",
        providerErrorStatus: 401
      })
    ),
    true
  );
  assert.equal(
    isRetryableRuntimeTextFailure(
      new ProviderGatewayHttpError(503, "Gateway failed.", {
        providerErrorKind: "server_error",
        providerErrorCode: null,
        providerErrorType: null,
        providerErrorStatus: 503
      })
    ),
    true
  );
  assert.equal(
    isRetryableRuntimeTextFailure(
      new ProviderGatewayHttpError(400, "Unsupported parameter.", {
        providerErrorKind: "invalid_request",
        providerErrorCode: "unsupported_parameter",
        providerErrorType: "invalid_request_error",
        providerErrorStatus: 400
      })
    ),
    false
  );
  assert.equal(
    isRetryableRuntimeTextFailure(
      new ProviderGatewayHttpError(400, "Schema maximum is not supported.", {
        providerErrorKind: "invalid_request",
        providerErrorCode: "invalid_request",
        providerErrorType: "invalid_request_error",
        providerErrorStatus: 400
      })
    ),
    false
  );

  assert.equal(
    isRetryableRuntimeTextStreamFailure(
      createFailedEvent({
        code: "insufficient_quota",
        providerErrorKind: "billing_quota",
        providerErrorCode: "insufficient_quota",
        providerErrorType: "billing_error",
        providerErrorStatus: 429
      })
    ),
    true
  );
  assert.equal(
    isRetryableRuntimeTextStreamFailure(
      createFailedEvent({
        code: "overloaded_error",
        providerErrorKind: "capacity",
        providerErrorCode: "overloaded_error",
        providerErrorType: "overloaded_error",
        providerErrorStatus: 529
      })
    ),
    true
  );
  assert.equal(
    isRetryableRuntimeTextStreamFailure(
      createFailedEvent({
        code: "invalid_request",
        providerErrorKind: "invalid_request",
        providerErrorCode: "invalid_request",
        providerErrorType: "invalid_request_error",
        providerErrorStatus: 400
      })
    ),
    false
  );
  assert.equal(
    isRetryableRuntimeTextStreamFailure(
      createFailedEvent({
        code: "provider_stream_timeout",
        providerErrorKind: "timeout"
      })
    ),
    true
  );
  assert.equal(
    isRetryableRuntimeTextStreamFailure(
      createFailedEvent({
        code: "provider_server_error",
        message: "terminated",
        providerErrorKind: "server_error"
      })
    ),
    true
  );
  assert.equal(
    isRetryableSameProviderTextStreamFailure(
      createFailedEvent({
        code: "provider_server_error",
        message: "terminated",
        providerErrorKind: "server_error"
      })
    ),
    true
  );
  assert.equal(
    isRetryableSameProviderTextStreamFailure(
      createFailedEvent({
        code: "insufficient_quota",
        providerErrorKind: "billing_quota"
      })
    ),
    false
  );
  assert.equal(
    isRetryableRuntimeTextStreamFailure(
      createFailedEvent({
        code: "provider_stream_failed",
        providerErrorKind: null
      })
    ),
    true
  );
}

void runRuntimeTextFallbackTest();
