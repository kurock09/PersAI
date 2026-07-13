/**
 * ADR-146 Slice 2 — rendered NetworkPolicy + egress-mode contract assertions.
 * Proves restricted default contour and additive full-public policy shape without
 * cloud mutation or ExecPodBridge wiring.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import {
  buildRestrictedProxyDeniedCidrs,
  buildSandboxPublicEgressDeniedCidrs
} from "../../bootstrap/lib/cidr.mjs";
import {
  extractValuesDevPublicDeniedCidrs,
  fullPublicExecNetworkPolicyMatches,
  loadInventory,
  runStaticDeployTruth
} from "../../bootstrap/lib/foundation.mjs";

const { parse: parseYaml, parseAllDocuments } = yaml;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function renderHelm(extraArgs = []) {
  const args = [
    "template",
    "persai-dev",
    "infra/helm",
    "-f",
    "infra/helm/values.yaml",
    "-f",
    "infra/helm/values-dev.yaml",
    ...extraArgs
  ];
  return spawnSync("helm", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false
  });
}

function documentsFromHelm(stdout) {
  return parseAllDocuments(stdout)
    .map((doc) => doc.toJSON())
    .filter(Boolean);
}

function findPolicy(docs, name) {
  return docs.find((doc) => doc?.kind === "NetworkPolicy" && doc?.metadata?.name === name);
}

test("shared deny builders are identical for restricted proxy and full-public", () => {
  const inventory = loadInventory();
  assert.deepEqual(
    buildSandboxPublicEgressDeniedCidrs(inventory),
    buildRestrictedProxyDeniedCidrs(inventory)
  );
});

test("rendered restricted isolation preserves live contour selectors", () => {
  const rendered = renderHelm();
  assert.equal(rendered.status, 0, rendered.stderr);
  const docs = documentsFromHelm(rendered.stdout);
  const isolation = findPolicy(docs, "sandbox-exec-isolation");
  assert.ok(isolation);
  assert.deepEqual(isolation.spec.podSelector, {
    matchLabels: { "app.kubernetes.io/component": "sandbox-exec" }
  });
  assert.deepEqual(isolation.spec.ingress, []);
  assert.equal(isolation.spec.egress.length, 2);
  assert.ok(
    isolation.spec.egress.every((rule) =>
      (rule.to ?? []).every(
        (peer) =>
          !Object.prototype.hasOwnProperty.call(peer, "namespaceSelector") &&
          (Object.prototype.hasOwnProperty.call(peer, "ipBlock") ||
            Object.prototype.hasOwnProperty.call(peer, "podSelector"))
      )
    )
  );
  const dnsPeers = isolation.spec.egress[0].to.map((peer) => peer.ipBlock.cidr).sort();
  assert.deepEqual(dnsPeers, ["169.254.20.10/32", "34.118.224.10/32"].sort());
});

test("rendered full-public policy selects only full-public exec pods", () => {
  const inventory = loadInventory();
  const rendered = renderHelm();
  assert.equal(rendered.status, 0, rendered.stderr);
  const docs = documentsFromHelm(rendered.stdout);
  const fullPublic = findPolicy(docs, "sandbox-exec-full-public-egress");
  assert.ok(fullPublic);
  assert.equal(fullPublicExecNetworkPolicyMatches(inventory, fullPublic), true);
  assert.deepEqual(fullPublic.spec.podSelector.matchLabels, {
    "app.kubernetes.io/component": "sandbox-exec",
    "persai.io/sandbox-egress": "full-public"
  });
  assert.equal(Object.keys(fullPublic.spec.podSelector).length, 1);
  assert.doesNotMatch(JSON.stringify(fullPublic), /"app\.kubernetes\.io\/name":"sandbox"/);
  for (const rule of fullPublic.spec.egress) {
    for (const peer of rule.to ?? []) {
      assert.equal(Object.keys(peer).includes("podSelector"), false);
      assert.equal(Object.keys(peer).includes("namespaceSelector"), false);
    }
  }
  const publicRule = fullPublic.spec.egress.find(
    (rule) => rule.to?.[0]?.ipBlock?.cidr === "0.0.0.0/0"
  );
  assert.ok(publicRule);
  assert.deepEqual(
    [...publicRule.to[0].ipBlock.except].sort(),
    buildSandboxPublicEgressDeniedCidrs(inventory)
  );
  assert.deepEqual(publicRule.ports.map((port) => port.protocol).sort(), ["TCP", "UDP"]);
  assert.ok(publicRule.ports.every((port) => port.port == null));
});

test("rendered NAT identity probe except uses every shared denied CIDR", () => {
  const inventory = loadInventory();
  const rendered = renderHelm();
  assert.equal(rendered.status, 0, rendered.stderr);
  const docs = documentsFromHelm(rendered.stdout);
  const natProbe = findPolicy(docs, "sandbox-nat-identity-probe-isolation");
  assert.ok(natProbe);
  const publicRule = natProbe.spec.egress.find(
    (rule) => rule.to?.[0]?.ipBlock?.cidr === "0.0.0.0/0"
  );
  assert.ok(publicRule);
  assert.deepEqual(
    [...publicRule.to[0].ipBlock.except].sort(),
    buildSandboxPublicEgressDeniedCidrs(inventory)
  );
});

test("egress-mode contract ConfigMap keeps restricted default and proxy-env split", () => {
  const rendered = renderHelm(["-s", "templates/sandbox-exec-egress-contract.yaml"]);
  assert.equal(rendered.status, 0, rendered.stderr);
  const docs = documentsFromHelm(rendered.stdout);
  const contract = docs.find(
    (doc) =>
      doc?.kind === "ConfigMap" && doc?.metadata?.name === "sandbox-exec-egress-mode-contract"
  );
  assert.ok(contract);
  assert.equal(contract.data.defaultMode, "restricted");
  assert.equal(contract.data.modeLabelKey, "persai.io/sandbox-egress");
  assert.equal(contract.data.restrictedLabelValue, "restricted");
  assert.equal(contract.data.fullPublicLabelValue, "full-public");
  assert.match(contract.data.restrictedProxyEnvYaml, /name: HTTP_PROXY/);
  assert.match(contract.data.restrictedProxyEnvYaml, /name: HTTPS_PROXY/);
  assert.match(contract.data.restrictedProxyEnvYaml, /name: http_proxy/);
  assert.match(contract.data.restrictedProxyEnvYaml, /name: https_proxy/);
  assert.match(contract.data.restrictedProxyEnvYaml, /name: NO_PROXY/);
  assert.match(contract.data.restrictedProxyEnvYaml, /name: no_proxy/);
  assert.equal(contract.data.fullPublicProxyEnvYaml ?? "", "");
  const modes = JSON.parse(contract.data.modesJson);
  assert.equal(modes.restricted.injectProxyEnv, true);
  assert.equal(modes.full_public.injectProxyEnv, false);
  assert.equal(modes.full_public.label, "full-public");
});

test("chart fails closed for invalid or incomplete sandbox egress contracts", () => {
  for (const extra of [
    ["--set", "networkPolicy.enabled=false"],
    ["--set", "sandbox.execEgress.defaultMode=full_public"],
    ["--set-json", "networkPolicy.sandboxEgress.requiredDeniedCidrs=[]"],
    ["--set-json", "networkPolicy.sandboxDns.allowedCidrs=[]"],
    ["--set", "networkPolicy.sandboxDns.peerMode=podSelector"],
    ["--set-json", "networkPolicy.sandboxDns.peerMode=null"],
    ["--set", "networkPolicy.sandboxEgress.ipFamily=IPv6"],
    ["--set", "networkPolicy.sandboxEgress.ipFamily=dual-stack"],
    ["--set-json", "networkPolicy.sandboxEgress.ipFamily=null"]
  ]) {
    const rendered = renderHelm(extra);
    assert.notEqual(rendered.status, 0, extra.join(" "));
  }
});

test("static deploy truth binds values-dev deny inventory to Cloud NAT foundation", () => {
  const inventory = loadInventory();
  const valuesDevText = readFileSync(path.join(repoRoot, "infra/helm/values-dev.yaml"), "utf8");
  const valuesDenied = extractValuesDevPublicDeniedCidrs(valuesDevText);
  assert.ok(valuesDenied);
  assert.deepEqual([...valuesDenied].sort(), buildSandboxPublicEgressDeniedCidrs(inventory));
  const rendered = renderHelm(["-s", "templates/networkpolicies.yaml"]);
  assert.equal(rendered.status, 0, rendered.stderr);
  const docs = documentsFromHelm(rendered.stdout);
  const fullPublic = findPolicy(docs, "sandbox-exec-full-public-egress");
  const truth = runStaticDeployTruth(inventory, {
    valuesDevText,
    fullPublicExecNetworkPolicy: fullPublic
  });
  assert.equal(truth.ok, true, JSON.stringify(truth.checks.filter((check) => !check.ok)));
  assert.ok(
    truth.checks.some((check) => check.id === "helm-shared-public-deny-inventory" && check.ok)
  );
  assert.ok(
    truth.checks.some((check) => check.id === "rendered-full-public-exec-networkpolicy" && check.ok)
  );
  assert.ok(
    truth.checks.some((check) => check.id === "nat-primary-plus-sandbox-secondary" && check.ok)
  );
  assert.ok(
    truth.checks.some((check) => check.id === "vpc-deny-excludes-calico-owned-paths" && check.ok)
  );
});

test("exec ServiceAccount remains identity-less in rendered chart", () => {
  const rendered = renderHelm(["-s", "templates/sandbox-serviceaccount.yaml"]);
  assert.equal(rendered.status, 0, rendered.stderr);
  const docs = documentsFromHelm(rendered.stdout);
  const execSa = docs.find(
    (doc) => doc?.kind === "ServiceAccount" && doc?.metadata?.name === "sandbox-exec-sa"
  );
  assert.ok(execSa);
  assert.equal(execSa.automountServiceAccountToken, false);
  assert.equal(execSa.metadata.annotations, undefined);
  assert.equal(execSa.metadata.labels["persai.io/sandbox-exec-identity"], "none");
  const wiFail = renderHelm([
    "-s",
    "templates/sandbox-serviceaccount.yaml",
    "--set",
    "sandbox.execServiceAccount.gcpServiceAccountEmail=evil@example.iam.gserviceaccount.com"
  ]);
  assert.notEqual(wiFail.status, 0);
});

test("values-dev peerMode contract stays ipBlockOnly", () => {
  const values = parseYaml(readFileSync(path.join(repoRoot, "infra/helm/values-dev.yaml"), "utf8"));
  assert.equal(values.networkPolicy.sandboxDns.peerMode, "ipBlockOnly");
  assert.equal(values.networkPolicy.sandboxEgress.ipFamily, "IPv4");
  assert.equal(values.sandbox.execEgress.defaultMode, "restricted");
  assert.equal(values.networkPolicy.sandboxEgress.fullPublicLabelValue, "full-public");
});
