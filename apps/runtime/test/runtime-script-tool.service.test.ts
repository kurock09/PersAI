import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import type { RuntimeBundleSkillScenarioScriptRef } from "@persai/runtime-contract";
import { RuntimeScriptToolService } from "../src/modules/turns/runtime-script-tool.service";
import type { ResolvedActiveScenarioStep } from "../src/modules/turns/build-active-scenario-block.service";
import { buildScriptToolInputSchema } from "../src/modules/turns/native-tool-projection";

const skillId = "skill-1";
const scriptVersionId = "version-1";

function scriptRef(overrides: Partial<RuntimeBundleSkillScenarioScriptRef> = {}) {
  return {
    scriptKey: "sample_script",
    scriptId: "script-1",
    scriptVersionId,
    versionNumber: 3,
    contentHash: "a".repeat(64),
    inputMapping: {
      query: { source: "current_user_message" },
      limit: { source: "literal", value: 10 },
      format: { source: "tool_input", name: "format" }
    },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        format: { type: "string" }
      },
      required: ["query", "limit"],
      additionalProperties: false
    },
    ...overrides
  } satisfies RuntimeBundleSkillScenarioScriptRef;
}

function activeStep(
  overrides: Partial<RuntimeBundleSkillScenarioScriptRef> | null = {}
): ResolvedActiveScenarioStep {
  return {
    skillId,
    scenarioKey: "scenario-1",
    scenario: {} as never,
    stepIndex: 0,
    step: {
      number: 1,
      directive: "Run the report Script.",
      recommendedToolCall: null,
      mayBeSkippedIf: null,
      negativeGuards: [],
      scriptRef: overrides === null ? null : scriptRef(overrides)
    }
  };
}

function bundle(sandboxEnabled = true, maxProcessRuntimeMs = 15_000) {
  return {
    metadata: {
      assistantId: "assistant-1",
      assistantHandle: "assistant-handle",
      siblingAssistantHandles: [],
      workspaceId: "workspace-1"
    },
    runtime: {
      sandbox: sandboxEnabled
        ? { enabled: true, maxProcessRuntimeMs }
        : { enabled: false, maxProcessRuntimeMs }
    }
  } as never;
}

function toolCall(args: Record<string, unknown>, id = "call-1") {
  return { id, name: "script", arguments: args };
}

const successArtifact = () => ({
  ok: true as const,
  scriptId: "script-1",
  scriptKey: "sample_script",
  scriptVersionId,
  versionNumber: 3,
  contentHash: "a".repeat(64),
  runtime: "bash",
  entryCommand: "bash -lc 'echo ok'",
  manifest: { schemaVersion: 1 as const, workingDirectory: null, environment: {} },
  inputSchema: scriptRef().inputSchema,
  outputSchema: {
    type: "object",
    properties: { result: { type: "string" } },
    required: ["result"],
    additionalProperties: false
  },
  limits: { timeoutMs: 1000, maxMemoryMb: 128, maxCpuMillicores: 500, maxOutputBytes: 1024 }
});

function buildService(input: {
  fetchArtifact?: (args: unknown) => Promise<unknown>;
  waitForCompletion?: (request: Record<string, unknown>) => Promise<unknown>;
  findTerminalScriptReplay?: (request: Record<string, unknown>) => Promise<unknown>;
  sandboxConfigured?: boolean;
  registerBroker?: (args: Record<string, unknown>) => Promise<unknown>;
}) {
  const submittedRequests: Array<Record<string, unknown>> = [];
  const brokerRegistrations: Array<Record<string, unknown>> = [];
  const sandboxClientService = {
    isConfigured: () => input.sandboxConfigured ?? true,
    async findTerminalScriptReplay(request: Record<string, unknown>) {
      return (await input.findTerminalScriptReplay?.(request)) ?? null;
    },
    async waitForCompletion(request: Record<string, unknown>) {
      submittedRequests.push(request);
      return (
        input.waitForCompletion?.(request) ?? {
          jobId: "job-1",
          status: "completed",
          reason: null,
          warning: null,
          violationCode: null,
          violationMessage: null,
          content: JSON.stringify({ result: "ok" })
        }
      );
    }
  };
  const persaiInternalApiClientService = {
    fetchScriptVersionArtifact: input.fetchArtifact ?? (async () => successArtifact())
  };
  const scriptBrowserBrokerService = {
    async register(args: Record<string, unknown>) {
      brokerRegistrations.push(args);
      return (
        (await input.registerBroker?.(args)) ?? {
          binding: {
            brokerId: "broker-id",
            authToken: "broker-token",
            expiresAt: "2099-01-01T00:00:00.000Z"
          },
          bindSandboxJob: () => undefined,
          close: () => undefined
        }
      );
    }
  };
  const service = new RuntimeScriptToolService(
    sandboxClientService as never,
    persaiInternalApiClientService as never,
    scriptBrowserBrokerService as never
  );
  return { service, submittedRequests, brokerRegistrations };
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    bundle: bundle(),
    toolCall: toolCall({ action: "execute", input: { format: "json" } }),
    activeScenarioStep: activeStep(),
    sessionId: "session-1",
    requestId: "request-1",
    currentUserMessageText: "hello world",
    ...overrides
  };
}

export async function runRuntimeScriptToolServiceTest(): Promise<void> {
  await test("skips when no active Scenario step / no materialized scriptRef is bound", async () => {
    const { service } = buildService({});
    const result = await service.executeToolCall(baseParams({ activeScenarioStep: null }) as never);
    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "script_not_active");
  });

  await test("skips when the active step has no materialized scriptRef", async () => {
    const { service } = buildService({});
    const result = await service.executeToolCall(
      baseParams({ activeScenarioStep: activeStep(null) }) as never
    );
    assert.equal(result.payload.reason, "script_not_active");
  });

  await test("skips when the sandbox is not configured/enabled", async () => {
    const { service } = buildService({ sandboxConfigured: false });
    const result = await service.executeToolCall(baseParams() as never);
    assert.equal(result.payload.reason, "sandbox_unconfigured");
  });

  await test("skips immediately when the turn's abort signal is already aborted (Stop)", async () => {
    const { service } = buildService({});
    const controller = new AbortController();
    controller.abort();
    const result = await service.executeToolCall(
      baseParams({ abortSignal: controller.signal }) as never
    );
    assert.equal(result.payload.reason, "user_stopped");
  });

  await test("rejects malformed tool-call arguments (not {action:execute,input:object})", async () => {
    const { service } = buildService({});
    const wrongAction = await service.executeToolCall(
      baseParams({ toolCall: toolCall({ action: "list" }) }) as never
    );
    assert.equal(wrongAction.payload.reason, "invalid_arguments");

    const nonObjectInput = await service.executeToolCall(
      baseParams({ toolCall: toolCall({ action: "execute", input: "not-an-object" }) }) as never
    );
    assert.equal(nonObjectInput.payload.reason, "invalid_arguments");

    const arrayInput = await service.executeToolCall(
      baseParams({ toolCall: toolCall({ action: "execute", input: [] }) }) as never
    );
    assert.equal(arrayInput.payload.reason, "invalid_arguments");

    const extraField = await service.executeToolCall(
      baseParams({
        toolCall: toolCall({ action: "execute", input: {}, scriptVersionId: "model-choice" })
      }) as never
    );
    assert.equal(extraField.payload.reason, "invalid_arguments");
  });

  await test("rejects omitted input even when no tool_input source is authored", async () => {
    const { service, submittedRequests } = buildService({});
    const noToolInputMapping = activeStep({
      inputMapping: {
        query: { source: "current_user_message" },
        limit: { source: "literal", value: 10 }
      },
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        required: ["query", "limit"],
        additionalProperties: false
      }
    });
    const result = await service.executeToolCall(
      baseParams({
        activeScenarioStep: noToolInputMapping,
        toolCall: toolCall({ action: "execute" })
      }) as never
    );
    assert.equal(result.isError, true);
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.equal(submittedRequests.length, 0);
  });

  await test("propagates the internal artifact API's live-authorization failure verbatim (archived/unlinked/hash/key mismatch)", async () => {
    const { service } = buildService({
      fetchArtifact: async () => ({
        ok: false,
        code: "runtime_script_archived",
        message: "The Script has been archived."
      })
    });
    const result = await service.executeToolCall(baseParams() as never);
    assert.equal(result.payload.reason, "runtime_script_archived");
    assert.equal(result.payload.warning, "The Script has been archived.");
  });

  await test("maps literal, current_user_message, and tool_input sources exactly as authored", async () => {
    const { service, submittedRequests } = buildService({});
    await service.executeToolCall(
      baseParams({
        currentUserMessageText: "what is the weather",
        toolCall: toolCall({ action: "execute", input: { format: "csv" } })
      }) as never
    );
    const mapped = (submittedRequests[0]!.args as { input: Record<string, unknown> }).input;
    assert.deepEqual(
      { ...mapped },
      {
        query: "what is the weather",
        limit: 10,
        format: "csv"
      }
    );
    assert.equal(Object.getPrototypeOf(mapped), null);
  });

  await test("browser broker TTL is clamped to sandbox maxProcessRuntimeMs, not Script timeout alone", async () => {
    const browserStep = activeStep({
      inputMapping: {
        ...scriptRef().inputMapping,
        profile: { source: "literal", value: "Work" }
      },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          format: { type: "string" },
          profile: { type: "string" }
        },
        required: ["query", "limit", "profile"],
        additionalProperties: false
      }
    });
    const { service, brokerRegistrations } = buildService({
      fetchArtifact: async () => ({
        ...successArtifact(),
        limits: {
          timeoutMs: 120_000,
          maxMemoryMb: 128,
          maxCpuMillicores: 500,
          maxOutputBytes: 1024
        },
        manifest: {
          ...successArtifact().manifest,
          capabilities: { browser: { actions: ["snapshot", "act"] } }
        },
        inputSchema: browserStep.step.scriptRef?.inputSchema ?? {}
      })
    });
    await service.executeToolCall(
      baseParams({
        bundle: bundle(true, 15_000),
        activeScenarioStep: browserStep,
        toolCall: toolCall({ action: "execute", input: { format: "json", profile: "Work" } }),
        transportSurface: "web",
        bridgeDeviceId: "device-1",
        bridgeDeviceKind: "desktop_extension"
      }) as never
    );
    assert.equal(brokerRegistrations.length, 1);
    assert.equal(
      brokerRegistrations[0]?.ttlMs,
      75_000,
      "broker TTL must be process budget (15s) + 60s pre-open lease-wait slack"
    );
    assert.notEqual(
      brokerRegistrations[0]?.ttlMs,
      120_000,
      "Script timeout alone must not mint a broker that outlives sandbox deadline+slack"
    );
  });

  await test("browser-capable immutable manifest registers and forwards only an ephemeral broker binding", async () => {
    const browserStep = activeStep({
      inputMapping: {
        ...scriptRef().inputMapping,
        profile: { source: "literal", value: "Work" }
      },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          format: { type: "string" },
          profile: { type: "string" }
        },
        required: ["query", "limit", "profile"],
        additionalProperties: false
      }
    });
    const { service, submittedRequests, brokerRegistrations } = buildService({
      fetchArtifact: async () => ({
        ...successArtifact(),
        manifest: {
          ...successArtifact().manifest,
          capabilities: { browser: { actions: ["snapshot", "act"] } }
        },
        inputSchema: browserStep.step.scriptRef?.inputSchema ?? {}
      })
    });
    await service.executeToolCall(
      baseParams({
        activeScenarioStep: browserStep,
        chatId: "chat-1",
        transportSurface: "web",
        bridgeDeviceId: "device-1",
        bridgeDeviceKind: "desktop_extension"
      }) as never
    );
    assert.equal(brokerRegistrations.length, 1);
    assert.equal(brokerRegistrations[0]?.allowedProfile, "Work");
    assert.deepEqual(submittedRequests[0]?.scriptBrowserBroker, {
      brokerId: "broker-id",
      authToken: "broker-token",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    assert.equal(JSON.stringify(submittedRequests[0]?.args).includes("broker-token"), false);
  });

  await test("ordinary Script execution does not touch the browser broker", async () => {
    const { service, submittedRequests, brokerRegistrations } = buildService({});
    await service.executeToolCall(baseParams() as never);
    assert.equal(brokerRegistrations.length, 0);
    assert.equal(submittedRequests[0]?.scriptBrowserBroker, null);
  });

  await test("browser-capable Script fails closed before sandbox submit when Redis broker registration fails", async () => {
    const browserStep = activeStep({
      inputMapping: {
        ...scriptRef().inputMapping,
        profile: { source: "literal", value: "Work" }
      },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          format: { type: "string" },
          profile: { type: "string" }
        },
        required: ["query", "limit", "profile"],
        additionalProperties: false
      }
    });
    const { service, submittedRequests } = buildService({
      fetchArtifact: async () => ({
        ...successArtifact(),
        manifest: {
          ...successArtifact().manifest,
          capabilities: { browser: { actions: ["snapshot", "act"] } }
        },
        inputSchema: browserStep.step.scriptRef?.inputSchema ?? {}
      }),
      registerBroker: async () => {
        throw new Error("redis unavailable");
      }
    });
    const result = await service.executeToolCall(
      baseParams({ activeScenarioStep: browserStep }) as never
    );
    assert.equal(result.payload.reason, "script_browser_broker_unavailable");
    assert.equal(submittedRequests.length, 0);
  });

  await test("terminal browser Script replay returns persisted output without a live broker", async () => {
    const browserStep = activeStep({
      inputMapping: {
        ...scriptRef().inputMapping,
        profile: { source: "literal", value: "Work" }
      },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          format: { type: "string" },
          profile: { type: "string" }
        },
        required: ["query", "limit", "profile"],
        additionalProperties: false
      }
    });
    const replayLookups: Array<Record<string, unknown>> = [];
    const { service, submittedRequests, brokerRegistrations } = buildService({
      fetchArtifact: async () => ({
        ...successArtifact(),
        manifest: {
          ...successArtifact().manifest,
          capabilities: { browser: { actions: ["snapshot", "act"] } }
        },
        inputSchema: browserStep.step.scriptRef?.inputSchema ?? {}
      }),
      findTerminalScriptReplay: async (request) => {
        replayLookups.push(request);
        return {
          jobId: "persisted-job",
          status: "completed",
          reason: null,
          warning: null,
          violationCode: null,
          violationMessage: null,
          content: JSON.stringify({ result: "persisted" })
        };
      },
      registerBroker: async () => {
        throw new Error("redis unavailable");
      }
    });
    const result = await service.executeToolCall(
      baseParams({ activeScenarioStep: browserStep }) as never
    );
    assert.equal(result.isError, false);
    assert.deepEqual(result.payload.output, { result: "persisted" });
    assert.equal(replayLookups.length, 1);
    assert.match(String(replayLookups[0]?.scriptInputHash), /^[0-9a-f]{64}$/);
    assert.equal(brokerRegistrations.length, 0);
    assert.equal(submittedRequests.length, 0);
  });

  await test("dynamic provider input schema preserves local refs and combines shared model fields", () => {
    const schema = buildScriptToolInputSchema(
      scriptRef({
        inputMapping: {
          first: { source: "tool_input", name: "shared" },
          second: { source: "tool_input", name: "shared" }
        },
        inputSchema: {
          type: "object",
          $defs: { nonEmpty: { type: "string", minLength: 1 } },
          properties: {
            first: { $ref: "#/$defs/nonEmpty" },
            second: { type: "string", maxLength: 8 }
          },
          required: ["first", "second"],
          additionalProperties: false
        }
      })
    );
    const validate = new Ajv2020({ strict: true }).compile(schema);
    assert.equal(validate({ shared: "valid" }), true);
    assert.equal(validate({ shared: "" }), false);
    assert.equal(validate({ shared: "too-long-value" }), false);
    const serialized = JSON.stringify(schema);
    assert.ok(!serialized.includes(scriptVersionId));
    assert.ok(!serialized.includes("script-1"));
    assert.ok(!serialized.includes("entryCommand"));
  });

  await test("leaves a tool_input field absent (not null) when the model omits it, surfacing as an ordinary required-field validation failure", async () => {
    const { service } = buildService({
      fetchArtifact: async () => ({
        ...successArtifact(),
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
            format: { type: "string" }
          },
          required: ["query", "limit", "format"],
          additionalProperties: false
        }
      })
    });
    const result = await service.executeToolCall(
      baseParams({ toolCall: toolCall({ action: "execute", input: {} }) }) as never
    );
    assert.equal(result.payload.reason, "script_input_invalid");
    assert.match(result.payload.warning ?? "", /format/);
  });

  await test("fails closed with script_input_invalid when the mapped input violates the published input schema", async () => {
    const { service } = buildService({
      fetchArtifact: async () => ({
        ...successArtifact(),
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" }, limit: { type: "number" } },
          required: ["query", "limit"],
          additionalProperties: false
        }
      })
    });
    const result = await service.executeToolCall(
      baseParams({
        activeScenarioStep: activeStep({
          inputMapping: {
            query: { source: "literal", value: 42 },
            limit: { source: "literal", value: 10 }
          }
        })
      }) as never
    );
    assert.equal(result.payload.reason, "script_input_invalid");
  });

  await test("derives a deterministic scriptInvocationKey from requestId+toolCallId+scriptVersionId (same triple => same key)", async () => {
    const { service, submittedRequests } = buildService({});
    await service.executeToolCall(
      baseParams({
        requestId: "req-A",
        toolCall: toolCall({ action: "execute", input: { format: "json" } }, "call-A")
      }) as never
    );
    await service.executeToolCall(
      baseParams({
        requestId: "req-A",
        toolCall: toolCall({ action: "execute", input: { format: "json" } }, "call-A")
      }) as never
    );
    const keys = submittedRequests.map((request) => request.scriptInvocationKey);
    assert.equal(keys[0], keys[1]);
    assert.equal(typeof keys[0], "string");
    assert.ok((keys[0] as string).length > 0 && (keys[0] as string).length <= 48);
  });

  await test("derives a different scriptInvocationKey for a different tool-call id in the same request", async () => {
    const { service, submittedRequests } = buildService({});
    await service.executeToolCall(
      baseParams({
        requestId: "req-B",
        toolCall: toolCall({ action: "execute", input: { format: "json" } }, "call-1")
      }) as never
    );
    await service.executeToolCall(
      baseParams({
        requestId: "req-B",
        toolCall: toolCall({ action: "execute", input: { format: "json" } }, "call-2")
      }) as never
    );
    const [first, second] = submittedRequests.map((request) => request.scriptInvocationKey);
    assert.notEqual(first, second);
  });

  await test("passes exact Script capability pin to the sandbox job request", async () => {
    const { service, submittedRequests } = buildService({});
    await service.executeToolCall(baseParams() as never);
    assert.equal(submittedRequests[0]!.toolCode, "script.execute");
    assert.equal(submittedRequests[0]!.scriptVersionId, scriptVersionId);
    assert.equal(submittedRequests[0]!.scriptSkillId, skillId);
    assert.equal(submittedRequests[0]!.scriptContentHash, "a".repeat(64));
  });

  await test("maps a blocked sandbox job (policy preflight) to action=blocked", async () => {
    const { service } = buildService({
      waitForCompletion: async () => ({
        jobId: "job-blocked",
        status: "blocked",
        reason: "sandbox_daily_job_limit_reached",
        warning: "Daily Script limit reached.",
        violationCode: null,
        violationMessage: null,
        content: null
      })
    });
    const result = await service.executeToolCall(baseParams() as never);
    assert.equal(result.payload.action, "blocked");
    assert.equal(result.payload.reason, "sandbox_daily_job_limit_reached");
  });

  await test("maps a non-blocked, non-completed sandbox job to action=skipped", async () => {
    const { service } = buildService({
      waitForCompletion: async () => ({
        jobId: "job-failed",
        status: "failed",
        reason: "sandbox_execution_error",
        warning: "Script exited non-zero.",
        violationCode: null,
        violationMessage: null,
        content: null
      })
    });
    const result = await service.executeToolCall(baseParams() as never);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "sandbox_execution_error");
  });

  await test("skips when a completed job still carries a non-null reason (idempotency conflict replay, etc.)", async () => {
    const { service } = buildService({
      waitForCompletion: async () => ({
        jobId: "job-conflict",
        status: "completed",
        reason: "idempotency_conflict",
        warning: "Input changed for the same invocation key.",
        violationCode: null,
        violationMessage: null,
        content: null
      })
    });
    const result = await service.executeToolCall(baseParams() as never);
    assert.equal(result.payload.reason, "idempotency_conflict");
    assert.equal(result.isError, true);
  });

  await test("fails closed with script_output_not_json when the Script's stdout protocol result is not valid JSON", async () => {
    const { service } = buildService({
      waitForCompletion: async () => ({
        jobId: "job-badjson",
        status: "completed",
        reason: null,
        warning: null,
        violationCode: null,
        violationMessage: null,
        content: "not json"
      })
    });
    const result = await service.executeToolCall(baseParams() as never);
    assert.equal(result.payload.reason, "script_output_not_json");
  });

  await test("fails closed with script_output_schema_invalid when the parsed result violates the published output schema", async () => {
    const { service } = buildService({
      waitForCompletion: async () => ({
        jobId: "job-badoutput",
        status: "completed",
        reason: null,
        warning: null,
        violationCode: null,
        violationMessage: null,
        content: JSON.stringify({ unexpected: true })
      })
    });
    const result = await service.executeToolCall(baseParams() as never);
    assert.equal(result.payload.reason, "script_output_schema_invalid");
  });

  await test("returns the validated output on a fully successful execution", async () => {
    const { service } = buildService({
      waitForCompletion: async () => ({
        jobId: "job-ok",
        status: "completed",
        reason: null,
        warning: null,
        violationCode: null,
        violationMessage: null,
        content: JSON.stringify({ result: "ok" })
      })
    });
    const result = await service.executeToolCall(baseParams() as never);
    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "completed");
    assert.deepEqual(result.payload.output, { result: "ok" });
    assert.equal(result.payload.jobId, "job-ok");
    assert.equal(result.payload.scriptKey, "sample_script");
    assert.equal(result.payload.versionNumber, 3);
  });

  await test("maps an AbortError thrown mid-execution (Stop during the sandbox wait) to user_stopped", async () => {
    const { service } = buildService({
      waitForCompletion: async () => {
        throw new DOMException("Sandbox job cancelled.", "AbortError");
      }
    });
    const result = await service.executeToolCall(baseParams() as never);
    assert.equal(result.payload.reason, "user_stopped");
  });
}
