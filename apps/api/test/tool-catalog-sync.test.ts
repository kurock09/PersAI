import assert from "node:assert/strict";
import { TOOL_CATALOG } from "../prisma/tool-catalog-data";
import { upsertToolCatalogEntry } from "../prisma/tool-catalog-sync";

async function run(): Promise<void> {
  const scheduledAction = TOOL_CATALOG.find((entry) => entry.code === "scheduled_action");
  assert.ok(scheduledAction, "scheduled_action catalog entry must exist");

  const calls: Array<Record<string, unknown>> = [];
  const prisma = {
    toolCatalogTool: {
      async upsert(args: Record<string, unknown>) {
        calls.push(args);
        return undefined;
      }
    }
  };

  await upsertToolCatalogEntry(prisma as never, scheduledAction, null);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.where, { id: scheduledAction.id });
  assert.equal((calls[0]?.update as Record<string, unknown>).code, "scheduled_action");
  assert.equal((calls[0]?.create as Record<string, unknown>).id, scheduledAction.id);
  assert.equal((calls[0]?.create as Record<string, unknown>).code, "scheduled_action");

  const webSearch = TOOL_CATALOG.find((entry) => entry.code === "web_search");
  assert.ok(webSearch, "web_search catalog entry must exist");

  calls.length = 0;
  await upsertToolCatalogEntry(prisma as never, webSearch, {
    schema: "persai.toolCatalogProviderHints.v3",
    providerAgnostic: false,
    requiredCredentialId: "tool_web_search",
    modelDescription: null,
    modelUsageGuidance: null
  });
  const defaultHints = (calls[0]?.update as Record<string, unknown>).providerHints as Record<
    string,
    unknown
  >;
  assert.equal(defaultHints.modelDescription, null);
  assert.equal(defaultHints.modelUsageGuidance, null);

  calls.length = 0;
  await upsertToolCatalogEntry(prisma as never, webSearch, {
    schema: "persai.toolCatalogProviderHints.v3",
    providerAgnostic: false,
    requiredCredentialId: "tool_web_search",
    modelDescription: webSearch.modelDescription,
    modelUsageGuidance: webSearch.modelUsageGuidance
  });
  const legacyDefaultHints = (calls[0]?.update as Record<string, unknown>).providerHints as Record<
    string,
    unknown
  >;
  assert.equal(
    legacyDefaultHints.modelDescription,
    null,
    "legacy rows that stored the code default must be normalized back to use-code-default"
  );
  assert.equal(
    legacyDefaultHints.modelUsageGuidance,
    null,
    "legacy rows that stored code default guidance must not remain marked as overrides"
  );

  calls.length = 0;
  await upsertToolCatalogEntry(prisma as never, webSearch, {
    schema: "persai.toolCatalogProviderHints.v3",
    providerAgnostic: false,
    requiredCredentialId: "tool_web_search",
    modelDescription: "Custom web search description",
    modelUsageGuidance: "Custom web search guidance"
  });
  const overrideHints = (calls[0]?.update as Record<string, unknown>).providerHints as Record<
    string,
    unknown
  >;
  assert.equal(overrideHints.modelDescription, "Custom web search description");
  assert.equal(overrideHints.modelUsageGuidance, "Custom web search guidance");
}

void run();
