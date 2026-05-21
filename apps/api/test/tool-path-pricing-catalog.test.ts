import assert from "node:assert/strict";
import {
  buildToolPathKey,
  createDefaultToolPathPricingCatalog,
  findToolPathPricingRowForTimestamp,
  normalizeToolPathPricingCatalogRecord,
  parseAdminToolPathPricingCatalogRequest,
  resolveToolPathKeyFromBillingFacts
} from "../src/modules/workspace-management/application/tool-path-pricing-catalog";

async function run(): Promise<void> {
  const defaults = createDefaultToolPathPricingCatalog();
  assert.ok(defaults.rows.some((row) => row.pathKey === "web_search:tavily"));
  assert.ok(defaults.rows.some((row) => row.pathKey === "document_render:gamma"));
  const gamma = defaults.rows.find((row) => row.pathKey === "document_render:gamma");
  assert.equal(
    gamma?.billingMode === "tiered_operation"
      ? gamma.providerPriceMetadata.tieredOperationPricing.tiers.length
      : 0,
    2
  );

  const parsed = parseAdminToolPathPricingCatalogRequest({
    rows: [
      {
        toolCode: "web_fetch",
        providerId: "firecrawl",
        billingMode: "fixed_operation",
        active: true,
        providerPriceMetadata: {
          currency: "USD",
          fixedOperationPricing: {
            unitLabel: "fetch",
            pricePerOperation: 0.02
          }
        }
      }
    ]
  });
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]?.pathKey, "web_fetch:firecrawl");

  const merged = normalizeToolPathPricingCatalogRecord({
    schema: "persai.toolPathPricingCatalog.v1",
    rows: parsed.rows
  });
  assert.ok(merged.rows.length > parsed.rows.length);

  const match = findToolPathPricingRowForTimestamp(
    merged,
    buildToolPathKey("web_fetch", "firecrawl"),
    new Date("2026-05-20T12:00:00.000Z")
  );
  assert.equal(
    match?.billingMode === "fixed_operation"
      ? match.providerPriceMetadata.fixedOperationPricing.pricePerOperation
      : null,
    0.02
  );

  assert.equal(
    resolveToolPathKeyFromBillingFacts({
      capability: "browser",
      providerKey: "browserless",
      modelKey: "browser"
    }),
    "browser:browserless"
  );
}

void run();
