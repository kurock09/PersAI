import { resolve4 } from "node:dns/promises";
import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  OverviewExecutionWorkloadDiscoveryMode,
  OverviewExecutionWorkloadPodState,
  OverviewExecutionWorkloadState
} from "./overview-dashboard.types";

const PROBE_TIMEOUT_MS = 2_500;

type WorkloadConfig = {
  key: OverviewExecutionWorkloadState["key"];
  label: string;
  baseUrl: string | null | undefined;
  discoveryDns: string | null | undefined;
  desiredReplicas: number | null | undefined;
  autoscalingEnabled: boolean;
  autoscalingMinReplicas: number | null | undefined;
  autoscalingMaxReplicas: number | null | undefined;
};

type ProbeTargetPlan = {
  discoveryMode: OverviewExecutionWorkloadDiscoveryMode;
  discoveryTarget: string | null;
  opaque: boolean;
  addresses: string[];
  notes: string[];
};

@Injectable()
export class ResolveExecutionWorkloadOverviewService {
  async execute(): Promise<{
    runtime: OverviewExecutionWorkloadState;
    providerGateway: OverviewExecutionWorkloadState;
  }> {
    const config = loadApiConfig(process.env);
    const [runtime, providerGateway] = await Promise.all([
      this.inspectWorkload({
        key: "runtime",
        label: "Runtime",
        baseUrl: config.PERSAI_RUNTIME_BASE_URL,
        discoveryDns: config.PERSAI_RUNTIME_DISCOVERY_DNS,
        desiredReplicas: config.PERSAI_RUNTIME_TARGET_REPLICAS,
        autoscalingEnabled: config.PERSAI_RUNTIME_AUTOSCALING_ENABLED,
        autoscalingMinReplicas: config.PERSAI_RUNTIME_AUTOSCALING_MIN_REPLICAS,
        autoscalingMaxReplicas: config.PERSAI_RUNTIME_AUTOSCALING_MAX_REPLICAS
      }),
      this.inspectWorkload({
        key: "provider_gateway",
        label: "Provider gateway",
        baseUrl: config.PERSAI_PROVIDER_GATEWAY_BASE_URL,
        discoveryDns: config.PERSAI_PROVIDER_GATEWAY_DISCOVERY_DNS,
        desiredReplicas: config.PERSAI_PROVIDER_GATEWAY_TARGET_REPLICAS,
        autoscalingEnabled: config.PERSAI_PROVIDER_GATEWAY_AUTOSCALING_ENABLED,
        autoscalingMinReplicas: config.PERSAI_PROVIDER_GATEWAY_AUTOSCALING_MIN_REPLICAS,
        autoscalingMaxReplicas: config.PERSAI_PROVIDER_GATEWAY_AUTOSCALING_MAX_REPLICAS
      })
    ]);

    return {
      runtime,
      providerGateway
    };
  }

  private async inspectWorkload(config: WorkloadConfig): Promise<OverviewExecutionWorkloadState> {
    const checkedAt = new Date().toISOString();
    const normalizedBaseUrl = config.baseUrl?.trim() ?? "";
    const baseUrlConfigured = normalizedBaseUrl.length > 0;
    const endpointHost = this.toHostOrNull(normalizedBaseUrl);
    const desiredReplicas = config.desiredReplicas ?? null;
    const notes: string[] = [];

    if (!baseUrlConfigured) {
      return {
        key: config.key,
        label: config.label,
        baseUrlConfigured: false,
        endpointHost: null,
        desiredReplicas,
        autoscalingEnabled: config.autoscalingEnabled,
        autoscalingMinReplicas: config.autoscalingMinReplicas ?? null,
        autoscalingMaxReplicas: config.autoscalingMaxReplicas ?? null,
        discoveryMode: "unconfigured",
        discoveryTarget: null,
        opaque: true,
        live: false,
        ready: false,
        observedPodCount: 0,
        discoveredReadyPodCount: 0,
        checkedAt,
        notes: ["Base URL is not configured."],
        pods: []
      };
    }

    const plan = await this.resolveProbeTargets({
      baseUrl: normalizedBaseUrl,
      discoveryDns: config.discoveryDns ?? null
    });
    notes.push(...plan.notes);

    const pods =
      plan.addresses.length > 0
        ? await Promise.all(
            plan.addresses.map((address) => this.probePod(normalizedBaseUrl, address))
          )
        : [];

    let live = false;
    let ready = false;
    let discoveredReadyPodCount = 0;

    if (pods.length > 0) {
      discoveredReadyPodCount = pods.filter((pod) => pod.ready).length;
      live = pods.some((pod) => pod.live);
      ready =
        discoveredReadyPodCount > 0 &&
        (desiredReplicas === null
          ? pods.every((pod) => pod.ready)
          : discoveredReadyPodCount >= desiredReplicas);
      if (desiredReplicas !== null && discoveredReadyPodCount < desiredReplicas) {
        notes.push(
          `Only ${discoveredReadyPodCount}/${desiredReplicas} ready endpoints are discoverable through ${plan.discoveryMode === "headless_dns" ? "headless DNS" : "the configured service"}.`
        );
      }
    } else {
      const serviceProbe = await this.probePod(
        normalizedBaseUrl,
        endpointHost ?? normalizedBaseUrl
      );
      live = serviceProbe.live;
      ready = serviceProbe.ready;
      if (plan.opaque) {
        notes.push("Only service-level health is visible; per-pod truth is still opaque.");
      }
    }

    if (desiredReplicas !== null && desiredReplicas <= 1) {
      notes.push("Configured as a singleton workload.");
    }
    if (config.autoscalingEnabled) {
      notes.push(
        `Autoscaling enabled (${String(config.autoscalingMinReplicas ?? desiredReplicas ?? 1)}-${String(config.autoscalingMaxReplicas ?? desiredReplicas ?? 1)} replicas).`
      );
    } else if (desiredReplicas !== null) {
      notes.push(
        `Fixed scale target: ${desiredReplicas} replica${desiredReplicas === 1 ? "" : "s"}.`
      );
    }

    return {
      key: config.key,
      label: config.label,
      baseUrlConfigured,
      endpointHost,
      desiredReplicas,
      autoscalingEnabled: config.autoscalingEnabled,
      autoscalingMinReplicas: config.autoscalingMinReplicas ?? null,
      autoscalingMaxReplicas: config.autoscalingMaxReplicas ?? null,
      discoveryMode: plan.discoveryMode,
      discoveryTarget: plan.discoveryTarget,
      opaque: plan.opaque,
      live,
      ready,
      observedPodCount: pods.length,
      discoveredReadyPodCount,
      checkedAt,
      notes: [...new Set(notes)],
      pods
    };
  }

  private async resolveProbeTargets(input: {
    baseUrl: string;
    discoveryDns: string | null;
  }): Promise<ProbeTargetPlan> {
    const notes: string[] = [];
    const discoveryDns = input.discoveryDns?.trim() ?? "";
    if (discoveryDns.length > 0) {
      try {
        const records = [...new Set(await resolve4(discoveryDns))].sort((left, right) =>
          left.localeCompare(right)
        );
        if (records.length > 0) {
          return {
            discoveryMode: "headless_dns",
            discoveryTarget: discoveryDns,
            opaque: false,
            addresses: records,
            notes
          };
        }
        notes.push(`Headless DNS "${discoveryDns}" returned no ready endpoints.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "DNS resolution failed.";
        notes.push(`Headless DNS "${discoveryDns}" could not be resolved (${message}).`);
      }
    }

    return {
      discoveryMode: "service_base_url",
      discoveryTarget: this.toHostOrNull(input.baseUrl),
      opaque: true,
      addresses: [],
      notes
    };
  }

  private async probePod(
    baseUrl: string,
    address: string
  ): Promise<OverviewExecutionWorkloadPodState> {
    const checkedAt = new Date().toISOString();
    try {
      const url = new URL(baseUrl);
      url.hostname = address;
      const [healthResponse, readyResponse] = await Promise.all([
        this.fetchJson(new URL("/health", url).toString()),
        this.fetchJson(new URL("/ready", url).toString())
      ]);
      const live = healthResponse.ok;
      const ready = readyResponse.ok && this.readReadyFlag(readyResponse.body);
      return {
        podIp: this.isIpv4(address) ? address : "",
        address,
        live,
        ready,
        checkedAt
      };
    } catch {
      return {
        podIp: this.isIpv4(address) ? address : "",
        address,
        live: false,
        ready: false,
        checkedAt
      };
    }
  }

  private async fetchJson(url: string): Promise<{ ok: boolean; body: unknown }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const contentType = response.headers.get("content-type") ?? "";
      let body: unknown = null;
      if (contentType.includes("application/json")) {
        body = await response.json();
      }
      return {
        ok: response.ok,
        body
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private readReadyFlag(body: unknown): boolean {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return false;
    }
    return "ready" in body && body.ready === true;
  }

  private toHostOrNull(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? "";
    if (!normalized) {
      return null;
    }
    try {
      return new URL(normalized).host || null;
    } catch {
      return null;
    }
  }

  private isIpv4(value: string): boolean {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
  }
}
