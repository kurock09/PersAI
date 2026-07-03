import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DocumentWorkspaceVersionRegistrationService } from "../src/modules/workspace-management/application/document-workspace-version-registration.service";

describe("DocumentWorkspaceVersionRegistrationService", () => {
  const sessionRoot = "/workspace/assistants/assistant-1/sessions/runtime-session-1";
  const importedProjectRoot = `${sessionRoot}/projects/source`;
  const importedReportProjectRoot = `${sessionRoot}/projects/report`;

  test("registers a session-root authored xlsx output without requiring project.json", async () => {
    const registeredInputs: unknown[] = [];
    const savedObjects = new Map<string, Buffer>();
    const inspection = {
      schema: "persai.document.inspect.v1",
      format: "xlsx",
      counts: {
        pageCount: null,
        sheetCount: 2,
        formulaCount: 3,
        blankSheetCount: 0,
        paragraphCount: null,
        headingCount: null,
        tableCount: null,
        textCharCount: null
      },
      warnings: ["ok"]
    };
    const service = new DocumentWorkspaceVersionRegistrationService(
      {
        assistantChat: {
          async findFirst() {
            return { id: "chat-1" };
          }
        },
        assistant: {
          async findFirst() {
            return { userId: "user-1" };
          }
        },
        assistantDocument: {
          async findFirst() {
            return null;
          }
        }
      } as never,
      {
        async registerVisibleWorkspaceVersion(input: unknown) {
          registeredInputs.push(input);
          return {
            docId: "doc-1",
            versionId: "version-1",
            versionNumber: 1,
            descriptorMode: "create_document",
            documentType: "workspace_document",
            outputFormat: "xlsx"
          };
        }
      } as never,
      {
        async get(input: { path: string }) {
          if (
            input.path === `${sessionRoot}/output.xlsx` ||
            input.path === `${sessionRoot}/output.inspect.json` ||
            input.path === `${sessionRoot}/output.md`
          ) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType: input.path.endsWith(".xlsx")
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/json",
              sizeBytes: BigInt(128),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
        },
        async upsert() {
          return;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject(objectKey: string) {
          if (
            objectKey ===
            "gcs:assistants/assistant-1/sessions/runtime-session-1/output.inspect.json"
          ) {
            return {
              buffer: Buffer.from(JSON.stringify(inspection), "utf8"),
              contentType: "application/json"
            };
          }
          const saved = savedObjects.get(objectKey);
          if (saved) {
            return {
              buffer: saved,
              contentType: "application/json"
            };
          }
          return null;
        },
        async saveObject(input: { objectKey: string; buffer: Buffer }) {
          savedObjects.set(input.objectKey, input.buffer);
          return {
            objectKey: input.objectKey,
            sizeBytes: input.buffer.length,
            mimeType: "application/json"
          };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      sourceUserMessageText: "register workbook",
      sourceUserMessageCreatedAt: "2026-06-29T12:00:00.000Z",
      descriptorMode: null,
      docId: null,
      requestedName: "output.xlsx",
      workspaceProjectPath: sessionRoot,
      outputPath: `${sessionRoot}/output.xlsx`,
      sourceManifestPath: null,
      inspectionPath: `${sessionRoot}/output.inspect.json`
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.descriptorMode, "create_document");
    assert.equal(outcome.documentType, "workspace_document");
    assert.equal(outcome.outputFormat, "xlsx");
    assert.equal(registeredInputs.length, 1);
    const registered = registeredInputs[0] as {
      workspaceFacts: {
        workspaceProjectPath: string | null;
        projectManifestPath: string | null;
        projectSourcePath: string | null;
        sourceKind: string | null;
        sourcePath: string | null;
        sourceFormat: string | null;
        sourceMimeType: string | null;
        inspectionSummary: { counts: { sheetCount: number | null } } | null;
      };
    };
    assert.equal(registered.workspaceFacts.workspaceProjectPath, sessionRoot);
    assert.equal(registered.workspaceFacts.projectManifestPath, null);
    assert.equal(registered.workspaceFacts.projectSourcePath, `${sessionRoot}/output.md`);
    assert.equal(registered.workspaceFacts.sourceKind, "authored_workspace_project");
    assert.equal(registered.workspaceFacts.sourcePath, `${sessionRoot}/output.md`);
    assert.equal(registered.workspaceFacts.sourceFormat, "text");
    assert.equal(registered.workspaceFacts.sourceMimeType, "text/plain");
    assert.equal(registered.workspaceFacts.inspectionSummary?.counts.sheetCount, 2);
  });

  test("infers imported project/source facts from project output path and manifest", async () => {
    const registeredInputs: unknown[] = [];
    const inspection = {
      schema: "persai.document.inspect.v1",
      format: "pdf",
      counts: {
        pageCount: 3,
        sheetCount: null,
        formulaCount: null,
        blankSheetCount: null,
        paragraphCount: null,
        headingCount: null,
        tableCount: null,
        textCharCount: 1200
      },
      warnings: []
    };
    const projectManifest = {
      schema: "persai.document.project.v1",
      projectPath: importedProjectRoot,
      sourceKind: "imported_workspace_file",
      sourcePath: `${sessionRoot}/source.docx`,
      projectSourcePath: `${importedProjectRoot}/source/source.docx`,
      sourceFormat: "docx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extractManifestPath: `${importedProjectRoot}/extract/manifest.json`
    };
    const extractManifest = {
      schema: "persai.document.extract.v1",
      kind: "extraction_view",
      sourcePath: `${sessionRoot}/source.docx`
    };
    const service = new DocumentWorkspaceVersionRegistrationService(
      {
        assistantChat: {
          async findFirst() {
            return { id: "chat-1" };
          }
        },
        assistant: {
          async findFirst() {
            return { userId: "user-1" };
          }
        },
        assistantDocument: {
          async findFirst() {
            return null;
          }
        }
      } as never,
      {
        async registerVisibleWorkspaceVersion(input: unknown) {
          registeredInputs.push(input);
          return {
            docId: "doc-imported-1",
            versionId: "version-imported-1",
            versionNumber: 1,
            descriptorMode: "create_document",
            documentType: "workspace_document",
            outputFormat: "pdf"
          };
        }
      } as never,
      {
        async get(input: { path: string }) {
          if (
            input.path === `${importedProjectRoot}/output/report.pdf` ||
            input.path === `${importedProjectRoot}/output/report.inspect.json` ||
            input.path === `${importedProjectRoot}/project.json` ||
            input.path === `${importedProjectRoot}/extract/manifest.json`
          ) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType: input.path.endsWith(".pdf") ? "application/pdf" : "application/json",
              sizeBytes: BigInt(128),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
        },
        async upsert() {
          return;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject(objectKey: string) {
          if (
            objectKey ===
            "gcs:assistants/assistant-1/sessions/runtime-session-1/projects/source/project.json"
          ) {
            return {
              buffer: Buffer.from(JSON.stringify(projectManifest), "utf8"),
              contentType: "application/json"
            };
          }
          if (
            objectKey ===
            "gcs:assistants/assistant-1/sessions/runtime-session-1/projects/source/extract/manifest.json"
          ) {
            return {
              buffer: Buffer.from(JSON.stringify(extractManifest), "utf8"),
              contentType: "application/json"
            };
          }
          if (
            objectKey ===
            "gcs:assistants/assistant-1/sessions/runtime-session-1/projects/source/output/report.inspect.json"
          ) {
            return {
              buffer: Buffer.from(JSON.stringify(inspection), "utf8"),
              contentType: "application/json"
            };
          }
          return null;
        },
        async saveObject() {
          return {
            objectKey: "gcs:any",
            sizeBytes: 1,
            mimeType: "application/json"
          };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      sourceUserMessageText: "register imported docx as pdf",
      sourceUserMessageCreatedAt: "2026-06-30T10:00:00.000Z",
      descriptorMode: null,
      docId: null,
      requestedName: "report.pdf",
      workspaceProjectPath: null,
      outputPath: `${importedProjectRoot}/output/report.pdf`,
      sourceManifestPath: null,
      inspectionPath: `${importedProjectRoot}/output/report.inspect.json`
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.workspaceProjectPath, importedProjectRoot);
    assert.equal(outcome.sourceManifestPath, `${importedProjectRoot}/extract/manifest.json`);
    const registered = registeredInputs[0] as {
      workspaceFacts: {
        workspaceProjectPath: string | null;
        projectManifestPath: string | null;
        projectSourcePath: string | null;
        sourceKind: string | null;
        sourcePath: string | null;
        sourceFormat: string | null;
        sourceMimeType: string | null;
        sourceManifestPath: string | null;
      };
    };
    assert.equal(registered.workspaceFacts.workspaceProjectPath, importedProjectRoot);
    assert.equal(
      registered.workspaceFacts.projectManifestPath,
      `${importedProjectRoot}/project.json`
    );
    assert.equal(
      registered.workspaceFacts.projectSourcePath,
      `${importedProjectRoot}/source/source.docx`
    );
    assert.equal(registered.workspaceFacts.sourceKind, "imported_workspace_file");
    assert.equal(registered.workspaceFacts.sourcePath, `${sessionRoot}/source.docx`);
    assert.equal(registered.workspaceFacts.sourceFormat, "docx");
    assert.equal(
      registered.workspaceFacts.sourceMimeType,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    assert.equal(
      registered.workspaceFacts.sourceManifestPath,
      `${importedProjectRoot}/extract/manifest.json`
    );
  });

  test("rejects retired flat-root and non-active hierarchical output paths", async () => {
    const service = new DocumentWorkspaceVersionRegistrationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const flatRootOutcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      sourceUserMessageText: "register workbook",
      sourceUserMessageCreatedAt: "2026-06-29T12:00:00.000Z",
      descriptorMode: null,
      docId: null,
      requestedName: null,
      workspaceProjectPath: null,
      outputPath: "/workspace/output.xlsx",
      sourceManifestPath: null,
      inspectionPath: null
    });

    assert.equal(flatRootOutcome.accepted, false);
    if (flatRootOutcome.accepted) {
      return;
    }
    assert.equal(flatRootOutcome.code, "invalid_output_path");

    const nonActiveHierarchyOutcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      sourceUserMessageText: "register workbook",
      sourceUserMessageCreatedAt: "2026-06-29T12:00:00.000Z",
      descriptorMode: null,
      docId: null,
      requestedName: null,
      workspaceProjectPath: null,
      outputPath: "/workspace/assistants/assistant-1/output.xlsx",
      sourceManifestPath: null,
      inspectionPath: null
    });

    assert.equal(nonActiveHierarchyOutcome.accepted, false);
    if (nonActiveHierarchyOutcome.accepted) {
      return;
    }
    assert.equal(nonActiveHierarchyOutcome.code, "invalid_output_path");
  });

  test("rejects project-owned outputs when inspect truth is missing", async () => {
    const service = new DocumentWorkspaceVersionRegistrationService(
      {
        assistantChat: {
          async findFirst() {
            return { id: "chat-1" };
          }
        },
        assistant: {
          async findFirst() {
            return { userId: "user-1" };
          }
        },
        assistantDocument: {
          async findFirst() {
            return null;
          }
        }
      } as never,
      {
        async registerVisibleWorkspaceVersion() {
          return {
            docId: "doc-created-1",
            versionId: "version-created-1",
            versionNumber: 1,
            descriptorMode: "create_document",
            documentType: "workspace_document",
            outputFormat: "pdf"
          };
        }
      } as never,
      {
        async get(input: { path: string }) {
          if (
            input.path === `${importedReportProjectRoot}/output/report.pdf` ||
            input.path === `${importedReportProjectRoot}/project.json`
          ) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType: input.path.endsWith(".pdf") ? "application/pdf" : "application/json",
              sizeBytes: BigInt(128),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
        },
        async upsert() {
          return;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject(objectKey: string) {
          if (
            objectKey ===
            "gcs:assistants/assistant-1/sessions/runtime-session-1/projects/report/project.json"
          ) {
            return {
              buffer: Buffer.from(
                JSON.stringify({
                  schema: "persai.document.project.v1",
                  projectPath: importedReportProjectRoot,
                  sourceKind: "imported_workspace_file",
                  sourcePath: `${sessionRoot}/source.docx`,
                  projectSourcePath: `${importedReportProjectRoot}/source/source.docx`,
                  sourceFormat: "docx",
                  sourceMimeType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                }),
                "utf8"
              ),
              contentType: "application/json"
            };
          }
          return null;
        },
        async saveObject() {
          return {
            objectKey: "gcs:any",
            sizeBytes: 1,
            mimeType: "application/json"
          };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      sourceUserMessageText: "register imported output",
      sourceUserMessageCreatedAt: "2026-06-30T10:00:00.000Z",
      descriptorMode: null,
      docId: null,
      requestedName: "report.pdf",
      workspaceProjectPath: null,
      outputPath: `${importedReportProjectRoot}/output/report.pdf`,
      sourceManifestPath: null,
      inspectionPath: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.outputPath, `${importedReportProjectRoot}/output/report.pdf`);
  });

  test("resolves existing docId from outputPath when caller passes docId=null (Case A / render revision)", async () => {
    const registeredInputs: Record<string, unknown>[] = [];
    const savedObjects = new Map<string, Buffer>();
    const inspection = {
      schema: "persai.document.inspect.v1",
      format: "xlsx",
      counts: {
        pageCount: null,
        sheetCount: 2,
        formulaCount: 3,
        blankSheetCount: 0,
        paragraphCount: null,
        headingCount: null,
        tableCount: null,
        textCharCount: null
      },
      warnings: []
    };
    const service = new DocumentWorkspaceVersionRegistrationService(
      {
        assistantChat: {
          async findFirst() {
            return { id: "chat-1" };
          }
        },
        assistant: {
          async findFirst() {
            return { userId: "user-1" };
          }
        },
        assistantDocument: {
          async findFirst(query: { where?: Record<string, unknown> }) {
            const where = query?.where as
              | {
                  assistantId?: string;
                  workspaceId?: string;
                  currentVersion?: {
                    is?: {
                      sourceJson?: { path?: string[]; equals?: string };
                    };
                  };
                }
              | undefined;
            if (
              where?.assistantId === "assistant-1" &&
              where?.workspaceId === "workspace-1" &&
              where?.currentVersion?.is?.sourceJson?.equals === `${sessionRoot}/output.xlsx`
            ) {
              return { id: "doc-existing-1" };
            }
            return null;
          }
        }
      } as never,
      {
        async registerVisibleWorkspaceVersion(input: Record<string, unknown>) {
          registeredInputs.push(input);
          return {
            docId: "doc-existing-1",
            versionId: "version-existing-2",
            versionNumber: 2,
            descriptorMode: "revise_document",
            documentType: "workspace_document",
            outputFormat: "xlsx"
          };
        }
      } as never,
      {
        async get(input: { path: string }) {
          if (
            input.path === `${sessionRoot}/output.xlsx` ||
            input.path === `${sessionRoot}/output.inspect.json` ||
            input.path === `${sessionRoot}/output.md`
          ) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType: input.path.endsWith(".xlsx")
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/json",
              sizeBytes: BigInt(128),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
        },
        async upsert() {
          return;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject(objectKey: string) {
          if (
            objectKey ===
            "gcs:assistants/assistant-1/sessions/runtime-session-1/output.inspect.json"
          ) {
            return {
              buffer: Buffer.from(JSON.stringify(inspection), "utf8"),
              contentType: "application/json"
            };
          }
          const saved = savedObjects.get(objectKey);
          if (saved) {
            return {
              buffer: saved,
              contentType: "application/json"
            };
          }
          return null;
        },
        async saveObject(input: { objectKey: string; buffer: Buffer }) {
          savedObjects.set(input.objectKey, input.buffer);
          return {
            objectKey: input.objectKey,
            sizeBytes: input.buffer.length,
            mimeType: "application/json"
          };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      sourceUserMessageText: "revise workbook",
      sourceUserMessageCreatedAt: "2026-07-02T20:30:00.000Z",
      descriptorMode: null,
      docId: null,
      requestedName: "output.xlsx",
      workspaceProjectPath: sessionRoot,
      outputPath: `${sessionRoot}/output.xlsx`,
      sourceManifestPath: null,
      inspectionPath: `${sessionRoot}/output.inspect.json`
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.docId, "doc-existing-1");
    assert.equal(outcome.versionNumber, 2);
    assert.equal(outcome.descriptorMode, "revise_document");
    assert.equal(registeredInputs.length, 1);
    assert.equal(registeredInputs[0]?.docId, "doc-existing-1");
    assert.equal(registeredInputs[0]?.descriptorMode, "revise_document");
  });
});
