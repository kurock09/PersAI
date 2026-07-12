#!/usr/bin/env node
// Unit tests for the detectAffected classifier.
// Run: node --test scripts/ci/detect-affected.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADR146_FOUNDATION_MARKER_PATHS,
  VALUES_DEV_CONTENT_UNAVAILABLE,
  detectAffected,
  partitionFoundationServices,
  valuesDevContentTriggersFoundation,
  valuesDevDiffTriggersFoundation
} from "./detect-affected.mjs";
import {
  PIN_DEV_IMAGE_SERVICE_TO_SECTION,
  applyPinDevImageTags
} from "./pin-dev-image-tags-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL_VALUES_DEV = readFileSync(
  path.join(repoRoot, "infra", "helm", "values-dev.yaml"),
  "utf8"
);

function deployNames(result) {
  return result.deployServices.map((service) => service.service).sort();
}

function immediateNames(result) {
  return result.foundationImmediateServices.map((service) => service.service).sort();
}

function deferredNames(result) {
  return result.foundationDeferredServices.map((service) => service.service).sort();
}

describe("detect-affected: docs-only change", () => {
  it("classifies a markdown doc change as docsOnly with no deploy and no full-CI", () => {
    const result = detectAffected(["docs/FOO.md"]);
    assert.equal(result.docsOnly, true, "docsOnly should be true");
    assert.equal(result.testOnly, false, "testOnly should be false");
    assert.equal(result.requiresFullCi, false, "requiresFullCi should be false");
    assert.equal(result.requiresIntegration, false, "requiresIntegration should be false");
    assert.equal(result.foundationRollout, false, "docs-only is not a foundation rollout");
    assert.equal(result.deployServices.length, 0, "no deploy services for docs-only");
    assert.deepEqual(immediateNames(result), []);
    assert.deepEqual(deferredNames(result), []);
  });
});

describe("detect-affected: test-only change", () => {
  it("classifies an app test file change as testOnly", () => {
    const result = detectAffected(["apps/api/test/foo.test.ts"]);
    assert.equal(result.testOnly, true, "testOnly should be true");
    assert.equal(result.docsOnly, false, "docsOnly should be false");
    assert.equal(result.requiresFullCi, false, "requiresFullCi should be false");
    assert.equal(result.foundationRollout, false);
  });
});

describe("detect-affected: migration change", () => {
  it("classifies a Prisma migration file as migrationChanged and requiresIntegration", () => {
    const result = detectAffected(["apps/api/prisma/migrations/20240101_init/migration.sql"]);
    assert.equal(result.migrationChanged, true, "migrationChanged should be true");
    assert.equal(result.requiresIntegration, true, "requiresIntegration should be true");
    assert.equal(result.foundationRollout, false);
    assert.ok(deployNames(result).includes("api"));
    assert.ok(deployNames(result).includes("sandbox"));
    assert.deepEqual(immediateNames(result), []);
    assert.deepEqual(deferredNames(result), []);
  });
});

describe("detect-affected: contracts change", () => {
  it("classifies a contracts package openapi.yaml change as contracts-boundary risk and requiresIntegration", () => {
    const result = detectAffected(["packages/contracts/openapi.yaml"]);
    assert.ok(
      result.riskReasons.includes("contracts-boundary"),
      `expected contracts-boundary in riskReasons, got: ${result.riskReasons.join(", ")}`
    );
    assert.equal(result.requiresIntegration, true, "requiresIntegration should be true");
    assert.equal(result.requiresFullCi, false, "contracts change must NOT escalate to full-CI");
    assert.equal(result.foundationRollout, false);
  });
});

describe("detect-affected: sandbox-exec image change", () => {
  it("classifies exec-image Dockerfile change as sandbox-exec deploy only (not sandbox control-plane)", () => {
    const result = detectAffected(["apps/sandbox/exec-image/Dockerfile"]);
    const names = deployNames(result);
    assert.ok(
      names.includes("sandbox-exec"),
      `expected sandbox-exec in deploy services, got: ${names.join(", ")}`
    );
    assert.ok(
      !names.includes("sandbox"),
      `sandbox control-plane must NOT be deployed for exec-image changes, got: ${names.join(", ")}`
    );
    assert.equal(result.docsOnly, false, "exec-image Dockerfile is not docs-only");
    assert.equal(result.requiresFullCi, false, "exec-image change does not require full CI");
    assert.equal(result.foundationRollout, false);
  });

  it("classifies exec-image requirements.txt change as sandbox-exec deploy only", () => {
    const result = detectAffected(["apps/sandbox/exec-image/requirements.txt"]);
    const names = deployNames(result);
    assert.ok(
      names.includes("sandbox-exec"),
      `expected sandbox-exec in deploy services for requirements.txt, got: ${names.join(", ")}`
    );
    assert.ok(
      !names.includes("sandbox"),
      `sandbox control-plane must NOT be deployed for exec-image requirements, got: ${names.join(", ")}`
    );
  });

  it("classifies sandbox control-plane src change as sandbox deploy (not sandbox-exec)", () => {
    const result = detectAffected(["apps/sandbox/src/exec-pod-bridge.service.ts"]);
    const names = deployNames(result);
    assert.ok(
      names.includes("sandbox"),
      `expected sandbox in deploy services for src change, got: ${names.join(", ")}`
    );
    assert.ok(
      !names.includes("sandbox-exec"),
      `sandbox-exec must NOT be deployed for control-plane src changes, got: ${names.join(", ")}`
    );
    assert.equal(result.foundationRollout, false);
  });
});

describe("detect-affected: ADR-146 foundation markers", () => {
  it("enumerates exact foundation marker paths", () => {
    assert.ok(
      ADR146_FOUNDATION_MARKER_PATHS.has("infra/bootstrap/adr146-sandbox-egress-foundation.json")
    );
    assert.ok(
      ADR146_FOUNDATION_MARKER_PATHS.has("infra/helm/templates/sandbox-serviceaccount.yaml")
    );
    assert.ok(ADR146_FOUNDATION_MARKER_PATHS.has("infra/helm/templates/networkpolicies.yaml"));
    assert.ok(ADR146_FOUNDATION_MARKER_PATHS.has("infra/helm/values.yaml"));
    assert.ok(ADR146_FOUNDATION_MARKER_PATHS.has("infra/bootstrap/lib/foundation.mjs"));
    assert.ok(ADR146_FOUNDATION_MARKER_PATHS.has("infra/bootstrap/lib/cidr.mjs"));
    assert.equal(
      ADR146_FOUNDATION_MARKER_PATHS.has("infra/helm/values-dev.yaml"),
      false,
      "values-dev must not be a foundation marker (bot pin target)"
    );
    assert.equal(
      ADR146_FOUNDATION_MARKER_PATHS.has("package.json"),
      false,
      "root package.json is not itself a foundation marker"
    );
  });

  it("marks chart values.yaml as foundation rollout", () => {
    const result = detectAffected(["infra/helm/values.yaml"]);
    assert.equal(result.foundationRollout, true);
    assert.equal(result.runHelmValidation, true);
    assert.deepEqual(immediateNames(result), ["sandbox"]);
  });

  it("fail-closes values-dev path alone without provable base/head content", () => {
    const result = detectAffected(["infra/helm/values-dev.yaml"]);
    assert.equal(result.foundationRollout, true);
    assert.equal(result.runHelmValidation, true);
    assert.deepEqual(immediateNames(result), ["sandbox"]);
  });

  it("fail-closes missing base / unavailable compare / empty content / git failure", () => {
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        valuesDevCompare: { status: "unavailable", reason: "missing-base" }
      }).foundationRollout,
      true
    );
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        valuesDevUnavailable: true,
        valuesDevUnavailableReason: "injected-unavailable"
      }).foundationRollout,
      true
    );
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        getValuesDevFileAtRef() {
          throw new Error("git diff failure");
        }
      }).foundationRollout,
      true
    );
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        getValuesDevFileAtRef() {
          return VALUES_DEV_CONTENT_UNAVAILABLE;
        }
      }).foundationRollout,
      true
    );
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        valuesDevBaseText: "",
        valuesDevHeadText: REAL_VALUES_DEV
      }).foundationRollout,
      true
    );
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        valuesDevBaseText: REAL_VALUES_DEV,
        valuesDevHeadText: ""
      }).foundationRollout,
      true
    );
    // Path changed but base===head → cannot prove a pin change.
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        valuesDevBaseText: REAL_VALUES_DEV,
        valuesDevHeadText: REAL_VALUES_DEV
      }).foundationRollout,
      true
    );
    // Legacy diff-only / empty-string input is unproven → fail closed.
    assert.equal(valuesDevDiffTriggersFoundation(""), true);
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], { valuesDevDiffText: "" }).foundationRollout,
      true
    );
  });

  it("treats realistic pin-dev-image-tags output as non-foundation with zero deploy (bot pin no-loop)", () => {
    const services = Object.keys(PIN_DEV_IMAGE_SERVICE_TO_SECTION);
    const head = applyPinDevImageTags(
      REAL_VALUES_DEV,
      services,
      "newsha111111111111111111111111111111111111"
    );
    assert.equal(valuesDevContentTriggersFoundation(REAL_VALUES_DEV, head), false);
    const result = detectAffected(["infra/helm/values-dev.yaml"], {
      valuesDevBaseText: REAL_VALUES_DEV,
      valuesDevHeadText: head
    });
    assert.equal(result.foundationRollout, false);
    assert.deepEqual(deployNames(result), []);
    assert.deepEqual(immediateNames(result), []);
    assert.deepEqual(deferredNames(result), []);
  });

  it("treats per-service api/web/runtime/provider-gateway/sandbox/sandbox-exec pins as non-foundation", () => {
    for (const service of Object.keys(PIN_DEV_IMAGE_SERVICE_TO_SECTION)) {
      const head = applyPinDevImageTags(
        REAL_VALUES_DEV,
        [service],
        `pin${service.replace(/[^a-z]/gu, "")}22222222222222222222222222222222`.slice(0, 40)
      );
      assert.equal(
        valuesDevContentTriggersFoundation(REAL_VALUES_DEV, head),
        false,
        `${service} pin must be non-foundation`
      );
      assert.equal(
        detectAffected(["infra/helm/values-dev.yaml"], {
          valuesDevBaseText: REAL_VALUES_DEV,
          valuesDevHeadText: head
        }).foundationRollout,
        false,
        `${service} detectAffected must stay non-foundation`
      );
    }
  });

  it("fail-closes global.images.tag fallback edits (not pin-script exempt)", () => {
    const head = REAL_VALUES_DEV.replace(
      "    tag: ddc3aadfca11cc6fabe7d3e8c9e60aca9124c525\n",
      "    tag: globalfallback999999999999999999999999999999\n"
    );
    assert.notEqual(head, REAL_VALUES_DEV);
    assert.equal(valuesDevContentTriggersFoundation(REAL_VALUES_DEV, head), true);
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        valuesDevBaseText: REAL_VALUES_DEV,
        valuesDevHeadText: head
      }).foundationRollout,
      true
    );
  });

  it("fail-closes unknown service tag, nested unrelated tag, and indentation tricks", () => {
    const baseUnknown = `${REAL_VALUES_DEV}unknownService:\n  image:\n    name: unknown\n    tag: oldunknown00000000000000000000000000000000\n`;
    const headUnknown = `${REAL_VALUES_DEV}unknownService:\n  image:\n    name: unknown\n    tag: newunknown11111111111111111111111111111111\n`;
    assert.equal(valuesDevContentTriggersFoundation(baseUnknown, headUnknown), true);

    const baseNested = REAL_VALUES_DEV.replace(
      "  egressProxy:\n    enabled: true\n",
      "  egressProxy:\n    enabled: true\n    nested:\n      tag: nestedold0000000000000000000000000000000\n"
    );
    const headNested = baseNested.replace(
      "tag: nestedold0000000000000000000000000000000",
      "tag: nestednew1111111111111111111111111111111"
    );
    assert.equal(valuesDevContentTriggersFoundation(baseNested, headNested), true);

    // Indentation trick under sandboxExec (unique tag value): not pin-script shape.
    const baseIndent = REAL_VALUES_DEV.replace(
      "sandboxExec:\n  image:\n    # Exec image name in GAR (matches the service name in detect-affected + pin script).\n    name: sandbox-exec\n    # Initial tag; CI pins this to the SHA of the most recent successful build.\n    tag: fa440e027b6c36653efd39567c16172d04c02256\n",
      "sandboxExec:\n  image:\n    # Exec image name in GAR (matches the service name in detect-affected + pin script).\n    name: sandbox-exec\n    # Initial tag; CI pins this to the SHA of the most recent successful build.\n   tag: fa440e027b6c36653efd39567c16172d04c02256\n"
    );
    const headIndent = baseIndent.replace(
      "   tag: fa440e027b6c36653efd39567c16172d04c02256\n",
      "   tag: indentedtrick11111111111111111111111111111\n"
    );
    assert.notEqual(baseIndent, REAL_VALUES_DEV);
    assert.equal(valuesDevContentTriggersFoundation(baseIndent, headIndent), true);
  });

  it("fail-closes mixed allowed pin + disallowed semantic edit", () => {
    const pinned = applyPinDevImageTags(
      REAL_VALUES_DEV,
      ["sandbox"],
      "newsha111111111111111111111111111111111111"
    );
    const mixed = pinned.replace(
      "  egressProxy:\n    enabled: true\n",
      "  egressProxy:\n    enabled: false\n"
    );
    assert.equal(valuesDevContentTriggersFoundation(REAL_VALUES_DEV, mixed), true);
    const result = detectAffected(
      ["infra/helm/values-dev.yaml", "apps/api/src/main.ts", "apps/web/src/app/page.tsx"],
      { valuesDevBaseText: REAL_VALUES_DEV, valuesDevHeadText: mixed }
    );
    assert.equal(result.foundationRollout, true);
    assert.deepEqual(immediateNames(result), ["sandbox"]);
    assert.ok(deferredNames(result).includes("api"));
    assert.ok(deferredNames(result).includes("web"));
  });

  it("fail-closes blank and comment-only values-dev structural edits as foundation", () => {
    const withBlankLine = REAL_VALUES_DEV.replace("networkPolicy:\n", "networkPolicy:\n\n");
    const withComment = REAL_VALUES_DEV.replace(
      "networkPolicy:\n",
      "networkPolicy:\n  # temporary operator note\n"
    );
    assert.equal(valuesDevContentTriggersFoundation(REAL_VALUES_DEV, withBlankLine), true);
    assert.equal(valuesDevContentTriggersFoundation(REAL_VALUES_DEV, withComment), true);
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        valuesDevBaseText: REAL_VALUES_DEV,
        valuesDevHeadText: withComment
      }).foundationRollout,
      true
    );
  });

  it("fail-closes sandboxEgress and execServiceAccount values-dev edits as foundation", () => {
    const saHead = REAL_VALUES_DEV.replace(
      "  execServiceAccount:\n    create: true\n    name: sandbox-exec-sa\n",
      "  execServiceAccount:\n    create: true\n    name: sandbox-exec-sa-v2\n"
    );
    assert.equal(valuesDevContentTriggersFoundation(REAL_VALUES_DEV, saHead), true);
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        valuesDevBaseText: REAL_VALUES_DEV,
        valuesDevHeadText: saHead
      }).foundationRollout,
      true
    );
    assert.deepEqual(
      immediateNames(
        detectAffected(["infra/helm/values-dev.yaml"], {
          valuesDevBaseText: REAL_VALUES_DEV,
          valuesDevHeadText: saHead
        })
      ),
      ["sandbox"]
    );
  });

  it("fail-closes deep list-item CIDR edits without relying on hunk context", () => {
    const head = REAL_VALUES_DEV.replace(
      "      - 169.254.20.10/32\n",
      "      - 169.254.20.10/32\n      - 203.0.113.10/32\n"
    );
    assert.equal(valuesDevContentTriggersFoundation(REAL_VALUES_DEV, head), true);
    const result = detectAffected(["infra/helm/values-dev.yaml"], {
      valuesDevBaseText: REAL_VALUES_DEV,
      valuesDevHeadText: head
    });
    assert.equal(result.foundationRollout, true);
    assert.ok(result.riskReasons.includes("adr146-foundation"));
    assert.deepEqual(deployNames(result), ["sandbox"]);
    assert.deepEqual(immediateNames(result), ["sandbox"]);
  });

  it("fail-closes networkPolicy.enabled and egressProxy.enabled toggles as foundation", () => {
    const npPrecise = REAL_VALUES_DEV.replace(
      "  # release gate before ADR-146 app rollout.\n  enabled: true\n  sandboxDns:\n",
      "  # release gate before ADR-146 app rollout.\n  enabled: false\n  sandboxDns:\n"
    );
    const egressHead = REAL_VALUES_DEV.replace(
      "  egressProxy:\n    enabled: true\n",
      "  egressProxy:\n    enabled: false\n"
    );
    assert.equal(valuesDevContentTriggersFoundation(REAL_VALUES_DEV, npPrecise), true);
    assert.equal(valuesDevContentTriggersFoundation(REAL_VALUES_DEV, egressHead), true);
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        valuesDevBaseText: REAL_VALUES_DEV,
        valuesDevHeadText: egressHead
      }).foundationRollout,
      true
    );
  });

  it("fail-closes missing hunk-context / unproven diff-only classification", () => {
    const tagOnlyDiffMissingContext = [
      "-    tag: oldsha000000000000000000000000000000000000",
      "+    tag: newsha111111111111111111111111111111111111"
    ].join("\n");
    assert.equal(valuesDevDiffTriggersFoundation(tagOnlyDiffMissingContext), true);
    assert.equal(
      detectAffected(["infra/helm/values-dev.yaml"], {
        valuesDevDiffText: tagOnlyDiffMissingContext
      }).foundationRollout,
      true
    );
  });

  it("marks bootstrap inventory change as foundation rollout and forces sandbox deploy", () => {
    const result = detectAffected(["infra/bootstrap/adr146-sandbox-egress-foundation.json"]);
    assert.equal(result.foundationRollout, true);
    assert.equal(result.docsOnly, false);
    assert.equal(result.testOnly, false);
    assert.ok(result.riskReasons.includes("adr146-foundation"));
    assert.deepEqual(deployNames(result), ["sandbox"]);
    assert.deepEqual(immediateNames(result), ["sandbox"]);
    assert.deepEqual(deferredNames(result), []);
    assert.match(result.summary, /adr146-foundation=true/);
  });

  it("marks Helm NetworkPolicy template as foundation + helm validation", () => {
    const result = detectAffected(["infra/helm/templates/networkpolicies.yaml"]);
    assert.equal(result.foundationRollout, true);
    assert.equal(result.runHelmValidation, true);
    assert.deepEqual(immediateNames(result), ["sandbox"]);
    assert.deepEqual(deferredNames(result), []);
  });

  it("partitions root package.json fanout so non-sandbox pins are deferred", () => {
    const result = detectAffected([
      "package.json",
      "infra/bootstrap/adr146-sandbox-egress-foundation.json"
    ]);
    assert.equal(result.foundationRollout, true);
    assert.ok(result.riskReasons.includes("root-workspace"));
    assert.ok(result.riskReasons.includes("adr146-foundation"));
    assert.ok(deployNames(result).includes("api"));
    assert.ok(deployNames(result).includes("web"));
    assert.ok(deployNames(result).includes("runtime"));
    assert.ok(deployNames(result).includes("provider-gateway"));
    assert.ok(deployNames(result).includes("sandbox"));
    assert.deepEqual(immediateNames(result), ["sandbox"]);
    assert.deepEqual(deferredNames(result), ["api", "provider-gateway", "runtime", "web"].sort());
    assert.ok(
      !deferredNames(result).includes("sandbox"),
      "sandbox must never be deferred on foundation rollout"
    );
  });

  it("keeps non-foundation root fanout on the ordinary immediate pin path", () => {
    const result = detectAffected(["package.json"]);
    assert.equal(result.foundationRollout, false);
    assert.ok(deployNames(result).includes("api"));
    assert.ok(deployNames(result).includes("sandbox"));
    assert.deepEqual(immediateNames(result), []);
    assert.deepEqual(deferredNames(result), []);
  });

  it("composes foundation markers with migration fanout", () => {
    const result = detectAffected([
      "apps/api/prisma/migrations/20240101_init/migration.sql",
      "infra/bootstrap/lib/foundation.mjs"
    ]);
    assert.equal(result.foundationRollout, true);
    assert.equal(result.migrationChanged, true);
    assert.deepEqual(immediateNames(result), ["sandbox"]);
    assert.ok(deferredNames(result).includes("api"));
    assert.ok(deferredNames(result).includes("runtime"));
    assert.ok(!deferredNames(result).includes("sandbox"));
  });

  it("composes foundation markers with ordinary api+web app changes", () => {
    const result = detectAffected([
      "apps/api/src/main.ts",
      "apps/web/src/app/page.tsx",
      "infra/helm/templates/sandbox-serviceaccount.yaml"
    ]);
    assert.equal(result.foundationRollout, true);
    assert.deepEqual(immediateNames(result), ["sandbox"]);
    assert.deepEqual(deferredNames(result), ["api", "web"].sort());
  });

  it("does not treat docs-only ADR text as foundation rollout", () => {
    const result = detectAffected(["docs/ADR/146-assistant-owned-full-public-sandbox-egress.md"]);
    assert.equal(result.foundationRollout, false);
    assert.equal(result.docsOnly, true);
    assert.equal(result.deployServices.length, 0);
  });

  it("does not treat foundation unit-test-only app changes as foundation rollout", () => {
    const result = detectAffected(["apps/sandbox/test/exec-pod-bridge.service.test.ts"]);
    assert.equal(result.foundationRollout, false);
    assert.equal(result.testOnly, true);
  });

  it("partitionFoundationServices mirrors detector partitioning", () => {
    const services = [{ service: "api" }, { service: "sandbox" }, { service: "web" }];
    const partitioned = partitionFoundationServices(services, true);
    assert.deepEqual(
      partitioned.foundationImmediateServices.map((entry) => entry.service),
      ["sandbox"]
    );
    assert.deepEqual(partitioned.foundationDeferredServices.map((entry) => entry.service).sort(), [
      "api",
      "web"
    ]);
    assert.deepEqual(partitionFoundationServices(services, false), {
      foundationImmediateServices: [],
      foundationDeferredServices: []
    });
  });
});
