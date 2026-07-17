import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeSandboxJobRequest } from "@persai/runtime-contract";
import { LocalBrowserBridgeClient } from "../src/modules/turns/local-browser-bridge.client.service";
import { RuntimeSandboxToolService } from "../src/modules/turns/runtime-sandbox-tool.service";
import { SandboxClientService } from "../src/modules/turns/sandbox-client.service";

function createConfig(): RuntimeConfig {
  return {
    RUNTIME_SANDBOX_BASE_URL: "http://sandbox.test",
    PERSAI_INTERNAL_API_TOKEN: "token",
    RUNTIME_SANDBOX_TIMEOUT_MS: 5_000,
    RUNTIME_SANDBOX_POD_PROVISION_BUDGET_MS: 1_000
  } as RuntimeConfig;
}

export async function runAdr149ToolAbortOnStopTest(): Promise<void> {
  await test("SandboxClientService waitForCompletion aborts when signal is already aborted", async () => {
    const requests: Array<{ path: string; method: string }> = [];
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = new URL(url).pathname;
      requests.push({ path, method: init?.method ?? "GET" });
      if (path === "/api/v1/jobs" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            jobId: "job-1",
            status: "running",
            toolCode: "shell",
            reason: null,
            warning: null,
            violationCode: null,
            violationMessage: null,
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null,
            files: []
          }),
          { status: 200 }
        );
      }
      if (path === "/api/v1/jobs/job-1/cancel") {
        return new Response(
          JSON.stringify({
            jobId: "job-1",
            status: "cancelled",
            toolCode: "shell",
            reason: "user_stopped",
            warning: "cancelled",
            violationCode: "user_stopped",
            violationMessage: "cancelled",
            exitCode: null,
            stdout: null,
            stderr: null,
            content: null,
            files: []
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      const service = new SandboxClientService(createConfig());
      await assert.rejects(
        () =>
          service.waitForCompletion(
            {
              assistantId: "assistant-1",
              assistantHandle: "a-test",
              siblingHandles: [],
              workspaceId: "workspace-1",
              runtimeRequestId: "req-1",
              runtimeSessionId: "session-1",
              toolCode: "shell",
              policy: {
                enabled: true,
                maxSingleFileWriteBytes: 1,
                maxWorkspaceBytesPerJob: 1,
                maxPersistedArtifactsPerJob: 1,
                maxFileCountPerJob: 1,
                maxDirectoryCountPerJob: 1,
                maxProcessRuntimeMs: 1_000,
                maxCpuMsPerJob: 1_000,
                maxMemoryBytesPerJob: 1_000,
                maxConcurrentProcesses: 1,
                maxStdoutBytes: 1_000,
                maxStderrBytes: 1_000,
                artifactMimeAllowlist: [],
                webMaxOutboundBytes: 1_000,
                telegramMaxOutboundBytes: 1_000,
                sandboxJobsPerDay: null,
                maxArtifactSendCountPerTurn: 1
              },
              args: { command: "sleep 30" },
              scriptVersionId: null,
              scriptSkillId: null,
              scriptContentHash: null,
              scriptInvocationKey: null
            } satisfies RuntimeSandboxJobRequest,
            { signal: AbortSignal.abort() }
          ),
        (error: unknown) => error instanceof DOMException && error.name === "AbortError"
      );
      assert.ok(requests.some((entry) => entry.path.endsWith("/cancel")));
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("RuntimeSandboxToolService maps abort to user_stopped skip", async () => {
    const sandboxClient = {
      isConfigured: () => true,
      waitForCompletion: async () => {
        throw new DOMException("aborted", "AbortError");
      }
    };
    const persaiInternalApiClientService = {
      consumeToolDailyLimit: async () => ({ allowed: true })
    };
    const service = new RuntimeSandboxToolService(
      sandboxClient as never,
      persaiInternalApiClientService as never,
      null as never
    );
    const result = await service.executeToolCall({
      bundle: {
        metadata: {
          assistantId: "assistant-1",
          assistantHandle: "a-test",
          siblingAssistantHandles: [],
          workspaceId: "workspace-1"
        },
        governance: {
          toolPolicies: [
            {
              toolCode: "shell",
              executionMode: "sandbox",
              enabled: true,
              visibleToModel: true,
              usageRule: "allowed",
              dailyCallLimit: null
            }
          ]
        },
        runtime: { sandbox: { enabled: true, maxProcessRuntimeMs: 1_000 } }
      } as never,
      toolCall: { id: "tc-1", name: "shell", arguments: { command: "echo hi" } },
      sessionId: "session-1",
      requestId: "req-1",
      abortSignal: AbortSignal.abort()
    });
    assert.equal(result.payload.reason, "user_stopped");
    assert.equal(result.isError, true);
  });

  await test("LocalBrowserBridgeClient stops polling when abort signal fires", async () => {
    const persaiInternalApiClientService = {
      dispatchLocalBrowserCommand: async () => ({
        accepted: true,
        commandId: "cmd-1",
        bridgeDeviceId: "device-1",
        deviceKind: "desktop_extension"
      }),
      getLocalBrowserCommandResult: async () => ({ status: "pending" as const })
    };
    const client = new LocalBrowserBridgeClient(persaiInternalApiClientService as never);
    const controller = new AbortController();
    controller.abort();
    const outcome = await client.executeCommand({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      command: {
        commandId: "cmd-1",
        profileKey: "default",
        action: "snapshot"
      },
      abortSignal: controller.signal
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.code, "user_stopped");
    }
  });

  await test("ProviderGatewayClientService.webFetch aborts when signal is already aborted", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      throw new Error("fetch should not run without an aborted signal");
    }) as typeof fetch;

    try {
      const { ProviderGatewayClientService } =
        await import("../src/modules/turns/provider-gateway.client.service");
      const service = new ProviderGatewayClientService({
        RUNTIME_PROVIDER_GATEWAY_BASE_URL: "http://gateway.test",
        RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: 5_000
      } as never);
      await assert.rejects(
        () =>
          service.webFetch(
            {
              url: "https://example.com",
              extractMode: "markdown",
              maxChars: 1_000,
              credential: {
                toolCode: "web_fetch",
                secretId: "secret-1",
                providerId: null
              }
            },
            { signal: AbortSignal.abort() }
          ),
        (error: unknown) => error instanceof DOMException && error.name === "AbortError"
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
}
