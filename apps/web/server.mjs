import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";

/**
 * Production entrypoint: standard Next HTTP server.
 * NODE_ENV must be "production" in the container (see apps/web/Dockerfile).
 */
const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.WEB_BIND_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

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
  .listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (next ${dev ? "dev" : "production"})`);
  });
