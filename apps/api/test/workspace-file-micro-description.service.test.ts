import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  extractXlsxSharedStringsPreview,
  toUtf8Preview
} from "../src/modules/workspace-management/application/workspace-file-micro-description.service";
import { WorkspaceFileMicroDescriptionJobService } from "../src/modules/workspace-management/application/workspace-file-micro-description-job.service";

describe("workspace-file-micro-description helpers", () => {
  test("toUtf8Preview returns readable python text", () => {
    const preview = toUtf8Preview(Buffer.from('def main():\n    return "competitors"\n', "utf8"));
    assert.match(preview ?? "", /competitors/);
  });

  test("extractXlsxSharedStringsPreview reads shared strings xml", () => {
    const xml = Buffer.from(
      '<?xml version="1.0"?><sst><si><t>Competitor pricing</t></si></sst>',
      "utf8"
    );
    const zip = buildMinimalZip([["xl/sharedStrings.xml", xml]]);
    const preview = extractXlsxSharedStringsPreview(zip);
    assert.equal(preview, "Competitor pricing");
  });
});

describe("WorkspaceFileMicroDescriptionJobService policy", () => {
  test("project upload always enqueues", async () => {
    const calls: unknown[] = [];
    const service = new WorkspaceFileMicroDescriptionJobService(
      {
        workspaceFileMicroDescriptionJob: {
          findUnique: async () => null,
          upsert: async (args: unknown) => {
            calls.push(args);
          }
        }
      } as never,
      {
        get: async () => ({ shortDescription: null })
      } as never,
      {} as never,
      {
        execute: async () => ({ routerPolicy: { analyzeUploadsOnB2cUpload: false } })
      } as never,
      {} as never,
      {} as never
    );
    const result = await service.enqueueIfNeeded({
      workspaceId: "ws-1",
      path: "/workspace/assistants/a1/sessions/s1/report.xlsx",
      assistantId: "a1",
      sourceKind: "user_upload",
      chatMode: "project"
    });
    assert.equal(result.accepted, true);
    assert.equal(calls.length, 1);
  });

  test("B2C upload respects analyzeUploadsOnB2cUpload=false", async () => {
    const service = new WorkspaceFileMicroDescriptionJobService(
      {
        workspaceFileMicroDescriptionJob: {
          findUnique: async () => null,
          upsert: async () => undefined
        }
      } as never,
      {
        get: async () => ({ shortDescription: null })
      } as never,
      {} as never,
      {
        execute: async () => ({ routerPolicy: { analyzeUploadsOnB2cUpload: false } })
      } as never,
      {} as never,
      {} as never
    );
    const result = await service.enqueueIfNeeded({
      workspaceId: "ws-1",
      path: "/workspace/assistants/a1/sessions/s1/photo.png",
      assistantId: "a1",
      sourceKind: "user_upload",
      chatMode: "normal"
    });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, "policy_disabled");
  });
});

function buildMinimalZip(entries: Array<[string, Buffer]>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(0, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(data.length, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    chunks.push(header, nameBuf, data);
  }
  return Buffer.concat(chunks);
}
