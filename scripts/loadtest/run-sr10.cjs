#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function printHelp() {
  console.log(`SR10 load-test runner

Usage:
  node scripts/loadtest/run-sr10.cjs --config <path> [--profile 100,500,1000] [--report-dir <path>] [--dry-run]

Flags:
  --config       Required. JSON config path.
  --profile      Optional. Comma-separated profile ids from config.
  --report-dir   Optional. Overrides config reportDir.
  --dry-run      Validate config, resolve env-backed secrets, print plan, do not send traffic.
  --help         Show this help.
`);
}

function parseArgs(argv) {
  const args = { profiles: null, configPath: null, reportDir: null, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--config") {
      args.configPath = argv[++i] ?? null;
      continue;
    }
    if (arg === "--profile") {
      const raw = argv[++i] ?? "";
      args.profiles = raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === "--report-dir") {
      args.reportDir = argv[++i] ?? null;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.configPath) {
    throw new Error("--config is required.");
  }
  return args;
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function assertPositiveNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return value;
}

function assertNonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function resolveEnvToken(envName, label, options = {}) {
  const token = process.env[envName];
  if (typeof token !== "string" || token.trim().length === 0) {
    if (options.allowMissing === true) {
      return `__MISSING_ENV__:${envName}`;
    }
    throw new Error(`${label}: env ${envName} is required but missing.`);
  }
  return token.trim();
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return Math.round(sorted[idx]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function choiceWeighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const pick = Math.random() * total;
  let current = 0;
  for (const item of items) {
    current += item.weight;
    if (pick <= current) return item.kind;
  }
  return items[items.length - 1].kind;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${ms}ms`)),
    ms
  );
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    }
  };
}

function buildJsonHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function fetchJson(url, options, timeoutMs) {
  const startedAt = Date.now();
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: timeout.signal
    });
    const latencyMs = Date.now() - startedAt;
    const contentType = response.headers.get("content-type") ?? "";
    let payload = null;
    if (contentType.includes("application/json")) {
      payload = await response.json().catch(() => null);
    } else {
      payload = await response.text().catch(() => null);
    }
    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
      payload
    };
  } finally {
    timeout.clear();
  }
}

async function fetchSse(url, body, token, timeoutMs) {
  const startedAt = Date.now();
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildJsonHeaders(token),
      body: JSON.stringify(body),
      signal: timeout.signal
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return {
        ok: false,
        status: response.status,
        latencyMs,
        payload,
        terminalEvent: null
      };
    }

    if (!response.body) {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        payload: { error: { code: "stream_body_missing", message: "Missing SSE body." } },
        terminalEvent: null
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminalEvent = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const lines = chunk
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const eventLine = lines.find((line) => line.startsWith("event:"));
        const dataLine = lines.find((line) => line.startsWith("data:"));
        if (!eventLine || !dataLine) continue;
        const event = eventLine.slice("event:".length).trim();
        let data = null;
        try {
          data = JSON.parse(dataLine.slice("data:".length).trim());
        } catch {
          data = null;
        }
        if (event === "completed" || event === "failed" || event === "interrupted") {
          terminalEvent = { event, data };
        }
      }
      if (terminalEvent) break;
    }

    return {
      ok: terminalEvent?.event === "completed",
      status: response.status,
      latencyMs: Date.now() - startedAt,
      payload: terminalEvent?.data ?? null,
      terminalEvent
    };
  } finally {
    timeout.clear();
  }
}

function summarizePayloadError(payload) {
  if (payload && typeof payload === "object") {
    const maybeError = payload.error;
    if (maybeError && typeof maybeError === "object") {
      const code = typeof maybeError.code === "string" ? maybeError.code : "unknown_error";
      const message =
        typeof maybeError.message === "string" ? maybeError.message : JSON.stringify(maybeError);
      return { code, message };
    }
    if (typeof payload.code === "string" && typeof payload.message === "string") {
      return { code: payload.code, message: payload.message };
    }
  }
  return { code: "unknown_error", message: "Request failed without structured error payload." };
}

function buildWorkerIdentityAssignment(users, workerIndex) {
  const identityIndex = workerIndex % users.length;
  return {
    identity: users[identityIndex],
    workerSlot: Math.floor(workerIndex / users.length)
  };
}

function makeRotatingThreadKey(prefix, identityLabel, poolSize, workerSlot, requestSequence) {
  const slot = (workerSlot + requestSequence) % poolSize;
  return `${prefix}-${identityLabel}-${slot}`;
}

function makeStickyWorkerThreadKey(prefix, identityLabel, workerSlot) {
  return `${prefix}-${identityLabel}-worker-${workerSlot}`;
}

function createTextAttachment(config) {
  const text =
    typeof config.text === "string" && config.text.length > 0
      ? config.text
      : "SR10 load-test generated attachment";
  return {
    blob: new Blob([text], { type: config.mimeType ?? "text/plain" }),
    filename: config.filename ?? "sr10-loadtest.txt",
    mimeType: config.mimeType ?? "text/plain"
  };
}

function createPngAttachment(config) {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0n0AAAAASUVORK5CYII=";
  const buffer = Buffer.from(base64, "base64");
  return {
    blob: new Blob([buffer], { type: "image/png" }),
    filename: config.filename ?? "sr10-loadtest.png",
    mimeType: "image/png"
  };
}

async function scenarioWebSync(ctx, workerState, scenarioKind) {
  const surfaceThreadKey = makeRotatingThreadKey(
    ctx.config.web.surfaceThreadPrefix,
    workerState.web.identity.label,
    ctx.config.web.surfaceThreadPoolSize,
    workerState.web.workerSlot,
    workerState.web.requestSequence++
  );
  const message =
    scenarioKind === "tool_prompt"
      ? ctx.config.web.toolPromptTemplates[
          randomBetween(0, ctx.config.web.toolPromptTemplates.length - 1)
        ]
      : ctx.config.web.messageTemplates[
          randomBetween(0, ctx.config.web.messageTemplates.length - 1)
        ];
  const body = {
    surfaceThreadKey,
    message,
    clientTurnId: crypto.randomUUID()
  };
  const result = await fetchJson(
    `${ctx.config.apiBaseUrl}/assistant/chat/web`,
    {
      method: "POST",
      headers: buildJsonHeaders(workerState.web.identity.token),
      body: JSON.stringify(body)
    },
    ctx.config.requestTimeoutMs
  );
  if (result.ok) {
    return {
      ok: true,
      latencyMs: result.latencyMs,
      status: result.status,
      kind: scenarioKind
    };
  }
  const error = summarizePayloadError(result.payload);
  return {
    ok: false,
    latencyMs: result.latencyMs,
    status: result.status,
    kind: scenarioKind,
    error
  };
}

async function scenarioWebStream(ctx, workerState) {
  const surfaceThreadKey = makeStickyWorkerThreadKey(
    ctx.config.web.surfaceThreadPrefix,
    workerState.web.identity.label,
    workerState.web.workerSlot
  );
  const message =
    ctx.config.web.messageTemplates[randomBetween(0, ctx.config.web.messageTemplates.length - 1)];
  const body = {
    surfaceThreadKey,
    message,
    clientTurnId: crypto.randomUUID()
  };
  const result = await fetchSse(
    `${ctx.config.apiBaseUrl}/assistant/chat/web/stream`,
    body,
    workerState.web.identity.token,
    ctx.config.requestTimeoutMs
  );
  if (result.ok) {
    return {
      ok: true,
      latencyMs: result.latencyMs,
      status: result.status,
      kind: "web_stream"
    };
  }
  const payload = result.payload ?? {};
  const error =
    result.terminalEvent?.event === "failed"
      ? {
          code: typeof payload.code === "string" ? payload.code : "stream_failed",
          message: typeof payload.message === "string" ? payload.message : "Stream failed."
        }
      : summarizePayloadError(payload);
  return {
    ok: false,
    latencyMs: result.latencyMs,
    status: result.status,
    kind: "web_stream",
    error
  };
}

async function scenarioWebStageAttachment(ctx, workerState) {
  const surfaceThreadKey = makeRotatingThreadKey(
    ctx.config.media.surfaceThreadPrefix,
    workerState.media.identity.label,
    ctx.config.media.surfaceThreadPoolSize,
    workerState.media.workerSlot,
    workerState.media.requestSequence++
  );
  const attachment =
    ctx.config.media.attachment.kind === "png"
      ? createPngAttachment(ctx.config.media.attachment)
      : createTextAttachment(ctx.config.media.attachment);
  const form = new FormData();
  form.append("surfaceThreadKey", surfaceThreadKey);
  form.append("file", attachment.blob, attachment.filename);

  const startedAt = Date.now();
  const timeout = withTimeout(ctx.config.requestTimeoutMs);
  try {
    const response = await fetch(`${ctx.config.apiBaseUrl}/assistant/chat/web/stage-attachment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerState.media.identity.token}` },
      body: form,
      signal: timeout.signal
    });
    const latencyMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      return {
        ok: true,
        latencyMs,
        status: response.status,
        kind: "web_stage_attachment"
      };
    }
    return {
      ok: false,
      latencyMs,
      status: response.status,
      kind: "web_stage_attachment",
      error: summarizePayloadError(payload)
    };
  } finally {
    timeout.clear();
  }
}

async function scenarioVoiceTranscribe(ctx, workerState) {
  const voice = ctx.config.media.voice;
  const bytes = await fs.readFile(voice.filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: voice.mimeType }), voice.filename);

  const startedAt = Date.now();
  const timeout = withTimeout(ctx.config.requestTimeoutMs);
  try {
    const response = await fetch(`${ctx.config.apiBaseUrl}/assistant/voice/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerState.media.identity.token}` },
      body: form,
      signal: timeout.signal
    });
    const latencyMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      return {
        ok: true,
        latencyMs,
        status: response.status,
        kind: "voice_transcribe"
      };
    }
    return {
      ok: false,
      latencyMs,
      status: response.status,
      kind: "voice_transcribe",
      error: summarizePayloadError(payload)
    };
  } finally {
    timeout.clear();
  }
}

function createEmptyStats() {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    succeeded: 0,
    failed: 0,
    latenciesMs: [],
    byScenario: {},
    errors: {}
  };
}

function recordResult(stats, result) {
  stats.total += 1;
  stats.latenciesMs.push(result.latencyMs);
  if (result.ok) {
    stats.succeeded += 1;
  } else {
    stats.failed += 1;
    const key = `${result.error.code}:${result.status}`;
    stats.errors[key] = (stats.errors[key] ?? 0) + 1;
  }
  const scenario = (stats.byScenario[result.kind] ??= { total: 0, succeeded: 0, failed: 0 });
  scenario.total += 1;
  if (result.ok) scenario.succeeded += 1;
  else scenario.failed += 1;
}

function summarizeStats(stats) {
  const errorRate = stats.total > 0 ? stats.failed / stats.total : 0;
  return {
    total: stats.total,
    succeeded: stats.succeeded,
    failed: stats.failed,
    errorRate,
    p50Ms: percentile(stats.latenciesMs, 0.5),
    p95Ms: percentile(stats.latenciesMs, 0.95),
    p99Ms: percentile(stats.latenciesMs, 0.99),
    maxMs: stats.latenciesMs.length > 0 ? Math.max(...stats.latenciesMs) : 0,
    byScenario: stats.byScenario,
    errors: stats.errors
  };
}

async function collectAdminOverview(config) {
  if (!config.admin || !config.admin.token) return null;
  const result = await fetchJson(
    `${config.apiBaseUrl}/admin/overview/dashboard`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${config.admin.token}` }
    },
    config.requestTimeoutMs
  ).catch((error) => ({
    ok: false,
    status: 0,
    latencyMs: 0,
    payload: { error: { code: "admin_snapshot_failed", message: String(error?.message ?? error) } }
  }));
  if (!result.ok) {
    return { error: summarizePayloadError(result.payload), status: result.status };
  }
  return result.payload?.dashboard ?? null;
}

function evaluateGates(config, phaseSummary, adminBefore, adminAfter) {
  const failures = [];
  if (phaseSummary.errorRate > config.gates.maxErrorRate) {
    failures.push(
      `client error rate ${phaseSummary.errorRate.toFixed(4)} > ${config.gates.maxErrorRate}`
    );
  }
  if (phaseSummary.p95Ms > config.gates.maxP95Ms) {
    failures.push(`client p95 ${phaseSummary.p95Ms}ms > ${config.gates.maxP95Ms}ms`);
  }
  if (phaseSummary.p99Ms > config.gates.maxP99Ms) {
    failures.push(`client p99 ${phaseSummary.p99Ms}ms > ${config.gates.maxP99Ms}ms`);
  }

  if (adminAfter && !adminAfter.error) {
    if (config.gates.requireHealthyRuntimeTiers === true) {
      const unhealthy = (adminAfter.runtime?.tiers ?? []).filter(
        (tier) => !tier.live || !tier.ready
      );
      if (unhealthy.length > 0) {
        failures.push(
          `runtime unhealthy after phase: ${unhealthy.map((tier) => tier.tier).join(", ")}`
        );
      }
    }
    if (
      typeof adminAfter.health?.errorRate === "number" &&
      adminAfter.health.errorRate > config.gates.maxAdminErrorRate
    ) {
      failures.push(
        `admin overview error rate ${adminAfter.health.errorRate.toFixed(4)} > ${config.gates.maxAdminErrorRate}`
      );
    }
    const warnings = Array.isArray(adminAfter.warnings) ? adminAfter.warnings.length : 0;
    if (warnings > config.gates.maxAdminWarningCount) {
      failures.push(`admin warnings ${warnings} > ${config.gates.maxAdminWarningCount}`);
    }
    if (
      config.gates.failOnProcessRestart === true &&
      adminBefore &&
      !adminBefore.error &&
      adminBefore.health?.processStartedAt &&
      adminAfter.health?.processStartedAt &&
      adminBefore.health.processStartedAt !== adminAfter.health.processStartedAt
    ) {
      failures.push(
        "admin overview processStartedAt changed during phase (possible process restart)"
      );
    }
  }

  return {
    passed: failures.length === 0,
    failures
  };
}

async function runWorker(ctx, workerIndex, phaseEndAt) {
  const webUsers = ctx.config.web ? ctx.config.web.usersResolved : [];
  const mediaUsers = ctx.config.media ? ctx.config.media.usersResolved : [];
  const workerState = {
    web:
      webUsers.length === 0
        ? null
        : {
            ...buildWorkerIdentityAssignment(webUsers, workerIndex),
            requestSequence: 0
          },
    media:
      mediaUsers.length === 0
        ? null
        : {
            ...buildWorkerIdentityAssignment(mediaUsers, workerIndex),
            requestSequence: 0
          }
  };

  while (Date.now() < phaseEndAt) {
    const kind = choiceWeighted(ctx.config.trafficMix);
    let result;

    try {
      if (kind === "web_sync" || kind === "tool_prompt") {
        result = await scenarioWebSync(ctx, workerState, kind);
      } else if (kind === "web_stream") {
        result = await scenarioWebStream(ctx, workerState);
      } else if (kind === "web_stage_attachment") {
        result = await scenarioWebStageAttachment(ctx, workerState);
      } else if (kind === "voice_transcribe") {
        result = await scenarioVoiceTranscribe(ctx, workerState);
      } else {
        throw new Error(`Unsupported scenario kind: ${kind}`);
      }
    } catch (error) {
      result = {
        ok: false,
        latencyMs: 0,
        status: 0,
        kind,
        error: {
          code: "runner_error",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }

    recordResult(ctx.phaseStats, result);

    const thinkMs = randomBetween(ctx.config.thinkTimeMs.min, ctx.config.thinkTimeMs.max);
    await sleep(thinkMs);
  }
}

async function runPhase(ctx, profileId, phaseName, phaseConfig) {
  const totalDurationMs = (phaseConfig.rampSeconds + phaseConfig.holdSeconds) * 1000;
  const phaseEndAt = Date.now() + totalDurationMs;
  const adminBefore = await collectAdminOverview(ctx.config);
  const stats = createEmptyStats();
  ctx.phaseStats = stats;

  const workers = [];
  for (let index = 0; index < phaseConfig.users; index += 1) {
    const startDelay =
      phaseConfig.rampSeconds > 0
        ? Math.floor((index * phaseConfig.rampSeconds * 1000) / phaseConfig.users)
        : 0;
    workers.push(
      (async () => {
        if (startDelay > 0) await sleep(startDelay);
        await runWorker(ctx, index, phaseEndAt);
      })()
    );
  }

  await Promise.all(workers);
  stats.finishedAt = new Date().toISOString();
  const phaseSummary = summarizeStats(stats);
  const adminAfter = await collectAdminOverview(ctx.config);
  const gates = evaluateGates(ctx.config, phaseSummary, adminBefore, adminAfter);

  return {
    profileId,
    phase: phaseName,
    config: phaseConfig,
    client: phaseSummary,
    adminBefore,
    adminAfter,
    gates
  };
}

async function writeReport(reportDir, runId, report) {
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${runId}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return reportPath;
}

function normalizeConfig(rawConfig, cliArgs) {
  const envOptions = { allowMissing: cliArgs.dryRun === true };
  const apiBaseUrl = assertString(rawConfig.apiBaseUrl, "apiBaseUrl").replace(/\/$/, "");
  const profiles = rawConfig.profiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw new Error("profiles must be an object keyed by profile id.");
  }

  const selectedProfileIds =
    cliArgs.profiles && cliArgs.profiles.length > 0 ? cliArgs.profiles : Object.keys(profiles);
  const normalizedProfiles = {};
  for (const profileId of selectedProfileIds) {
    const profile = profiles[profileId];
    if (!profile || typeof profile !== "object") {
      throw new Error(`Profile ${profileId} is missing from config.`);
    }
    normalizedProfiles[profileId] = {};
    for (const phaseName of ["step", "burst", "soak"]) {
      const phase = profile[phaseName];
      if (!phase || typeof phase !== "object") {
        throw new Error(`Profile ${profileId}.${phaseName} is required.`);
      }
      normalizedProfiles[profileId][phaseName] = {
        users: assertPositiveInteger(phase.users, `${profileId}.${phaseName}.users`),
        rampSeconds: assertNonNegativeNumber(
          phase.rampSeconds,
          `${profileId}.${phaseName}.rampSeconds`
        ),
        holdSeconds: assertNonNegativeNumber(
          phase.holdSeconds,
          `${profileId}.${phaseName}.holdSeconds`
        )
      };
    }
  }

  const trafficMix = Array.isArray(rawConfig.trafficMix) ? rawConfig.trafficMix : [];
  if (trafficMix.length === 0) {
    throw new Error("trafficMix must contain at least one scenario.");
  }
  const normalizedMix = trafficMix.map((entry, index) => ({
    kind: assertString(entry.kind, `trafficMix[${index}].kind`),
    weight: assertPositiveNumber(entry.weight, `trafficMix[${index}].weight`)
  }));

  const config = {
    apiBaseUrl,
    reportDir: cliArgs.reportDir ?? rawConfig.reportDir ?? "artifacts/sr10-loadtest",
    requestTimeoutMs: rawConfig.requestTimeoutMs ?? 90_000,
    thinkTimeMs: {
      min: rawConfig.thinkTimeMs?.min ?? 250,
      max: rawConfig.thinkTimeMs?.max ?? 1500
    },
    profiles: normalizedProfiles,
    trafficMix: normalizedMix,
    gates: {
      maxErrorRate: rawConfig.gates?.maxErrorRate ?? 0.01,
      maxP95Ms: rawConfig.gates?.maxP95Ms ?? 4000,
      maxP99Ms: rawConfig.gates?.maxP99Ms ?? 8000,
      maxAdminErrorRate: rawConfig.gates?.maxAdminErrorRate ?? 0.02,
      maxAdminWarningCount: rawConfig.gates?.maxAdminWarningCount ?? 0,
      requireHealthyRuntimeTiers: rawConfig.gates?.requireHealthyRuntimeTiers !== false,
      failOnProcessRestart: rawConfig.gates?.failOnProcessRestart !== false
    },
    admin: null,
    web: null,
    media: null
  };

  if (rawConfig.admin) {
    config.admin = {
      tokenEnv: assertString(rawConfig.admin.tokenEnv, "admin.tokenEnv"),
      token: resolveEnvToken(rawConfig.admin.tokenEnv, "admin", envOptions)
    };
  }

  if (rawConfig.web) {
    const users = Array.isArray(rawConfig.web.users) ? rawConfig.web.users : [];
    if (users.length === 0) {
      throw new Error("web.users must contain at least one bearer token env mapping.");
    }
    config.web = {
      surfaceThreadPrefix: rawConfig.web.surfaceThreadPrefix ?? "sr10-web",
      surfaceThreadPoolSize: rawConfig.web.surfaceThreadPoolSize ?? 10,
      messageTemplates:
        Array.isArray(rawConfig.web.messageTemplates) && rawConfig.web.messageTemplates.length > 0
          ? rawConfig.web.messageTemplates
          : ["Give a short helpful reply about your purpose."],
      toolPromptTemplates:
        Array.isArray(rawConfig.web.toolPromptTemplates) &&
        rawConfig.web.toolPromptTemplates.length > 0
          ? rawConfig.web.toolPromptTemplates
          : ["Use one allowed tool if available, then answer briefly."],
      usersResolved: users.map((user, index) => ({
        label: user.label ?? `web-${index + 1}`,
        token: resolveEnvToken(
          assertString(user.tokenEnv, `web.users[${index}].tokenEnv`),
          `web.users[${index}]`,
          envOptions
        )
      }))
    };
  }

  if (rawConfig.media) {
    const users = Array.isArray(rawConfig.media.users)
      ? rawConfig.media.users
      : (rawConfig.web?.users ?? []);
    if (users.length === 0) {
      throw new Error("media.users (or web.users) must exist to run media scenarios.");
    }
    const attachment = rawConfig.media.attachment ?? { kind: "text" };
    if (!["text", "png"].includes(attachment.kind)) {
      throw new Error("media.attachment.kind must be text or png.");
    }
    const media = {
      surfaceThreadPrefix: rawConfig.media.surfaceThreadPrefix ?? "sr10-media",
      surfaceThreadPoolSize: rawConfig.media.surfaceThreadPoolSize ?? 10,
      attachment,
      usersResolved: users.map((user, index) => ({
        label: user.label ?? `media-${index + 1}`,
        token: resolveEnvToken(
          assertString(user.tokenEnv, `media.users[${index}].tokenEnv`),
          `media.users[${index}]`,
          envOptions
        )
      })),
      voice: null
    };
    if (rawConfig.media.voice && rawConfig.media.voice.filePath) {
      media.voice = {
        filePath: path.resolve(rawConfig.media.voice.filePath),
        mimeType: rawConfig.media.voice.mimeType ?? "audio/webm",
        filename: rawConfig.media.voice.filename ?? path.basename(rawConfig.media.voice.filePath)
      };
    }
    config.media = media;
  }

  const enabledKinds = new Set(config.trafficMix.map((entry) => entry.kind));
  for (const kind of enabledKinds) {
    if ((kind === "web_sync" || kind === "web_stream" || kind === "tool_prompt") && !config.web) {
      throw new Error(`${kind} requires a web section in config.`);
    }
    if (kind === "telegram_turn") {
      throw new Error(
        "telegram_turn synthetic loadtest traffic was removed after ADR-072 Step 13. Use live Telegram verification instead."
      );
    }
    if ((kind === "web_stage_attachment" || kind === "voice_transcribe") && !config.media) {
      throw new Error(`${kind} requires a media section in config.`);
    }
    if (kind === "voice_transcribe" && !config.media.voice) {
      throw new Error("voice_transcribe requires media.voice.filePath in config.");
    }
  }

  return config;
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = JSON.parse(await fs.readFile(path.resolve(args.configPath), "utf8"));
  const config = normalizeConfig(raw, args);

  const plan = Object.entries(config.profiles).map(([profileId, profile]) => ({
    profileId,
    step: profile.step,
    burst: profile.burst,
    soak: profile.soak
  }));

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          apiBaseUrl: config.apiBaseUrl,
          reportDir: config.reportDir,
          trafficMix: config.trafficMix,
          profiles: plan
        },
        null,
        2
      )
    );
    return;
  }

  const runId = `sr10-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const report = {
    runId,
    startedAt: new Date().toISOString(),
    apiBaseUrl: config.apiBaseUrl,
    profiles: [],
    stoppedEarly: false
  };

  const ctx = { config, phaseStats: null };

  for (const [profileId, profileConfig] of Object.entries(config.profiles)) {
    const profileReport = { profileId, phases: [] };
    for (const phaseName of ["step", "burst", "soak"]) {
      const phaseReport = await runPhase(ctx, profileId, phaseName, profileConfig[phaseName]);
      profileReport.phases.push(phaseReport);
      const gateState = phaseReport.gates.passed ? "PASS" : "FAIL";
      console.log(
        `[${profileId}/${phaseName}] ${gateState} total=${phaseReport.client.total} errorRate=${(phaseReport.client.errorRate * 100).toFixed(2)}% p95=${phaseReport.client.p95Ms}ms p99=${phaseReport.client.p99Ms}ms`
      );
      if (!phaseReport.gates.passed) {
        report.stoppedEarly = true;
        report.stopReason = {
          profileId,
          phase: phaseName,
          failures: phaseReport.gates.failures
        };
        break;
      }
    }
    report.profiles.push(profileReport);
    if (report.stoppedEarly) break;
  }

  report.finishedAt = new Date().toISOString();
  const reportPath = await writeReport(path.resolve(config.reportDir), runId, report);
  console.log(`Report written to ${reportPath}`);

  if (report.stoppedEarly) {
    console.error(`Stopped early: ${report.stopReason.phase} failed.`);
    for (const failure of report.stopReason.failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
