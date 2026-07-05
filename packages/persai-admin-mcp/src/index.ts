#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadPersaiAdminMcpConfig } from "./config.js";
import { createPersaiAdminMcpServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadPersaiAdminMcpConfig();
  const server = createPersaiAdminMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`persai-admin-mcp failed to start: ${message}`);
  process.exit(1);
});
