import assert from "node:assert/strict";
import {
  PLAN_VISIBLE_MODEL_TOOL_CODES,
  PLAN_VISIBLE_MODEL_TOOL_DEFAULT_EXPOSURE
} from "../../api/prisma/tool-catalog-data";
import {
  estimateToolsJsonTokens,
  measureToolsJsonCharCount
} from "../src/modules/turns/catalog-tool-turn-metrics";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import {
  ADR135_WIRE_BUDGET_MIN_TOKEN_SAVINGS,
  assertAdr135PowerConfigFixtureCoverage,
  buildAdr135PowerConfigBundle
} from "./adr135-power-config-fixture";

export async function runCatalogToolWireBudgetTest(): Promise<void> {
  const baselineBundle = buildAdr135PowerConfigBundle("all_full");
  const platformBundle = buildAdr135PowerConfigBundle("platform_default");

  const baselineProjection = projectRuntimeNativeTools(baselineBundle);
  const platformProjection = projectRuntimeNativeTools(platformBundle);

  assertAdr135PowerConfigFixtureCoverage(baselineProjection.tools.map((tool) => tool.name));
  assert.equal(
    baselineProjection.tools.length,
    PLAN_VISIBLE_MODEL_TOOL_CODES.length + 1,
    "power-config fixture must project all 24 plan-visible model tools plus universal await (25 total)"
  );
  assert.deepEqual(
    baselineProjection.tools.map((tool) => tool.name).sort(),
    [...PLAN_VISIBLE_MODEL_TOOL_CODES, "await"].sort()
  );
  assert.equal(
    platformProjection.tools.length,
    baselineProjection.tools.length,
    "platform-default and baseline fixtures must project the same tool count"
  );
  assert.equal(
    platformProjection.tools.find((tool) => tool.name === "tools"),
    undefined,
    "ADR-135 acceptance: no meta-tool tools in projection"
  );

  const baselineCharCount = measureToolsJsonCharCount(baselineProjection.tools);
  const platformCharCount = measureToolsJsonCharCount(platformProjection.tools);
  const tokenSavings = estimateToolsJsonTokens(baselineCharCount - platformCharCount);

  assert.ok(
    tokenSavings >= ADR135_WIRE_BUDGET_MIN_TOKEN_SAVINGS,
    `ADR-135 wire-budget: expected >= ${String(ADR135_WIRE_BUDGET_MIN_TOKEN_SAVINGS)} tok savings on tools[], got ${String(tokenSavings)} (baselineChars=${String(baselineCharCount)} platformChars=${String(platformCharCount)})`
  );

  for (const toolCode of PLAN_VISIBLE_MODEL_TOOL_CODES) {
    if (PLAN_VISIBLE_MODEL_TOOL_DEFAULT_EXPOSURE[toolCode] !== "full") {
      continue;
    }
    const baselineTool = baselineProjection.tools.find((tool) => tool.name === toolCode);
    const platformTool = platformProjection.tools.find((tool) => tool.name === toolCode);
    assert.ok(baselineTool, `baseline must include full-tier tool ${toolCode}`);
    assert.ok(platformTool, `platform-default must include full-tier tool ${toolCode}`);
    assert.deepEqual(
      platformTool,
      baselineTool,
      `full-tier tool ${toolCode} must remain unchanged under platform defaults`
    );
  }

  for (const toolCode of PLAN_VISIBLE_MODEL_TOOL_CODES) {
    if (PLAN_VISIBLE_MODEL_TOOL_DEFAULT_EXPOSURE[toolCode] !== "catalog") {
      continue;
    }
    const platformTool = platformProjection.tools.find((tool) => tool.name === toolCode);
    const baselineTool = baselineProjection.tools.find((tool) => tool.name === toolCode);
    assert.ok(platformTool, `platform-default must include catalog-tier tool ${toolCode}`);
    assert.ok(baselineTool, `baseline must include catalog-tier tool ${toolCode}`);
    assert.match(
      platformTool?.description ?? "",
      new RegExp(`Call ${toolCode}\\(\\{action:"describe"\\}\\)`)
    );
  }

  const heavyCatalogTools = [
    "video_generate",
    "document",
    "image_generate",
    "presentation"
  ] as const;
  for (const toolCode of heavyCatalogTools) {
    const platformTool = platformProjection.tools.find((tool) => tool.name === toolCode);
    const baselineTool = baselineProjection.tools.find((tool) => tool.name === toolCode);
    assert.ok(
      measureToolsJsonCharCount([platformTool]) < measureToolsJsonCharCount([baselineTool]),
      `heavy catalog-tier tool ${toolCode} must shrink vs all-full baseline`
    );
  }

  console.log(
    `ADR-135 wire-budget: saved ${String(tokenSavings)} tok on tools[] (${String(baselineCharCount)} -> ${String(platformCharCount)} chars)`
  );
}
