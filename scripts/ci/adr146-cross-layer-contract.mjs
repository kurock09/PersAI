#!/usr/bin/env node
/**
 * ADR-146 Slice 5 — cross-layer contract assertions for S1–S5 alignment.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..", "..");
const parseYaml = yaml.parse.bind(yaml);

function createDependencies(options = {}) {
  const rootDirectory = path.resolve(options.rootDir ?? repoRoot);
  return {
    readFile:
      options.readFile ?? ((relPath) => readFileSync(path.join(rootDirectory, relPath), "utf8")),
    renderHelm:
      options.renderHelm ??
      (() =>
        spawnSync(
          "helm",
          [
            "template",
            "persai-dev",
            "infra/helm",
            "-f",
            "infra/helm/values.yaml",
            "-f",
            "infra/helm/values-dev.yaml"
          ],
          { cwd: rootDirectory, encoding: "utf8" }
        ))
  };
}

function assertS1ApiContract(errors, deps) {
  const openapi = deps.readFile("packages/contracts/openapi.yaml");
  if (!openapi.includes("/assistant/{assistantId}/sandbox-egress:")) {
    errors.push("OpenAPI missing /assistant/{assistantId}/sandbox-egress");
  }
  if (!openapi.includes("AssistantSandboxEgressMode:")) {
    errors.push("OpenAPI missing AssistantSandboxEgressMode schema");
  }
  if (!/enum:\s*\n\s*- restricted\s*\n\s*- full_public/m.test(openapi)) {
    errors.push("OpenAPI AssistantSandboxEgressMode must enumerate restricted|full_public");
  }
  if (openapi.includes("networkAccessEnabled")) {
    errors.push("OpenAPI must not expose removed networkAccessEnabled");
  }
  if (!openapi.includes("warm execution pod eviction/reconcile failed")) {
    errors.push("OpenAPI must document 503 recycle/reconcile failure semantics");
  }
  const migration = deps.readFile(
    "apps/api/prisma/migrations/20260713120000_adr146_s1_assistant_sandbox_egress_mode/migration.sql"
  );
  if (!migration.includes("sandbox_egress_mode")) {
    errors.push("S1 migration must create sandbox_egress_mode");
  }
  if (!migration.includes("networkAccessEnabled")) {
    errors.push("S1 migration must delete plan networkAccessEnabled JSON key");
  }
}

function assertS2PolicyContract(errors, deps) {
  const rendered = deps.renderHelm();
  if (rendered.status !== 0) {
    errors.push(`Helm template failed: ${rendered.stderr || rendered.stdout}`);
    return;
  }
  const docs = yaml
    .parseAllDocuments(rendered.stdout)
    .map((doc) => doc.toJSON())
    .filter(Boolean);
  const isolation = docs.find(
    (doc) => doc?.kind === "NetworkPolicy" && doc?.metadata?.name === "sandbox-exec-isolation"
  );
  const fullPublic = docs.find(
    (doc) =>
      doc?.kind === "NetworkPolicy" && doc?.metadata?.name === "sandbox-exec-full-public-egress"
  );
  if (!isolation) {
    errors.push("Rendered chart missing sandbox-exec-isolation NetworkPolicy");
  }
  if (!fullPublic) {
    errors.push("Rendered chart missing sandbox-exec-full-public-egress NetworkPolicy");
  }
  if (fullPublic) {
    const labels = fullPublic.spec?.podSelector?.matchLabels ?? {};
    if (labels["persai.io/sandbox-egress"] !== "full-public") {
      errors.push("Full-public NetworkPolicy must select persai.io/sandbox-egress=full-public");
    }
  }
  const contract = docs.find(
    (doc) =>
      doc?.kind === "ConfigMap" &&
      (doc?.metadata?.labels?.["persai.io/sandbox-egress-contract"] === "true" ||
        doc?.metadata?.name === "sandbox-exec-egress-mode-contract")
  );
  if (!contract) {
    errors.push("Rendered chart missing sandbox exec egress contract ConfigMap");
  } else {
    const defaultMode = contract.data?.defaultMode ?? contract.data?.["defaultMode"];
    if (defaultMode !== "restricted") {
      errors.push("Egress contract defaultMode must remain restricted");
    }
  }
  const valuesDev = parseYaml(deps.readFile("infra/helm/values-dev.yaml"));
  if (valuesDev?.networkPolicy?.sandboxEgress?.ipFamily !== "IPv4") {
    errors.push("values-dev networkPolicy.sandboxEgress.ipFamily must be IPv4");
  }
}

function assertS3LifecycleContract(errors, deps) {
  const bridge = deps.readFile("apps/sandbox/src/exec-pod-bridge.service.ts");
  const controller = deps.readFile("apps/sandbox/src/sandbox.controller.ts");
  const modeModule = deps.readFile("apps/sandbox/src/sandbox-egress-mode.ts");
  if (!bridge.includes("persai.io/sandbox-egress")) {
    errors.push("ExecPodBridge must stamp persai.io/sandbox-egress label/annotation");
  }
  if (!controller.includes("sandbox-egress/reconcile")) {
    errors.push("Sandbox control plane must expose sandbox-egress reconcile route");
  }
  if (!modeModule.includes("full-public")) {
    errors.push("sandbox-egress-mode must map full_public to full-public at K8s boundary");
  }
  const apiClient = deps.readFile(
    "apps/api/src/modules/workspace-management/application/sandbox-control-plane.client.service.ts"
  );
  if (!apiClient.includes("/sandbox-egress/reconcile")) {
    errors.push("API sandbox control-plane client must call reconcile endpoint");
  }
}

function assertS4ConsentContract(errors, deps) {
  const en = JSON.parse(deps.readFile("apps/web/messages/en.json"));
  const ru = JSON.parse(deps.readFile("apps/web/messages/ru.json"));
  const enStrings = JSON.stringify(en);
  const ruStrings = JSON.stringify(ru);
  for (const corpus of [enStrings, ruStrings]) {
    if (/\bunlimited\b|\bunrestricted\b|без ограничений/i.test(corpus)) {
      errors.push("Web i18n must not claim unlimited/unrestricted sandbox egress");
    }
  }
  if (!enStrings.includes("sandboxNetworkEnableBody")) {
    errors.push("EN copy must include sandboxNetworkEnableBody consent text");
  }
  const settings = deps.readFile(
    "apps/web/app/app/_components/assistant-sandbox-egress-settings.tsx"
  );
  if (!settings.includes("putAssistantSandboxEgress")) {
    errors.push("Assistant sandbox egress settings must use canonical PUT client");
  }
  if (settings.includes("checked={true}") || settings.includes("defaultChecked")) {
    errors.push("Assistant sandbox egress settings must not optimistically force checked state");
  }
}

function assertS5AuditAndMetricsContract(errors, deps) {
  const metrics = deps.readFile("apps/sandbox/src/sandbox-metrics.service.ts");
  const service = deps.readFile("apps/sandbox/src/sandbox.service.ts");
  const packageJson = JSON.parse(deps.readFile("package.json"));
  const workflow = deps.readFile(".github/workflows/full-verification.yml");
  for (const metric of [
    "sandbox_exec_egress_mode_mismatch_total",
    "sandbox_exec_pod_retirement_total",
    "sandbox_exec_pod_reaper_evict_total",
    "sandbox_exec_egress_job_duration_ms"
  ]) {
    if (!metrics.includes(metric)) {
      errors.push(`S5 metrics export missing ${metric}`);
    }
  }
  if (
    !service.includes(
      "terminalWriteSucceeded && jobStartedAtMs !== null && execPodBinding !== null"
    )
  ) {
    errors.push(
      "S5 job duration must require terminal persistence, start time, and canonical binding"
    );
  }
  if (packageJson.scripts?.["test:adr146-slice5"] === undefined) {
    errors.push("package.json missing test:adr146-slice5 composite gate");
  }
  if (!workflow.includes("pnpm run test:adr146-slice5")) {
    errors.push("Full Verification must run test:adr146-slice5");
  }
}

export function collectAdr146CrossLayerContractViolations(options = {}) {
  const deps = createDependencies(options);
  const errors = [];
  assertS1ApiContract(errors, deps);
  assertS2PolicyContract(errors, deps);
  assertS3LifecycleContract(errors, deps);
  assertS4ConsentContract(errors, deps);
  assertS5AuditAndMetricsContract(errors, deps);
  return errors;
}

export function assertAdr146CrossLayerContract(options = {}) {
  const errors = collectAdr146CrossLayerContractViolations(options);
  if (errors.length > 0) {
    throw new Error(`ADR-146 cross-layer contract failed:\n- ${errors.join("\n- ")}`);
  }
  return { ok: true, checkCount: 5 };
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    const result = assertAdr146CrossLayerContract();
    process.stdout.write(`ADR-146 cross-layer contract PASS (${result.checkCount} layers)\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
