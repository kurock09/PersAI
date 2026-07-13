import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSandboxEgressModeMetadata,
  buildSandboxEgressProxyEnv,
  fromKubernetesSandboxEgressLabel,
  isAssistantSandboxEgressMode,
  readPodSandboxEgressMode,
  SANDBOX_EGRESS_MODE_KEY,
  toKubernetesSandboxEgressLabel
} from "../src/sandbox-egress-mode";

test("sandbox-egress-mode: Prisma ↔ Kubernetes label mapping is exact", () => {
  assert.equal(toKubernetesSandboxEgressLabel("restricted"), "restricted");
  assert.equal(toKubernetesSandboxEgressLabel("full_public"), "full-public");
  assert.equal(fromKubernetesSandboxEgressLabel("restricted"), "restricted");
  assert.equal(fromKubernetesSandboxEgressLabel("full-public"), "full_public");
  assert.equal(fromKubernetesSandboxEgressLabel("full_public"), null);
  assert.equal(isAssistantSandboxEgressMode("full_public"), true);
  assert.equal(isAssistantSandboxEgressMode("full-public"), false);
});

test("sandbox-egress-mode: pod mode requires matching label and annotation", () => {
  assert.equal(
    readPodSandboxEgressMode({
      labels: { [SANDBOX_EGRESS_MODE_KEY]: "full-public" },
      annotations: { [SANDBOX_EGRESS_MODE_KEY]: "full-public" }
    }),
    "full_public"
  );
  assert.equal(
    readPodSandboxEgressMode({
      labels: { [SANDBOX_EGRESS_MODE_KEY]: "restricted" },
      annotations: { [SANDBOX_EGRESS_MODE_KEY]: "full-public" }
    }),
    null
  );
  assert.equal(readPodSandboxEgressMode({ labels: {}, annotations: {} }), null);
  const meta = buildSandboxEgressModeMetadata("full_public");
  assert.deepEqual(meta.labels, { [SANDBOX_EGRESS_MODE_KEY]: "full-public" });
  assert.deepEqual(meta.annotations, { [SANDBOX_EGRESS_MODE_KEY]: "full-public" });
});

test("sandbox-egress-mode: proxy env is restricted-only six-entry contour", () => {
  const restricted = buildSandboxEgressProxyEnv("restricted", {
    proxyUrl: "http://sandbox-egress-proxy:3128",
    noProxy: "10.0.0.0/8,192.168.0.0/16"
  });
  assert.deepEqual(
    restricted.map((entry) => entry.name),
    ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NO_PROXY", "no_proxy"]
  );
  assert.deepEqual(
    buildSandboxEgressProxyEnv("full_public", {
      proxyUrl: "http://sandbox-egress-proxy:3128",
      noProxy: "10.0.0.0/8"
    }),
    []
  );
});
