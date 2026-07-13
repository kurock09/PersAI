#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertAdr146CrossLayerContract,
  collectAdr146CrossLayerContractViolations,
  repoRoot
} from "./adr146-cross-layer-contract.mjs";

describe("ADR-146 cross-layer contract", () => {
  const rendered = spawnSync(
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
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(rendered.status, 0, rendered.stderr);

  function collectWithMutation(relPath, mutate) {
    return collectAdr146CrossLayerContractViolations({
      readFile(file) {
        const content = readFileSync(path.join(repoRoot, file), "utf8");
        return file === relPath ? mutate(content) : content;
      },
      renderHelm() {
        return rendered;
      }
    });
  }

  it("passes on the current S1–S5 local tree", () => {
    const result = assertAdr146CrossLayerContract();
    assert.equal(result.ok, true);
    assert.equal(result.checkCount, 5);
  });

  it("fails independently when each S1-S5 seam is mutated", () => {
    const cases = [
      {
        layer: "S1",
        file: "packages/contracts/openapi.yaml",
        mutate: (content) =>
          content.replace("/assistant/{assistantId}/sandbox-egress:", "/removed:"),
        expected: /OpenAPI missing/
      },
      {
        layer: "S2",
        file: "infra/helm/values-dev.yaml",
        mutate: (content) => content.replace("ipFamily: IPv4", "ipFamily: IPv6"),
        expected: /ipFamily must be IPv4/
      },
      {
        layer: "S3",
        file: "apps/sandbox/src/sandbox.controller.ts",
        mutate: (content) => content.replace("sandbox-egress/reconcile", "sandbox-egress/removed"),
        expected: /expose sandbox-egress reconcile/
      },
      {
        layer: "S4",
        file: "apps/web/app/app/_components/assistant-sandbox-egress-settings.tsx",
        mutate: (content) => content.replaceAll("putAssistantSandboxEgress", "removedPut"),
        expected: /canonical PUT client/
      },
      {
        layer: "S5",
        file: "apps/sandbox/src/sandbox-metrics.service.ts",
        mutate: (content) =>
          content.replaceAll("sandbox_exec_egress_mode_mismatch_total", "removed_metric"),
        expected: /S5 metrics export missing/
      },
      {
        layer: "S5 workflow",
        file: ".github/workflows/full-verification.yml",
        mutate: (content) => content.replace("pnpm run test:adr146-slice5", "pnpm run test"),
        expected: /Full Verification must run/
      }
    ];
    for (const testCase of cases) {
      const errors = collectWithMutation(testCase.file, testCase.mutate);
      assert.ok(
        errors.some((error) => testCase.expected.test(error)),
        testCase.layer
      );
    }
  });

  it("missing known contract file fails closed", () => {
    assert.throws(
      () =>
        collectAdr146CrossLayerContractViolations({
          readFile(file) {
            if (file === "packages/contracts/openapi.yaml") {
              throw new Error("fixture missing");
            }
            return readFileSync(path.join(repoRoot, file), "utf8");
          },
          renderHelm() {
            return rendered;
          }
        }),
      /fixture missing/
    );
  });

  it("direct CLI executes and prints PASS with layer count", () => {
    const output = execFileSync(process.execPath, ["scripts/ci/adr146-cross-layer-contract.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.match(output, /PASS \(5 layers\)/);
  });
});
