import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertReadyResponse,
  buildReadyExecArgs,
  parseReadyResponse
} from "./adr161-rollout-floor.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function helm(extraArgs = []) {
  return spawnSync(
    "helm",
    [
      "template",
      "persai-dev",
      "infra/helm",
      "-f",
      "infra/helm/values.yaml",
      "-f",
      "infra/helm/values-dev.yaml",
      ...extraArgs
    ],
    { cwd: repoRoot, encoding: "utf8", shell: false }
  );
}

test("ADR-161 Release A renders legacy producer gates and v2-ready consumers", () => {
  const rendered = helm();
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /RUNTIME_TEXT_USAGE_V2_PRODUCER_ENABLED\s+value: "false"/);
  assert.match(rendered.stdout, /PROVIDER_GATEWAY_TEXT_USAGE_V2_PRODUCER_ENABLED\s+value: "false"/);
});

test("ADR-161 rejects B1 without an active runtime consumer floor", () => {
  const rendered = helm(["--set", "adr161TextUsageRollout.providerGatewayV2Producer=true"]);
  assert.notEqual(rendered.status, 0);
  assert.match(rendered.stderr, /runtime consumer and provider-gateway producer floors/);
});

test("ADR-161 rejects B2 without an active API consumer floor", () => {
  const rendered = helm(["--set", "adr161TextUsageRollout.runtimeV2Producer=true"]);
  assert.notEqual(rendered.status, 0);
  assert.match(rendered.stderr, /API consumer and runtime producer floors/);
});

test("ADR-161 rejects an active floor when the selected image is unapproved", () => {
  const rendered = helm([
    "--set",
    "adr161TextUsageRollout.runtimeConsumerFloor.active=true",
    "--set",
    "adr161TextUsageRollout.runtimeConsumerFloor.imageTag=approved-sha",
    "--set",
    "adr161TextUsageRollout.runtimeConsumerFloor.approvedImageTags[0]=approved-sha"
  ]);
  assert.notEqual(rendered.status, 0);
  assert.match(rendered.stderr, /runtime image is not approved/);
});

test("ADR-161 probe execs Node localhost fetch without shell quoting", () => {
  const args = buildReadyExecArgs("persai-dev", "runtime-123", "runtime", 3012);
  assert.deepEqual(args.slice(0, 10), [
    "-n",
    "persai-dev",
    "exec",
    "runtime-123",
    "-c",
    "runtime",
    "--",
    "node",
    "--input-type=module",
    "-e"
  ]);
  assert.match(args[10], /^const \[url\] = process\.argv\.slice\(1\);/);
  assert.match(args[10], /fetch\(url/);
  assert.equal(args[11], "http://127.0.0.1:3012/ready");
});

test("ADR-161 rejects malformed /ready JSON", () => {
  assert.throws(
    () => parseReadyResponse("<html>nope</html>", "runtime", "runtime-123"),
    /runtime\/runtime-123 returned malformed \/ready JSON: <html>nope<\/html>/
  );
});

test("ADR-161 rejects non-ready /ready JSON", () => {
  assert.throws(
    () =>
      assertReadyResponse(
        { ready: false, status: "starting", capabilities: { textUsageV2Consumer: true } },
        "runtime",
        "runtime-123"
      ),
    /runtime\/runtime-123 is not ready:/
  );
});
