import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeSandboxJobRequest, RuntimeSandboxJobResult } from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../runtime-config";

type JsonResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

@Injectable()
export class SandboxClientService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.RUNTIME_SANDBOX_BASE_URL?.trim() && this.config.PERSAI_INTERNAL_API_TOKEN?.trim()
    );
  }

  async submitJob(request: RuntimeSandboxJobRequest): Promise<RuntimeSandboxJobResult> {
    const response = await this.fetchJson("/api/v1/jobs", {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(request)
    });
    return this.parseJobResponse(response);
  }

  async pollJob(jobId: string, waitMs = 0): Promise<RuntimeSandboxJobResult> {
    const query = waitMs > 0 ? `?waitMs=${String(waitMs)}` : "";
    const response = await this.fetchJson(`/api/v1/jobs/${encodeURIComponent(jobId)}${query}`, {
      method: "GET",
      headers: this.buildHeaders()
    });
    return this.parseJobResponse(response);
  }

  async waitForCompletion(request: RuntimeSandboxJobRequest): Promise<RuntimeSandboxJobResult> {
    const submitted = await this.submitJob(request);
    const deadline = Date.now() + this.resolveCompletionTimeoutMs(request);
    let current = submitted;
    while (current.status === "queued" || current.status === "running") {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new ServiceUnavailableException(
          "Sandbox job timed out while waiting for completion."
        );
      }
      current = await this.pollJob(current.jobId, Math.max(1, Math.min(remainingMs, 1_500)));
    }
    return current;
  }

  async writeWorkspaceFile(input: {
    assistantId: string;
    workspaceId: string;
    handle: string;
    siblingHandles: readonly string[];
    runtimeSessionId?: string | null;
    basename: string;
    contentBase64: string;
    mimeType: string;
    collisionStrategy?: "overwrite" | "numeric_suffix";
    workspaceQuotaBytes?: number | null;
    sharedQuotaBytes?: number | null;
  }): Promise<{ workspaceRelPath: string; sizeBytes: number }> {
    const response = await this.fetchJson("/api/v1/jobs/workspace-write", {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        handle: input.handle,
        siblingHandles: [...input.siblingHandles],
        ...(input.runtimeSessionId === undefined
          ? {}
          : { runtimeSessionId: input.runtimeSessionId }),
        basename: input.basename,
        contentBase64: input.contentBase64,
        mimeType: input.mimeType,
        collisionStrategy: input.collisionStrategy ?? "numeric_suffix",
        ...(input.workspaceQuotaBytes !== undefined
          ? { workspaceQuotaBytes: input.workspaceQuotaBytes }
          : {}),
        ...(input.sharedQuotaBytes !== undefined
          ? { sharedQuotaBytes: input.sharedQuotaBytes }
          : {})
      })
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Sandbox workspace-write failed with status ${String(response.status)}.`
      );
    }
    if (
      response.body === null ||
      typeof response.body !== "object" ||
      Array.isArray(response.body)
    ) {
      throw new BadGatewayException("Sandbox workspace-write returned an invalid response.");
    }
    const payload = response.body as Record<string, unknown>;
    if (typeof payload.workspaceRelPath !== "string" || typeof payload.sizeBytes !== "number") {
      throw new BadGatewayException("Sandbox workspace-write returned an invalid payload.");
    }
    return {
      workspaceRelPath: payload.workspaceRelPath,
      sizeBytes: payload.sizeBytes
    };
  }

  private resolveCompletionTimeoutMs(request: RuntimeSandboxJobRequest): number {
    const leaseWaitMs = Math.max(
      15_000,
      Math.min(60_000, request.policy.maxProcessRuntimeMs + 5_000)
    );
    // The end-to-end budget must cover cold-start pod provisioning (sandbox node
    // autoscale + multi-GB image pull, ~100s) in addition to lease wait + command
    // runtime. Omitting it made the runtime give up (~40s) before a cold pod was ready,
    // surfacing a spurious timeout to the model on the first sandbox call after idle.
    const expectedCompletionMs =
      this.config.RUNTIME_SANDBOX_POD_PROVISION_BUDGET_MS +
      leaseWaitMs +
      request.policy.maxProcessRuntimeMs +
      5_000;
    return Math.max(this.config.RUNTIME_SANDBOX_TIMEOUT_MS, expectedCompletionMs);
  }

  private parseJobResponse(response: JsonResponse): RuntimeSandboxJobResult {
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Sandbox service request failed with status ${String(response.status)}.`
      );
    }
    if (
      response.body === null ||
      typeof response.body !== "object" ||
      Array.isArray(response.body)
    ) {
      throw new BadGatewayException("Sandbox service returned an invalid response.");
    }
    return response.body as RuntimeSandboxJobResult;
  }

  private buildHeaders(): HeadersInit {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Sandbox service is not configured.");
    }
    return {
      Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
      "Content-Type": "application/json"
    };
  }

  private async fetchJson(path: string, init: RequestInit): Promise<JsonResponse> {
    const baseUrl = this.config.RUNTIME_SANDBOX_BASE_URL?.trim();
    if (!baseUrl) {
      throw new ServiceUnavailableException("Sandbox service base URL is not configured.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.RUNTIME_SANDBOX_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal
      });
      const text = await response.text();
      let body: unknown = null;
      if (text.trim().length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        body
      };
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : "Sandbox service request failed."
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
