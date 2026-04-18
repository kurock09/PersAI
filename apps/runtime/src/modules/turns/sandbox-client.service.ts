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

  async pollJob(jobId: string): Promise<RuntimeSandboxJobResult> {
    const response = await this.fetchJson(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      headers: this.buildHeaders()
    });
    return this.parseJobResponse(response);
  }

  async waitForCompletion(request: RuntimeSandboxJobRequest): Promise<RuntimeSandboxJobResult> {
    const submitted = await this.submitJob(request);
    const deadline = Date.now() + this.config.RUNTIME_SANDBOX_TIMEOUT_MS;
    let current = submitted;
    while (current.status === "queued" || current.status === "running") {
      if (Date.now() >= deadline) {
        throw new ServiceUnavailableException(
          "Sandbox job timed out while waiting for completion."
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      current = await this.pollJob(current.jobId);
    }
    return current;
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
