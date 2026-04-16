import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { type AssistantRuntimePreflightResult } from "./assistant-runtime.facade";
import type { RuntimeTier } from "./runtime-assignment";

@Injectable()
export class AssistantRuntimePreflightService {
  async execute(runtimeTier?: RuntimeTier): Promise<AssistantRuntimePreflightResult> {
    void runtimeTier;
    const checkedAt = new Date().toISOString();
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      return {
        live: false,
        ready: false,
        checkedAt
      };
    }

    try {
      const [health, ready] = await Promise.all([
        this.fetchBooleanStatus(new URL("/health", baseUrl).toString(), "live"),
        this.fetchBooleanStatus(new URL("/ready", baseUrl).toString(), "ready")
      ]);
      return {
        live: health,
        ready,
        checkedAt
      };
    } catch {
      return {
        live: false,
        ready: false,
        checkedAt
      };
    }
  }

  private async fetchBooleanStatus(url: string, field: "live" | "ready"): Promise<boolean> {
    const response = await fetch(url);
    if (!response.ok) {
      return false;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return false;
    }
    const body = await response.json();
    return (
      body !== null && typeof body === "object" && !Array.isArray(body) && body[field] === true
    );
  }
}
