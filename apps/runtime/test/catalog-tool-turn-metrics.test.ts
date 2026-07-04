import assert from "node:assert/strict";
import {
  createEmptyCatalogToolTurnMetrics,
  estimateToolsJsonTokens,
  formatCatalogToolTurnMetricsLog,
  measureToolsJsonCharCount,
  recordCatalogDescribeCall,
  recordFirstIterationToolsJsonCharCount,
  recordToolContractNotLoaded
} from "../src/modules/turns/catalog-tool-turn-metrics";

export async function runCatalogToolTurnMetricsTest(): Promise<void> {
  const sampleTools = [
    { name: "web_search", description: "Search.", inputSchema: { type: "object" } },
    { name: "document", description: "Docs.", inputSchema: { type: "object" } }
  ];
  const charCount = measureToolsJsonCharCount(sampleTools);
  assert.ok(charCount > 0);
  assert.equal(estimateToolsJsonTokens(charCount), Math.ceil(charCount / 3));

  const metrics = createEmptyCatalogToolTurnMetrics();
  recordFirstIterationToolsJsonCharCount(metrics, sampleTools);
  recordFirstIterationToolsJsonCharCount(metrics, [{ name: "ignored" }]);
  assert.equal(metrics.tools_json_char_count, charCount);

  recordCatalogDescribeCall(metrics);
  recordCatalogDescribeCall(metrics);
  recordToolContractNotLoaded(metrics);
  assert.equal(metrics.catalog_describe_calls, 2);
  assert.equal(metrics.tool_contract_not_loaded, 1);

  const logLine = formatCatalogToolTurnMetricsLog({
    requestId: "req-adr135",
    metrics
  });
  assert.match(logLine, /\[turn-catalog-metrics\]/);
  assert.match(logLine, /requestId=req-adr135/);
  assert.match(logLine, /tools_json_char_count=\d+/);
  assert.match(logLine, /catalog_describe_calls=2/);
  assert.match(logLine, /tool_contract_not_loaded=1/);
}
