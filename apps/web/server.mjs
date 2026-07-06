import { createServer } from "node:http";
import { parse } from "node:url";
import httpProxy from "http-proxy";
import next from "next";

/**
 * Production entrypoint: standard Next HTTP + WS upgrade proxy for browser-login modal only.
 * NODE_ENV must be "production" in the container (see apps/web/Dockerfile).
 */
const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.WEB_BIND_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true, secure: true });

const BROWSER_LOGIN_PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBrowserLoginLiveProxyPath(pathname) {
  const match = /^\/api\/browser-login-live\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (!match) {
    return null;
  }
  const assistantId = decodeURIComponent(match[1] ?? "");
  const profileId = decodeURIComponent(match[2] ?? "");
  if (assistantId.length === 0 || !BROWSER_LOGIN_PROFILE_ID_PATTERN.test(profileId)) {
    return null;
  }
  const rest = match[3] ?? "";
  return {
    assistantId,
    profileId,
    upstreamPath: rest.length > 0 ? `/${rest}` : ""
  };
}

function buildUpstreamTargetUrl(upstreamLiveUrl, upstreamPath, search) {
  const upstream = new URL(upstreamLiveUrl);
  if (upstreamPath.length === 0) {
    const target = new URL(upstream.toString());
    if (search.length > 0) {
      const params = new URLSearchParams(search);
      params.forEach((value, key) => {
        target.searchParams.set(key, value);
      });
    }
    return target.toString();
  }
  const normalizedPath = upstreamPath.startsWith("/") ? upstreamPath : `./${upstreamPath}`;
  const target = new URL(normalizedPath, upstream);
  upstream.searchParams.forEach((value, key) => {
    if (!target.searchParams.has(key)) {
      target.searchParams.set(key, value);
    }
  });
  if (search.length > 0) {
    const params = new URLSearchParams(search);
    params.forEach((value, key) => {
      target.searchParams.set(key, value);
    });
  }
  return target.toString();
}

async function resolveUpstreamLiveUrl(req, assistantId, profileId) {
  const resolveUrl = `http://127.0.0.1:${port}/api/internal/browser-login-live-upstream/${encodeURIComponent(assistantId)}/${encodeURIComponent(profileId)}`;
  const response = await fetch(resolveUrl, {
    headers: {
      cookie: req.headers.cookie ?? "",
      accept: "application/json"
    },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`live-upstream ${response.status}`);
  }
  const payload = await response.json();
  if (typeof payload.upstreamLiveUrl !== "string" || payload.upstreamLiveUrl.trim().length === 0) {
    throw new Error("live-upstream missing url");
  }
  return payload.upstreamLiveUrl.trim();
}

async function handleBrowserLoginLiveUpgrade(req, socket, head) {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const proxyPath = parseBrowserLoginLiveProxyPath(requestUrl.pathname);
  if (proxyPath === null) {
    return false;
  }

  try {
    const upstreamLiveUrl = await resolveUpstreamLiveUrl(
      req,
      proxyPath.assistantId,
      proxyPath.profileId
    );
    const targetUrl = buildUpstreamTargetUrl(
      upstreamLiveUrl,
      proxyPath.upstreamPath,
      requestUrl.search
    );
    const target = new URL(targetUrl);
    req.url = `${target.pathname}${target.search}`;
    proxy.ws(req, socket, head, {
      target: target.origin,
      secure: target.protocol === "wss:"
    });
    return true;
  } catch (error) {
    console.error("[browser-login-live-ws]", error);
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.destroy();
    return true;
  }
}

await app.prepare();

createServer(async (req, res) => {
  try {
    const parsedUrl = parse(req.url ?? "/", true);
    await handle(req, res, parsedUrl);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end("internal server error");
  }
})
  .on("upgrade", (req, socket, head) => {
    void handleBrowserLoginLiveUpgrade(req, socket, head).then((handled) => {
      if (!handled) {
        socket.destroy();
      }
    });
  })
  .listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (next ${dev ? "dev" : "production"})`);
  });
