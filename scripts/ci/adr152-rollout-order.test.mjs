#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const chartPath = path.join(repoRoot, "infra", "helm");
const valuesPath = path.join(chartPath, "values-dev.yaml");

function helmTemplate(...extraArgs) {
  return execFileSync(
    "helm",
    ["template", "persai-dev", chartPath, "-f", valuesPath, ...extraArgs],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
}

function renderedResourceBlock(manifest, kind, name) {
  const block = manifest.match(
    new RegExp(
      `^apiVersion: [^\\n]+\\nkind: ${kind}\\nmetadata:\\n  name: ${name}\\n[\\s\\S]*?(?=^---$|(?![\\s\\S]))`,
      "mu"
    )
  )?.[0];
  assert.ok(block, `missing ${kind}/${name}`);
  return block;
}

describe("ADR-152 rollout ordering", () => {
  it("orders migration, API readiness/contract verification, then runtime", () => {
    const manifest = helmTemplate();
    const migration = renderedResourceBlock(manifest, "Job", "api-migrate");
    const api = renderedResourceBlock(manifest, "Deployment", "api");
    const contractGate = renderedResourceBlock(manifest, "Job", "api-async-job-contract-gate");
    const runtime = renderedResourceBlock(manifest, "Deployment", "runtime");
    const apiIngress = renderedResourceBlock(manifest, "NetworkPolicy", "api-ingress-baseline");

    assert.match(migration, /argocd\.argoproj\.io\/hook: PreSync/);
    assert.match(migration, /argocd\.argoproj\.io\/sync-wave: "-1"/);
    assert.match(api, /argocd\.argoproj\.io\/sync-wave: "0"/);
    assert.match(contractGate, /argocd\.argoproj\.io\/hook: Sync/);
    assert.match(contractGate, /argocd\.argoproj\.io\/sync-wave: "1"/);
    assert.match(runtime, /argocd\.argoproj\.io\/sync-wave: "2"/);

    assert.match(api, /readinessProbe:\s+httpGet:\s+path: "\/ready"/);
    assert.match(contractGate, /app\.kubernetes\.io\/component: api-runtime-compatibility-gate/);
    assert.match(contractGate, /http:\/\/api:3001\/ready/);
    assert.match(contractGate, /"asyncJobHandles":"v1"/);
    assert.match(
      apiIngress,
      /app\.kubernetes\.io\/component: api-runtime-compatibility-gate/,
      "the contract gate must be allowed to reach API /ready"
    );
  });

  it("fails closed when API or its additive migration prerequisite is disabled", () => {
    for (const override of ["api.enabled=false", "api.migrations.enabled=false"]) {
      assert.throws(
        () => helmTemplate("--set", override),
        /ADR-152: runtime requires api\.(enabled|migrations\.enabled)/,
        override
      );
    }
  });

  it("fails closed when either side declares a mismatched async-job contract version", () => {
    for (const override of [
      "api.asyncJobContract.version=v2",
      "runtime.asyncJobContract.requiredVersion=v2"
    ]) {
      assert.throws(
        () => helmTemplate("--set", override),
        /ADR-152: api\.asyncJobContract\.version and runtime\.asyncJobContract\.requiredVersion must both be v1/,
        override
      );
    }
  });
});
