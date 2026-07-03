import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import {
  WorkspaceFileBridgeService,
  type WorkspaceBridgeContext
} from "../src/workspace-file-bridge.service";
import { buildDefaultVisibleWorkspaceRoot, WorkspacePathError } from "../src/workspace-path";

// ─── Test constants ───────────────────────────────────────────────────────────

const WS_ID = "22222222-2222-4222-a222-222222222222";
const ASST_ID = "33333333-3333-4333-a333-333333333333";
const SELF_HANDLE = "my-bot";
const OTHER_HANDLE = "sibling-bot";
const SESSION_ID = "session-1";
const DEFAULT_VISIBLE_ROOT = buildDefaultVisibleWorkspaceRoot(SELF_HANDLE, SESSION_ID);

const CTX: WorkspaceBridgeContext = {
  assistantId: ASST_ID,
  assistantHandle: SELF_HANDLE,
  siblingHandles: [OTHER_HANDLE],
  workspaceId: WS_ID,
  runtimeSessionId: SESSION_ID,
  defaultVisibleRoot: DEFAULT_VISIBLE_ROOT,
  policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
  workspaceQuotaBytes: null,
  sharedQuotaBytes: null
};

// ─── Fake factories ───────────────────────────────────────────────────────────

type ExecResponse = { exitCode: number; stdout: string; stderr: string };
type ExecCall = { shellCommand: string; stdin: Buffer | null | undefined };
type ReadFileCall = { absolutePath: string; maxBytes: number };

function makeExec(
  responses: ExecResponse[] = [],
  options: { tryHotPodResponses?: (ExecResponse | null)[]; fileReadBytes?: Buffer[] } = {}
) {
  let idx = 0;
  let tryIdx = 0;
  let readIdx = 0;
  const calls: ExecCall[] = [];
  const tryCalls: ExecCall[] = [];
  const readFileCalls: ReadFileCall[] = [];
  const tryResponses = options.tryHotPodResponses ?? [];
  const fileReadBytes = options.fileReadBytes ?? [];
  const service = {
    async execShellInSessionPod(input: {
      shellCommand: string;
      stdin?: Buffer | null;
      [k: string]: unknown;
    }): Promise<ExecResponse & { durationMs: number; execPodName: string }> {
      calls.push({ shellCommand: input.shellCommand, stdin: input.stdin });
      const resp = responses[idx++] ?? { exitCode: 0, stdout: "", stderr: "" };
      return { ...resp, durationMs: 1, execPodName: "ses-test" };
    },
    async tryExecShellInExistingSessionPod(input: {
      shellCommand: string;
      stdin?: Buffer | null;
      [k: string]: unknown;
    }): Promise<(ExecResponse & { durationMs: number; execPodName: string }) | null> {
      tryCalls.push({ shellCommand: input.shellCommand, stdin: input.stdin });
      const resp = tryResponses[tryIdx++];
      if (resp === undefined || resp === null) {
        return null;
      }
      return { ...resp, durationMs: 1, execPodName: "ses-test" };
    },
    async readWorkspaceFileFromSessionPod(input: {
      absolutePath: string;
      maxBytes: number;
      [k: string]: unknown;
    }): Promise<{ bytes: Buffer; durationMs: number; execPodName: string }> {
      readFileCalls.push({ absolutePath: input.absolutePath, maxBytes: input.maxBytes });
      const bytes = fileReadBytes[readIdx++] ?? Buffer.alloc(0);
      return { bytes, durationMs: 1, execPodName: "ses-test" };
    }
  } as never;
  return { calls, tryCalls, readFileCalls, service };
}

type SaveCall = { objectKey: string; buffer: Buffer; mimeType: string };

function makeStorage() {
  const savedObjects: SaveCall[] = [];
  const deletedPrefixes: string[] = [];
  const service = {
    buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }): string {
      return `test-media/workspaces/${input.workspaceId}${input.workspaceRelPath}`;
    },
    async saveObject(input: SaveCall): Promise<number> {
      savedObjects.push(input);
      return input.buffer.length;
    },
    async deletePrefix(prefix: string): Promise<number> {
      deletedPrefixes.push(prefix);
      return 0;
    },
    buildWorkspacePrefix(input: { workspaceId: string; subPath?: string }): string {
      return `test-media/workspaces/${input.workspaceId}/workspace/${input.subPath ?? ""}`;
    }
  } as never;
  return { savedObjects, deletedPrefixes, service };
}

type AuditOp = { op: string; status: string; reason: string | null };

function makeObs() {
  return {
    service: { recordWorkspaceFileLatency() {}, recordWorkspaceFileAttachLatency() {} } as never
  };
}

function makeAudit() {
  const ops: AuditOp[] = [];
  const service = {
    recordWorkspaceFileOp(op: string, event: { status: string; reason: string | null }): void {
      ops.push({ op, status: event.status, reason: event.reason });
    },
    recordWorkspaceFileAttached(): void {}
  } as never;
  return { ops, service };
}

function makeBridge(
  execService: ReturnType<typeof makeExec>["service"],
  storageService: ReturnType<typeof makeStorage>["service"],
  obsService: ReturnType<typeof makeObs>["service"],
  auditService: ReturnType<typeof makeAudit>["service"]
): WorkspaceFileBridgeService {
  return new WorkspaceFileBridgeService(execService, storageService, obsService, auditService);
}

// ─── workspaceFileWrite ───────────────────────────────────────────────────────

test("workspaceFileWrite: rejects root-flat /workspace/<file> before quota, pod exec, or GCS", async () => {
  const exec = makeExec();
  const storage = makeStorage();
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, storage.service, makeObs().service, audit.service);
  const result = await bridge.workspaceFileWrite(makeQuotaCtx({ workspaceQuotaBytes: 1_000 }), {
    path: "/workspace/foo.txt",
    contents: Buffer.from("hello world")
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "write_denied");
  assert.equal(result.latencyMs, 0);
  assert.deepEqual(result.data, {
    resolvedPath: "/workspace/foo.txt",
    bytes: 0
  });
  assert.equal(exec.calls.length, 0);
  assert.equal(storage.savedObjects.length, 0);
  assert.equal(audit.ops.length, 1);
  assert.deepEqual(audit.ops[0], {
    op: "write",
    status: "error",
    reason: "write_denied"
  });
});

test("workspaceFileWrite: hierarchical session-root overwrite mirrors to GCS", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "", stderr: "" }]);
  const storage = makeStorage();
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, storage.service, makeObs().service, audit.service);
  const contents = Buffer.from("hello world");

  const result = await bridge.workspaceFileWrite(CTX, {
    path: `${DEFAULT_VISIBLE_ROOT}/foo.txt`,
    contents
  });

  assert.equal(result.success, true);
  assert.equal(result.reason, null);
  assert.equal(result.data.bytes, contents.length);
  assert.equal(exec.calls.length, 2);
  assert.ok(exec.calls[1]?.shellCommand.includes(`cat > '${DEFAULT_VISIBLE_ROOT}/foo.txt'`));
  assert.ok(exec.calls[1]?.shellCommand.includes(`mkdir -p '${DEFAULT_VISIBLE_ROOT}'`));
  assert.equal(exec.calls[1]?.stdin?.toString(), "hello world");
  // Every accepted visible-workspace write mirrors to GCS — no scratch carve-out.
  assert.equal(storage.savedObjects.length, 1);
  assert.ok(storage.savedObjects[0]?.objectKey.includes(WS_ID));
  assert.equal(audit.ops.length, 2);
  assert.equal(audit.ops[1]?.status, "ok");
});

test("workspaceFileWrite: nested subdirectory under the session root mirrors to GCS too", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "", stderr: "" }]);
  const storage = makeStorage();
  const bridge = makeBridge(exec.service, storage.service, makeObs().service, makeAudit().service);
  const contents = Buffer.from("PNG_BYTES");

  const result = await bridge.workspaceFileWrite(CTX, {
    path: `${DEFAULT_VISIBLE_ROOT}/charts/foo.png`,
    contents
  });

  assert.equal(result.success, true);
  assert.equal(exec.calls.length, 2);
  assert.ok(exec.calls[1]?.shellCommand.includes("foo.png"));
  assert.equal(storage.savedObjects.length, 1);
  assert.deepEqual(storage.savedObjects[0]?.buffer, contents);
});

test("workspaceFileWrite: create_only collision (exitCode 64) → reason=create_only_collision", async () => {
  const exec = makeExec([{ exitCode: 64, stdout: "", stderr: "create_only_collision" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileWrite(CTX, {
    path: `${DEFAULT_VISIBLE_ROOT}/report.txt`,
    contents: Buffer.from("data"),
    mode: "create_only"
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "create_only_collision");
  assert.ok(exec.calls[0]?.shellCommand.includes("create_only_collision"));
  assert.equal(audit.ops[0]?.status, "error");
});

// ─── writeWorkspaceFileWithCollision ──────────────────────────────────────────

test("writeWorkspaceFileWithCollision: empty workspace dir → exact basename lands", async () => {
  const exec = makeExec([
    { exitCode: 0, stdout: "", stderr: "" },
    { exitCode: 0, stdout: "", stderr: "" }
  ]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );
  const contents = Buffer.from("%PDF-1.4");

  const result = await bridge.writeWorkspaceFileWithCollision(CTX, {
    basename: "report.pdf",
    contents,
    collisionStrategy: "numeric_suffix"
  });

  assert.equal(result.success, true);
  assert.equal(result.data.resolvedBasename, "report.pdf");
  assert.equal(result.data.workspaceRelPath, `${DEFAULT_VISIBLE_ROOT}/report.pdf`);
  assert.equal(exec.calls.length, 2);
  assert.ok(exec.calls[1]?.shellCommand.includes("report.pdf"));
});

test("writeWorkspaceFileWithCollision: report.pdf exists → report (1).pdf lands", async () => {
  const exec = makeExec([
    {
      exitCode: 0,
      stdout: `${DEFAULT_VISIBLE_ROOT}/report.pdf\tf\t100\t1700000000`,
      stderr: ""
    },
    { exitCode: 0, stdout: "", stderr: "" }
  ]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.writeWorkspaceFileWithCollision(CTX, {
    basename: "report.pdf",
    contents: Buffer.from("%PDF"),
    collisionStrategy: "numeric_suffix"
  });

  assert.equal(result.success, true);
  assert.equal(result.data.resolvedBasename, "report (1).pdf");
  assert.equal(result.data.workspaceRelPath, `${DEFAULT_VISIBLE_ROOT}/report (1).pdf`);
  assert.ok(exec.calls[1]?.shellCommand.includes("report (1).pdf"));
});

test("writeWorkspaceFileWithCollision: report.pdf and report (1).pdf exist → report (2).pdf lands", async () => {
  const exec = makeExec([
    {
      exitCode: 0,
      stdout: [
        `${DEFAULT_VISIBLE_ROOT}/report.pdf\tf\t100\t1700000000`,
        `${DEFAULT_VISIBLE_ROOT}/report (1).pdf\tf\t100\t1700000001`
      ].join("\n"),
      stderr: ""
    },
    { exitCode: 0, stdout: "", stderr: "" }
  ]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.writeWorkspaceFileWithCollision(CTX, {
    basename: "report.pdf",
    contents: Buffer.from("%PDF"),
    collisionStrategy: "numeric_suffix"
  });

  assert.equal(result.success, true);
  assert.equal(result.data.resolvedBasename, "report (2).pdf");
  assert.equal(result.data.workspaceRelPath, `${DEFAULT_VISIBLE_ROOT}/report (2).pdf`);
});

test("workspaceFileWrite: existing explicit path defaults to sibling collision suffix", async () => {
  const sessionReportPath = `${DEFAULT_VISIBLE_ROOT}/reports/report.pdf`;
  const exec = makeExec([
    {
      exitCode: 0,
      stdout: [
        `${DEFAULT_VISIBLE_ROOT}/reports/report.pdf\tf\t100\t1700000000`,
        `${DEFAULT_VISIBLE_ROOT}/reports/report (1).pdf\tf\t100\t1700000001`
      ].join("\n"),
      stderr: ""
    },
    { exitCode: 0, stdout: "", stderr: "" }
  ]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.workspaceFileWrite(CTX, {
    path: sessionReportPath,
    contents: Buffer.from("pdf")
  });

  assert.equal(result.success, true);
  assert.equal(result.data.resolvedPath, `${DEFAULT_VISIBLE_ROOT}/reports/report (2).pdf`);
  assert.ok(
    exec.calls[1]?.shellCommand.includes(`cat > '${DEFAULT_VISIBLE_ROOT}/reports/report (2).pdf'`)
  );
});

test("workspaceFileWrite: replace=true overwrites exact explicit path", async () => {
  const sessionReportPath = `${DEFAULT_VISIBLE_ROOT}/reports/report.pdf`;
  const exec = makeExec([{ exitCode: 0, stdout: "", stderr: "" }]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.workspaceFileWrite(CTX, {
    path: sessionReportPath,
    contents: Buffer.from("pdf"),
    replace: true
  });

  assert.equal(result.success, true);
  assert.equal(result.data.resolvedPath, sessionReportPath);
  assert.equal(exec.calls.length, 1);
  assert.ok(exec.calls[0]?.shellCommand.includes(`cat > '${sessionReportPath}'`));
});

test("workspaceFileWrite: explicit path without extension allocates suffix and respects trailing (N)", async () => {
  const sessionReportStem = `${DEFAULT_VISIBLE_ROOT}/notes/report`;
  const exec = makeExec([
    {
      exitCode: 0,
      stdout: [
        `${DEFAULT_VISIBLE_ROOT}/notes/report\tf\t100\t1700000000`,
        `${DEFAULT_VISIBLE_ROOT}/notes/report (1)\tf\t100\t1700000001`,
        `${DEFAULT_VISIBLE_ROOT}/notes/report (2)\tf\t100\t1700000002`
      ].join("\n"),
      stderr: ""
    },
    { exitCode: 0, stdout: "", stderr: "" }
  ]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.workspaceFileWrite(CTX, {
    path: `${sessionReportStem} (2)`,
    contents: Buffer.from("note")
  });

  assert.equal(result.success, true);
  assert.equal(result.data.resolvedPath, `${sessionReportStem} (3)`);
  assert.ok(exec.calls[1]?.shellCommand.includes(`cat > '${sessionReportStem} (3)'`));
});

// ─── workspaceFileRead ────────────────────────────────────────────────────────

test("workspaceFileRead: successful read returns decoded bytes and truncated=false", async () => {
  const content = "hello sandbox";
  const b64 = Buffer.from(content).toString("base64");
  const exec = makeExec([{ exitCode: 0, stdout: `${b64}\n`, stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileRead(CTX, { path: "/workspace/data.txt" });

  assert.equal(result.success, true);
  assert.ok(result.data !== null);
  assert.equal(result.data?.bytes.toString(), content);
  assert.equal(result.data?.truncated, false);
  assert.equal(audit.ops[0]?.status, "ok");
});

test("workspaceFileRead: file missing (exitCode 65) → success=false, reason=path_not_found", async () => {
  const exec = makeExec([{ exitCode: 65, stdout: "", stderr: "path_not_found" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileRead(CTX, { path: "/workspace/missing.txt" });

  assert.equal(result.success, false);
  assert.equal(result.reason, "path_not_found");
  assert.equal(result.data, null);
  assert.equal(audit.ops[0]?.status, "error");
  assert.equal(audit.ops[0]?.reason, "path_not_found");
});

test("workspaceFileRead: TRUNCATED marker in stdout → truncated=true", async () => {
  const b64 = Buffer.from("partial content").toString("base64");
  const exec = makeExec([{ exitCode: 0, stdout: `${b64}\nTRUNCATED`, stderr: "" }]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.workspaceFileRead(CTX, { path: "/workspace/big.bin" });

  assert.equal(result.success, true);
  assert.equal(result.data?.truncated, true);
  assert.equal(result.data?.bytes.toString(), "partial content");
});

// ─── workspaceFileList ────────────────────────────────────────────────────────

test("workspaceFileList: directory exists → parses tab-separated entries", async () => {
  const mtime = 1700000000;
  const raw = [
    `/workspace/file.txt\tf\t512\t${mtime}`,
    `/workspace/subdir\td\t4096\t${mtime}`
  ].join("\n");
  const exec = makeExec([{ exitCode: 0, stdout: raw, stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileList(CTX, { path: "/workspace" });

  assert.equal(result.success, true);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0]?.type, "file");
  assert.equal(result.data[0]?.sizeBytes, 512);
  assert.equal(result.data[0]?.modifiedAt, new Date(mtime * 1000).toISOString());
  assert.equal(result.data[1]?.type, "directory");
  assert.equal(audit.ops[0]?.status, "ok");
});

test("workspaceFileList: directory missing (exitCode 65) → success=false, reason=path_not_found, data=[]", async () => {
  const exec = makeExec([{ exitCode: 65, stdout: "", stderr: "path_not_found" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileList(CTX, { path: "/workspace/no-such-dir" });

  assert.equal(result.success, false);
  assert.equal(result.reason, "path_not_found");
  assert.deepEqual(result.data, []);
  assert.equal(audit.ops[0]?.status, "error");
});

// ─── workspaceFileStat ────────────────────────────────────────────────────────

test("workspaceFileStat: file exists → type=file, sizeBytes, modifiedAt", async () => {
  const mtime = 1700000000;
  const exec = makeExec([{ exitCode: 0, stdout: `file\n1024\n${mtime}\n`, stderr: "" }]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.workspaceFileStat(CTX, { path: "/workspace/out.csv" });

  assert.equal(result.success, true);
  assert.equal(result.data.type, "file");
  assert.equal(result.data.sizeBytes, 1024);
  assert.equal(result.data.modifiedAt, new Date(mtime * 1000).toISOString());
});

test("workspaceFileStat: missing path → type=missing, sizeBytes=0, modifiedAt=null", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "missing\n", stderr: "" }]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.workspaceFileStat(CTX, { path: "/workspace/ghost.txt" });

  assert.equal(result.success, true);
  assert.equal(result.data.type, "missing");
  assert.equal(result.data.sizeBytes, 0);
  assert.equal(result.data.modifiedAt, null);
});

// ─── workspaceFileDelete ──────────────────────────────────────────────────────

test("workspaceFileDelete: successful delete → exec called, removed=true, audit ok", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "", stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileDelete(CTX, { path: "/workspace/report.txt" });

  assert.equal(result.success, true);
  assert.equal(result.data.removed, true);
  assert.equal(exec.calls.length, 1);
  assert.ok(exec.calls[0]?.shellCommand.includes("rm"));
  assert.equal(audit.ops[0]?.status, "ok");
});

test("workspaceFileDelete: visible /workspace path remains deletable when explicitly addressed", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "", stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileDelete(CTX, {
    path: "/workspace/upload.csv"
  });

  assert.equal(result.success, true);
  assert.equal(result.data.removed, true);
  assert.equal(exec.calls.length, 1);
  assert.equal(audit.ops[0]?.status, "ok");
});

test("workspaceFileDelete: path outside /workspace → WorkspacePathError", async () => {
  const exec = makeExec();
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  await assert.rejects(
    () => bridge.workspaceFileDelete(CTX, { path: "/tmp/foo.txt" }),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_allowed_mount"
  );
  assert.equal(exec.calls.length, 0);
});

// ─── Quota enforcement ────────────────────────────────────────────────────────

function makeQuotaCtx(
  overrides: Partial<Pick<WorkspaceBridgeContext, "workspaceQuotaBytes" | "sharedQuotaBytes">> = {}
): WorkspaceBridgeContext {
  return {
    ...CTX,
    ...overrides
  };
}

test("workspaceFileWrite: quota cap exceeded via workspaceQuotaBytes → workspace_quota_exhausted", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "1000\n", stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("x".repeat(100));

  const result = await bridge.workspaceFileWrite(makeQuotaCtx({ workspaceQuotaBytes: 1000 }), {
    path: `${DEFAULT_VISIBLE_ROOT}/big.bin`,
    contents
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "workspace_quota_exhausted");
  assert.equal(exec.calls.length, 1);
  assert.ok(exec.calls[0]?.shellCommand.includes("du -sb '/workspace/'"));
  assert.equal(audit.ops[0]?.status, "error");
  assert.equal(audit.ops[0]?.reason, "workspace_quota_exhausted");
});

test("workspaceFileWrite: quota cap exceeded via sharedQuotaBytes → workspace_quota_exhausted", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "900\n", stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("y".repeat(200));

  const result = await bridge.workspaceFileWrite(makeQuotaCtx({ sharedQuotaBytes: 1000 }), {
    path: `${DEFAULT_VISIBLE_ROOT}/out.csv`,
    contents
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "workspace_quota_exhausted");
  assert.equal(exec.calls.length, 1);
  assert.ok(exec.calls[0]?.shellCommand.includes("du -sb '/workspace/'"));
  assert.equal(audit.ops[0]?.reason, "workspace_quota_exhausted");
});

test("workspaceFileWrite: cap null → write proceeds without du", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "", stderr: "" }]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.workspaceFileWrite(makeQuotaCtx(), {
    path: `${DEFAULT_VISIBLE_ROOT}/foo.txt`,
    contents: Buffer.from("ok")
  });

  assert.equal(result.success, true);
  assert.equal(exec.calls.length, 2);
  assert.ok(!exec.calls[0]?.shellCommand.includes("du -sb"));
});

test("workspaceFileWrite: current + new under cap → write proceeds", async () => {
  const exec = makeExec([
    { exitCode: 0, stdout: "100\n", stderr: "" },
    { exitCode: 0, stdout: "", stderr: "" }
  ]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.workspaceFileWrite(makeQuotaCtx({ workspaceQuotaBytes: 1000 }), {
    path: `${DEFAULT_VISIBLE_ROOT}/small.txt`,
    contents: Buffer.from("fits")
  });

  assert.equal(result.success, true);
  assert.equal(exec.calls.length, 3);
  assert.ok(exec.calls[0]?.shellCommand.includes("du -sb"));
  assert.ok(exec.calls[2]?.shellCommand.includes("cat >"));
});

test("writeWorkspaceFileWithCollision: cap exceeded → workspace_quota_exhausted", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "900\n", stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("y".repeat(200));

  const result = await bridge.writeWorkspaceFileWithCollision(
    makeQuotaCtx({ sharedQuotaBytes: 1000 }),
    {
      basename: "artefact.bin",
      contents,
      collisionStrategy: "overwrite"
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.reason, "workspace_quota_exhausted");
  assert.equal(audit.ops.at(-1)?.reason, "workspace_quota_exhausted");
});

// ─── path traversal ───────────────────────────────────────────────────────────

test("workspaceFileWrite: path traversal /workspace/../etc/passwd → throws WorkspacePathError", async () => {
  const exec = makeExec();
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  await assert.rejects(
    () =>
      bridge.workspaceFileWrite(CTX, {
        path: "/workspace/../etc/passwd",
        contents: Buffer.from("bad")
      }),
    (e: unknown) => e instanceof WorkspacePathError && e.code === "outside_allowed_mount"
  );
  assert.equal(exec.calls.length, 0);
});

// ─── workspaceFileCopy ────────────────────────────────────────────────────────

test("workspaceFileCopy: /workspace/<src> → /workspace/<dst> success (cp + GCS mirror)", async () => {
  const fileBytes = Buffer.from("attach-me");
  const exec = makeExec([
    { exitCode: 0, stdout: "", stderr: "" },
    {
      exitCode: 0,
      stdout: `${fileBytes.toString("base64")}\n`,
      stderr: ""
    }
  ]);
  const storage = makeStorage();
  const bridge = makeBridge(exec.service, storage.service, makeObs().service, makeAudit().service);

  const result = await bridge.workspaceFileCopy(CTX, {
    sourcePath: "/workspace/report.csv",
    targetPath: "/workspace/report-copy.csv"
  });

  assert.equal(result.success, true);
  assert.equal(result.data.bytes, fileBytes.length);
  assert.equal(storage.savedObjects.length, 1);
  assert.ok(exec.calls[0]?.shellCommand.includes("cp -f"));
});

test("workspaceFileCopy: same path no-op stats and returns success", async () => {
  const exec = makeExec([
    {
      exitCode: 0,
      stdout: "file\n1024\n1710000000\n",
      stderr: ""
    }
  ]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const path = "/workspace/report.csv";
  const result = await bridge.workspaceFileCopy(CTX, {
    sourcePath: path,
    targetPath: path
  });

  assert.equal(result.success, true);
  assert.equal(result.data.sourcePath, path);
  assert.equal(result.data.targetPath, path);
  assert.equal(exec.calls.length, 1);
});

test("workspaceFileCopy: copying out of /workspace rejected", async () => {
  const bridge = makeBridge(
    makeExec().service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  await assert.rejects(
    () =>
      bridge.workspaceFileCopy(CTX, {
        sourcePath: "/workspace/sales.csv",
        targetPath: "/tmp/exfiltrated.csv"
      }),
    (e: unknown) => e instanceof WorkspacePathError
  );
});

test("workspaceFileCopy: source outside /workspace rejected", async () => {
  const bridge = makeBridge(
    makeExec().service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  await assert.rejects(
    () =>
      bridge.workspaceFileCopy(CTX, {
        sourcePath: "/etc/secret.txt",
        targetPath: "/workspace/secret.txt"
      }),
    (e: unknown) => e instanceof WorkspacePathError
  );
});

// ─── workspaceFilePersist ─────────────────────────────────────────────────────

test("workspaceFilePersist: exec-created /workspace file is mirrored to GCS for delivery", async () => {
  const fileBytes = Buffer.alloc(200 * 1024, 7);
  const exec = makeExec([], { fileReadBytes: [fileBytes] });
  const storage = makeStorage();
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, storage.service, makeObs().service, audit.service);

  const result = await bridge.workspaceFilePersist(CTX, {
    path: "/workspace/thumb.jpg",
    mimeType: "image/jpeg"
  });

  assert.equal(result.success, true);
  assert.equal(result.reason, null);
  assert.equal(result.data.bytes, fileBytes.length);
  assert.equal(storage.savedObjects.length, 1);
  assert.ok(storage.savedObjects[0]?.objectKey.includes(`${WS_ID}/workspace/thumb.jpg`));
  assert.equal(storage.savedObjects[0]?.buffer.length, fileBytes.length);
  assert.equal(storage.savedObjects[0]?.mimeType, "image/jpeg");
  assert.equal(exec.calls.length, 0);
  assert.equal(exec.readFileCalls.length, 1);
  assert.equal(exec.readFileCalls[0]?.absolutePath, "/workspace/thumb.jpg");
  assert.equal(exec.readFileCalls[0]?.maxBytes, CTX.policy.telegramMaxOutboundBytes);
});

// ─── writeWorkspaceFileControlPlane ───────────────────────────────────────────
//
// Hot-pod inbound bytes-push for the session-root workspace. Called by api
// `manage-chat-media.stageForWebThread` right after the GCS upload so the
// running pod sees the file immediately instead of only after the next cold
// hydrate.

test("writeWorkspaceFileControlPlane: pod Running → cat into the session root with mode=written", async () => {
  const exec = makeExec([], {
    tryHotPodResponses: [{ exitCode: 0, stdout: "", stderr: "" }]
  });
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("upload payload");

  const result = await bridge.writeWorkspaceFileControlPlane(CTX, {
    basename: "3470.png",
    contents
  });

  assert.equal(result.success, true);
  assert.equal(result.reason, null);
  assert.equal(result.data.mode, "written");
  assert.equal(result.data.workspaceRelPath, `${DEFAULT_VISIBLE_ROOT}/3470.png`);
  assert.equal(result.data.absolutePath, `${DEFAULT_VISIBLE_ROOT}/3470.png`);
  assert.equal(result.data.bytes, contents.length);
  assert.equal(exec.tryCalls.length, 1);
  const shell = exec.tryCalls[0]?.shellCommand ?? "";
  assert.ok(shell.includes(`mkdir -p '${DEFAULT_VISIBLE_ROOT}'`), shell);
  assert.ok(shell.includes(`cat > '${DEFAULT_VISIBLE_ROOT}/3470.png'`), shell);
  assert.equal(exec.tryCalls[0]?.stdin?.toString(), "upload payload");
  // execShellInSessionPod must NOT have been called: control-plane writes
  // must never trigger cold-pod bootstrap, only push into already-warm pods.
  assert.equal(exec.calls.length, 0);
  assert.equal(audit.ops.at(-1)?.status, "ok");
});

test("writeWorkspaceFileControlPlane: rejects flat /workspace/<file> explicit paths", async () => {
  const bridge = makeBridge(
    makeExec().service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.writeWorkspaceFileControlPlane(CTX, {
    basename: "flat.txt",
    path: "/workspace/flat.txt",
    contents: Buffer.from("payload")
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "write_denied");
});

test("writeWorkspaceFileControlPlane: explicit path uses required workspace writer", async () => {
  const extractedPath = `${DEFAULT_VISIBLE_ROOT}/source.extract/extracted.md`;
  const exec = makeExec([{ exitCode: 0, stdout: "", stderr: "" }], {
    tryHotPodResponses: [{ exitCode: 1, stdout: "", stderr: "should not be used" }]
  });
  const audit = makeAudit();
  const storage = makeStorage();
  const bridge = makeBridge(exec.service, storage.service, makeObs().service, audit.service);
  const contents = Buffer.from("# Extracted\n\nBody");

  const result = await bridge.writeWorkspaceFileControlPlane(CTX, {
    basename: "extracted.md",
    path: extractedPath,
    contents
  });

  assert.equal(result.success, true);
  assert.equal(result.reason, null);
  assert.equal(result.data.mode, "written");
  assert.equal(result.data.workspaceRelPath, extractedPath);
  assert.equal(result.data.absolutePath, extractedPath);
  assert.equal(result.data.bytes, contents.length);
  assert.equal(exec.tryCalls.length, 0);
  assert.equal(exec.calls.length, 2);
  assert.ok(exec.calls[1]?.shellCommand.includes(`cat > '${extractedPath}'`));
  assert.equal(exec.calls[1]?.stdin?.toString(), contents.toString());
  assert.equal(audit.ops.at(-1)?.status, "ok");
  assert.equal(storage.savedObjects.length, 1);
  assert.ok(storage.savedObjects[0]?.objectKey.includes(`${WS_ID}${extractedPath}`));
});

test("writeWorkspaceFileControlPlane: explicit path defaults to sibling collision suffix", async () => {
  const extractedPath = `${DEFAULT_VISIBLE_ROOT}/source.extract/extracted.md`;
  const exec = makeExec([
    {
      exitCode: 0,
      stdout: `${extractedPath}\tf\t18\t1700000000`,
      stderr: ""
    },
    { exitCode: 0, stdout: "", stderr: "" }
  ]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.writeWorkspaceFileControlPlane(CTX, {
    basename: "extracted.md",
    path: extractedPath,
    contents: Buffer.from("# Extracted\n\nBody")
  });

  assert.equal(result.success, true);
  assert.equal(
    result.data.workspaceRelPath,
    `${DEFAULT_VISIBLE_ROOT}/source.extract/extracted (1).md`
  );
  assert.ok(
    exec.calls[1]?.shellCommand.includes(
      `cat > '${DEFAULT_VISIBLE_ROOT}/source.extract/extracted (1).md'`
    )
  );
});

test("writeWorkspaceFileControlPlane: explicit path replace=true keeps exact path", async () => {
  const extractedPath = `${DEFAULT_VISIBLE_ROOT}/source.extract/extracted.md`;
  const exec = makeExec([{ exitCode: 0, stdout: "", stderr: "" }]);
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.writeWorkspaceFileControlPlane(CTX, {
    basename: "extracted.md",
    path: extractedPath,
    contents: Buffer.from("# Extracted\n\nBody"),
    replace: true
  });

  assert.equal(result.success, true);
  assert.equal(result.data.workspaceRelPath, extractedPath);
  assert.equal(exec.calls.length, 1);
});

test("writeWorkspaceFileControlPlane: no Running pod → success with mode=deferred and no exec call", async () => {
  const exec = makeExec([], { tryHotPodResponses: [null] });
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("payload");

  const result = await bridge.writeWorkspaceFileControlPlane(CTX, {
    basename: "deferred.bin",
    contents
  });

  assert.equal(result.success, true);
  assert.equal(result.reason, null);
  assert.equal(result.data.mode, "deferred");
  assert.equal(result.data.bytes, contents.length);
  assert.equal(exec.calls.length, 0);
  assert.equal(audit.ops.at(-1)?.status, "ok");
});

test("writeWorkspaceFileControlPlane: pod exec fails → success=false with reason=write_failed", async () => {
  const exec = makeExec([], {
    tryHotPodResponses: [{ exitCode: 1, stdout: "", stderr: "boom" }]
  });
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("payload");

  const result = await bridge.writeWorkspaceFileControlPlane(CTX, {
    basename: "broken.bin",
    contents
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "write_failed");
  assert.equal(result.data.mode, "written");
  assert.equal(audit.ops.at(-1)?.status, "error");
  assert.equal(audit.ops.at(-1)?.reason, "write_failed");
});

test("writeWorkspaceFileControlPlane: rejects basenames with path separators (defence-in-depth)", async () => {
  const exec = makeExec();
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  for (const evilBasename of ["../escape.png", "sub/dir.png", "", ".", "..", "\u0000nul"]) {
    const result = await bridge.writeWorkspaceFileControlPlane(CTX, {
      basename: evilBasename,
      contents: Buffer.from("x")
    });
    assert.equal(result.success, false, `basename=${JSON.stringify(evilBasename)}`);
    assert.equal(result.reason, "write_denied");
  }
  assert.equal(exec.tryCalls.length, 0);
  assert.equal(exec.calls.length, 0);
});
