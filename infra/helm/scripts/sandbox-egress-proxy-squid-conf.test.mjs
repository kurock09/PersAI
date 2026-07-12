import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPECTED_LOGFORMAT_LINE,
  PINNED_SQUID_IMAGE,
  assertPersaiEgressLogformatContract,
  extractEgressProxyImageFromHelmYaml,
  extractSquidConfChecksumFromHelmYaml,
  extractSquidConfFromHelmYaml,
  parseSquidConfWithPinnedImage,
  renderSandboxEgressProxyYaml,
  runRenderedContractAndOptionalParse
} from "./sandbox-egress-proxy-squid-conf.mjs";

test("rendered sandbox-egress-proxy squid.conf keeps static tool=shell and forbids %ssl::>sni", () => {
  const { squidConf, squidConfChecksum, image, parseResult } = runRenderedContractAndOptionalParse({
    requireParse: false,
    pull: false
  });
  assert.equal(image, PINNED_SQUID_IMAGE);
  assert.match(squidConfChecksum, /^[0-9a-f]{64}$/);
  const logformat = squidConf
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("logformat persai_egress"));
  assert.equal(logformat, EXPECTED_LOGFORMAT_LINE);
  assert.match(logformat, /\stool=shell$/);
  assert.doesNotMatch(logformat, /%ssl::/);
  assert.doesNotMatch(logformat, /sni/i);
  if (parseResult.skipped) {
    assert.match(parseResult.reason, /docker unavailable|image not present locally/);
  } else {
    assert.equal(parseResult.ok, true);
  }
});

test("pod-template checksum/squid-conf changes when config-driving values change", () => {
  const baselineYaml = renderSandboxEgressProxyYaml();
  const baselineChecksum = extractSquidConfChecksumFromHelmYaml(baselineYaml);
  const baselineConf = extractSquidConfFromHelmYaml(baselineYaml);
  assert.match(baselineChecksum, /^[0-9a-f]{64}$/);
  assert.match(baselineConf, /http_port 3128/);
  assert.match(
    baselineConf,
    /acl allowed_domains dstdomain .pypi.org .files.pythonhosted.org .registry.npmjs.org .npmjs.com .github.com .githubusercontent.com/
  );

  const portYaml = renderSandboxEgressProxyYaml({
    set: ["sandbox.egressProxy.port=9999"]
  });
  const portChecksum = extractSquidConfChecksumFromHelmYaml(portYaml);
  const portConf = extractSquidConfFromHelmYaml(portYaml);
  assert.match(portConf, /http_port 9999/);
  assert.notEqual(portChecksum, baselineChecksum);

  const domainYaml = renderSandboxEgressProxyYaml({
    setJson: [
      'sandbox.egressProxy.allowedDomains=[".pypi.org",".files.pythonhosted.org",".registry.npmjs.org",".npmjs.com",".github.com",".githubusercontent.com",".example-allow.test"]'
    ]
  });
  const domainChecksum = extractSquidConfChecksumFromHelmYaml(domainYaml);
  const domainConf = extractSquidConfFromHelmYaml(domainYaml);
  assert.match(domainConf, /\.example-allow\.test/);
  assert.notEqual(domainChecksum, baselineChecksum);
  assert.notEqual(domainChecksum, portChecksum);

  // Unrelated Deployment fields must not be confused with the content hash:
  // image pin stays, securityContext stays, and checksum remains content-driven.
  assert.match(baselineYaml, /runAsUser:\s*13/);
  assert.match(baselineYaml, /allowPrivilegeEscalation:\s*false/);
  assert.match(baselineYaml, new RegExp(`image:\\s*"${PINNED_SQUID_IMAGE}"`));
  assert.match(baselineYaml, /subPath:\s*squid\.conf/);
});

test("logformat contract rejects the live CrashLoop %ssl::>sni token", () => {
  const broken = [
    "http_port 3128",
    "logformat persai_egress %ts.%03tu %>a %Ss/%03>Hs %<st %rm %ru %ssl::>sni tool=shell",
    "access_log stdio:/dev/stdout persai_egress"
  ].join("\n");
  assert.throws(
    () => assertPersaiEgressLogformatContract(broken),
    /unsupported fragment|logformat mismatch|%ssl::/i
  );
});

test("logformat contract requires %ru destination audit and static tool=shell", () => {
  const missingRu = [
    "http_port 3128",
    "logformat persai_egress %ts.%03tu %>a %Ss/%03>Hs %<st %rm tool=shell",
    "access_log stdio:/dev/stdout persai_egress"
  ].join("\n");
  assert.throws(() => assertPersaiEgressLogformatContract(missingRu), /mismatch|%ru/);

  const missingTool = [
    "http_port 3128",
    "logformat persai_egress %ts.%03tu %>a %Ss/%03>Hs %<st %rm %ru",
    "access_log stdio:/dev/stdout persai_egress"
  ].join("\n");
  assert.throws(() => assertPersaiEgressLogformatContract(missingTool), /tool=shell|mismatch/);
});

test("optional docker squid -k parse accepts repaired conf and rejects live-failing conf when image is local", () => {
  const repaired = [
    "http_port 3128",
    "acl CONNECT method CONNECT",
    "acl allowed_domains dstdomain .example.com",
    "http_access allow CONNECT allowed_domains",
    "http_access allow allowed_domains",
    "http_access deny all",
    "cache deny all",
    EXPECTED_LOGFORMAT_LINE,
    "access_log stdio:/dev/stdout persai_egress",
    "cache_log stdio:/dev/stderr",
    "pid_filename none"
  ].join("\n");
  const broken = repaired.replace(
    EXPECTED_LOGFORMAT_LINE,
    "logformat persai_egress %ts.%03tu %>a %Ss/%03>Hs %<st %rm %ru %ssl::>sni tool=shell"
  );

  const ok = parseSquidConfWithPinnedImage(repaired, { pull: false, requireParse: false });
  if (ok.skipped) {
    assert.match(ok.reason, /docker unavailable|image not present locally/);
    return;
  }
  assert.equal(ok.ok, true);

  assert.throws(
    () => parseSquidConfWithPinnedImage(broken, { pull: false, requireParse: true }),
    /Unsupported %code|Bungled|squid -k parse failed/i
  );
});

test("Helm render helpers extract ConfigMap conf, Deployment image, and checksum", () => {
  const fixtureChecksum = "a".repeat(64);
  const fixtureYaml = [
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    "  name: sandbox-egress-proxy-conf",
    "data:",
    "  squid.conf: |",
    "    http_port 3128",
    `    ${EXPECTED_LOGFORMAT_LINE}`,
    "    access_log stdio:/dev/stdout persai_egress",
    "---",
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: sandbox-egress-proxy",
    "spec:",
    "  template:",
    "    metadata:",
    "      annotations:",
    `        checksum/squid-conf: ${fixtureChecksum}`,
    "    spec:",
    "      containers:",
    "        - name: squid",
    `          image: "${PINNED_SQUID_IMAGE}"`
  ].join("\n");
  assert.equal(extractEgressProxyImageFromHelmYaml(fixtureYaml), PINNED_SQUID_IMAGE);
  assert.equal(extractSquidConfChecksumFromHelmYaml(fixtureYaml), fixtureChecksum);
  const conf = extractSquidConfFromHelmYaml(fixtureYaml);
  assert.match(conf, /http_port 3128/);
  assert.equal(assertPersaiEgressLogformatContract(conf), EXPECTED_LOGFORMAT_LINE);
  assert.throws(
    () =>
      extractSquidConfChecksumFromHelmYaml(
        fixtureYaml.replace(`checksum/squid-conf: ${fixtureChecksum}\n`, "")
      ),
    /checksum\/squid-conf/
  );
});
