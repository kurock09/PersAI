#!/usr/bin/env node
/**
 * Browserless residential RU proxy smoke.
 *
 * Separates "account/token has no residential" from "PersAI path is wrong".
 * Run locally with the same automation token PersAI uses for browser tools.
 *
 *   $env:BROWSERLESS_TOKEN="your-token"
 *   $env:BROWSERLESS_BASE_URL="https://production-sfo.browserless.io"  # optional
 *   node scripts/dev/browserless-residential-proxy-smoke.mjs
 */

const TOKEN = process.env.BROWSERLESS_TOKEN?.trim();
const BASE = (process.env.BROWSERLESS_BASE_URL ?? "https://production-sfo.browserless.io").replace(
  /\/$/,
  ""
);

if (!TOKEN) {
  console.error("Set BROWSERLESS_TOKEN to the Browserless automation API token.");
  process.exit(1);
}

async function bqlPost(url, query, variables = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

const IP_PROBE_MUTATION = `
  mutation IpProbe {
    proxy(network: residential, sticky: true, url: ["*"], country: RU) { time }
    goto(url: "https://httpbin.org/ip", waitUntil: domContentLoaded, timeout: 60000) { status }
    ip: text(selector: "body") { text }
  }
`;

function parseIpBody(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed.origin ?? parsed.ip ?? text.trim();
  } catch {
    return text.trim();
  }
}

function printResult(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log(`HTTP ${result.status} ${result.ok ? "OK" : "FAIL"}`);
  if (Array.isArray(result.body?.errors) && result.body.errors.length > 0) {
    console.log("GraphQL errors:", JSON.stringify(result.body.errors, null, 2));
  }
  const ipText = result.body?.data?.ip?.text;
  if (typeof ipText === "string") {
    const ip = parseIpBody(ipText);
    console.log("httpbin body:", ipText.trim());
    console.log("egress IP:", ip);
    if (typeof ip === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      console.log(
        ip.startsWith("164.92.") || ip.startsWith("159.89.") || ip.startsWith("138.68.")
          ? "LIKELY datacenter (DO-style) — residential RU NOT active"
          : "non-DO IP — check geo (ipinfo.io) to confirm RU residential"
      );
    }
  } else if (!result.ok) {
    console.log("body:", JSON.stringify(result.body, null, 2).slice(0, 1200));
  }
}

async function testStealthBqlUrlProxy() {
  const url = new URL(`${BASE}/stealth/bql`);
  url.searchParams.set("token", TOKEN);
  url.searchParams.set("proxy", "residential");
  url.searchParams.set("proxyCountry", "ru");
  url.searchParams.set("proxySticky", "");
  const result = await bqlPost(url.toString(), IP_PROBE_MUTATION);
  return { label: "A) /stealth/bql + URL proxy=residential&proxyCountry=ru", result };
}

async function testSessionPathMutationOnly() {
  const createUrl = new URL(`${BASE}/session`);
  createUrl.searchParams.set("token", TOKEN);
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: 300_000, stealth: true })
  });
  const session = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    return {
      label: "B) POST /session (no URL proxy) — create failed",
      result: { ok: false, status: createRes.status, body: session }
    };
  }
  const bqlUrl = session.browserQL;
  const result = await bqlPost(bqlUrl, IP_PROBE_MUTATION);
  await cleanupSession(session.stop);
  return {
    label: "B) POST /session (no URL proxy) + BQL mutation only — old PersAI path",
    result
  };
}

async function testSessionPathUrlPlusMutation() {
  const createUrl = new URL(`${BASE}/session`);
  createUrl.searchParams.set("token", TOKEN);
  createUrl.searchParams.set("proxy", "residential");
  createUrl.searchParams.set("proxyCountry", "ru");
  createUrl.searchParams.set("proxySticky", "");
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: 300_000, stealth: true })
  });
  const session = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    return {
      label: "C) POST /session + URL proxy + BQL mutation — new PersAI path",
      result: { ok: false, status: createRes.status, body: session }
    };
  }
  const bqlUrlObj = new URL(session.browserQL);
  bqlUrlObj.searchParams.set("proxy", "residential");
  bqlUrlObj.searchParams.set("proxyCountry", "ru");
  bqlUrlObj.searchParams.set("proxySticky", "");
  const result = await bqlPost(bqlUrlObj.toString(), IP_PROBE_MUTATION);
  await cleanupSession(session.stop);
  return {
    label: "C) POST /session + URL proxy + BQL mutation — new PersAI path",
    result
  };
}

async function cleanupSession(stopUrl) {
  if (typeof stopUrl !== "string" || stopUrl.trim().length === 0) {
    return;
  }
  const url = new URL(stopUrl);
  url.searchParams.set("force", "true");
  await fetch(url, { method: "DELETE" }).catch(() => {});
}

async function main() {
  console.log(`Base: ${BASE}`);
  console.log("Probes httpbin.org/ip after proxy(country:RU). Compare A vs B vs C.\n");
  console.log("Interpretation:");
  console.log("  A works, B fails → PersAI needed URL proxy (deploy code fix)");
  console.log("  A fails, B fails, C fails → Browserless account/token — dashboard/support");
  console.log("  C works → deploy provider-gateway + recreate browser profile session");

  for (const fn of [testStealthBqlUrlProxy, testSessionPathMutationOnly, testSessionPathUrlPlusMutation]) {
    const { label, result } = await fn();
    printResult(label, result);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
