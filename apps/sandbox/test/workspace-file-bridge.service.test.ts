import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import {
  WorkspaceFileBridgeService,
  type WorkspaceBridgeContext
} from "../src/workspace-file-bridge.service";
import { WorkspacePathError } from "../src/workspace-path";

// ─── Test constants ───────────────────────────────────────────────────────────

const WS_ID = "22222222-2222-4222-a222-222222222222";
const ASST_ID = "33333333-3333-4333-a333-333333333333";
const SELF_HANDLE = "my-bot";
const OTHER_HANDLE = "sibling-bot";

const CTX: WorkspaceBridgeContext = {
  assistantId: ASST_ID,
  assistantHandle: SELF_HANDLE,
  siblingHandles: [OTHER_HANDLE],
  workspaceId: WS_ID,
  policy: { ...DEFAULT_RUNTIME_SANDBOX_POLICY, enabled: true },
  workspaceQuotaBytes: null,
  sharedQuotaBytes: null
};

// ─── Fake factories ───────────────────────────────────────────────────────────

type ExecResponse = { exitCode: number; stdout: string; stderr: string };
type ExecCall = { shellCommand: string; stdin: Buffer | null | undefined };

function makeExec(
  responses: ExecResponse[] = [],
  options: { tryHotPodResponses?: (ExecResponse | null)[] } = {}
) {
  let idx = 0;
  let tryIdx = 0;
  const calls: ExecCall[] = [];
  const tryCalls: ExecCall[] = [];
  const tryResponses = options.tryHotPodResponses ?? [];
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
    }
  } as never;
  return { calls, tryCalls, service };
}

type SaveCall = { objectKey: string; buffer: Buffer; mimeType: string };

function makeStorage() {
  const savedObjects: SaveCall[] = [];
  const deletedPrefixes: string[] = [];
  const service = {
    buildSharedObjectKey(input: { workspaceId: string; workspaceRelPath: string }): string {
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
    buildSharedPrefix(input: { workspaceId: string; subPath?: string }): string {
      return `test-media/workspaces/${input.workspaceId}/shared/${input.subPath ?? ""}`;
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

test("workspaceFileWrite: successful overwrite to /workspace/foo.txt", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "", stderr: "" }]);
  const storage = makeStorage();
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, storage.service, makeObs().service, audit.service);
  const contents = Buffer.from("hello world");

  const result = await bridge.workspaceFileWrite(CTX, { path: "/workspace/foo.txt", contents });

  assert.equal(result.success, true);
  assert.equal(result.reason, null);
  assert.equal(result.data.bytes, contents.length);
  assert.equal(exec.calls.length, 1);
  assert.ok(exec.calls[0]?.shellCommand.includes("cat > '/workspace/foo.txt'"));
  assert.ok(exec.calls[0]?.shellCommand.includes("mkdir -p '/workspace'"));
  assert.equal(exec.calls[0]?.stdin?.toString(), "hello world");
  // /workspace is not shared → no GCS mirror
  assert.equal(storage.savedObjects.length, 0);
  assert.equal(audit.ops.length, 1);
  assert.equal(audit.ops[0]?.status, "ok");
});

test("workspaceFileWrite: create_only collision (exitCode 64) → reason=create_only_collision", async () => {
  const exec = makeExec([{ exitCode: 64, stdout: "", stderr: "create_only_collision" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileWrite(CTX, {
    path: "/workspace/report.txt",
    contents: Buffer.from("data"),
    mode: "create_only"
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "create_only_collision");
  // create_only flag must appear in the shell command
  assert.ok(exec.calls[0]?.shellCommand.includes("create_only_collision"));
  assert.equal(audit.ops[0]?.status, "error");
});

test("workspaceFileWrite: shared/input path → write_denied, exec NOT called", async () => {
  const exec = makeExec();
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileWrite(CTX, {
    path: `/shared/${WS_ID}/input/upload.csv`,
    contents: Buffer.from("x")
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "write_denied");
  assert.equal(exec.calls.length, 0);
  assert.equal(audit.ops[0]?.status, "error");
  assert.equal(audit.ops[0]?.reason, "write_denied");
});

test("workspaceFileWrite: sibling outbound path → write_denied, exec NOT called", async () => {
  const exec = makeExec();
  const bridge = makeBridge(
    exec.service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  const result = await bridge.workspaceFileWrite(CTX, {
    path: `/shared/${WS_ID}/outbound/${OTHER_HANDLE}/file.txt`,
    contents: Buffer.from("x")
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "write_denied");
  assert.equal(exec.calls.length, 0);
});

test("workspaceFileWrite: self outbound /shared/outbound/self/foo.png → exec called + saveObject called", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "", stderr: "" }]);
  const storage = makeStorage();
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, storage.service, makeObs().service, audit.service);
  const contents = Buffer.from("PNG_BYTES");

  const result = await bridge.workspaceFileWrite(CTX, {
    path: `/shared/${WS_ID}/outbound/self/foo.png`,
    contents
  });

  assert.equal(result.success, true);
  assert.equal(exec.calls.length, 1);
  // exec command targets the resolved path (self symlink → /shared/<wsid>/outbound/self/foo.png)
  assert.ok(exec.calls[0]?.shellCommand.includes("foo.png"));
  // GCS mirror: saveObject must be called once
  assert.equal(storage.savedObjects.length, 1);
  assert.ok(storage.savedObjects[0]?.objectKey.includes(WS_ID));
  assert.deepEqual(storage.savedObjects[0]?.buffer, contents);
  assert.equal(audit.ops[0]?.status, "ok");
});

// ─── writeSharedOutboundWithCollision ─────────────────────────────────────────

test("writeSharedOutboundWithCollision: empty outbound dir → exact basename lands", async () => {
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

  const result = await bridge.writeSharedOutboundWithCollision(CTX, {
    basename: "report.pdf",
    contents,
    collisionStrategy: "numeric_suffix"
  });

  assert.equal(result.success, true);
  assert.equal(result.data.resolvedBasename, "report.pdf");
  assert.equal(result.data.workspaceRelPath, "/shared/outbound/self/report.pdf");
  assert.equal(exec.calls.length, 2);
  assert.ok(exec.calls[1]?.shellCommand.includes("report.pdf"));
});

test("writeSharedOutboundWithCollision: report.pdf exists → report (2).pdf lands", async () => {
  const outboundDir = `/shared/${WS_ID}/outbound/self`;
  const exec = makeExec([
    {
      exitCode: 0,
      stdout: `${outboundDir}/report.pdf\tf\t100\t1700000000`,
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

  const result = await bridge.writeSharedOutboundWithCollision(CTX, {
    basename: "report.pdf",
    contents: Buffer.from("%PDF"),
    collisionStrategy: "numeric_suffix"
  });

  assert.equal(result.success, true);
  assert.equal(result.data.resolvedBasename, "report (2).pdf");
  assert.equal(result.data.workspaceRelPath, "/shared/outbound/self/report (2).pdf");
  assert.ok(exec.calls[1]?.shellCommand.includes("report (2).pdf"));
});

test("writeSharedOutboundWithCollision: report.pdf and report (2).pdf exist → report (3).pdf lands", async () => {
  const outboundDir = `/shared/${WS_ID}/outbound/self`;
  const exec = makeExec([
    {
      exitCode: 0,
      stdout: [
        `${outboundDir}/report.pdf\tf\t100\t1700000000`,
        `${outboundDir}/report (2).pdf\tf\t100\t1700000001`
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

  const result = await bridge.writeSharedOutboundWithCollision(CTX, {
    basename: "report.pdf",
    contents: Buffer.from("%PDF"),
    collisionStrategy: "numeric_suffix"
  });

  assert.equal(result.success, true);
  assert.equal(result.data.resolvedBasename, "report (3).pdf");
  assert.equal(result.data.workspaceRelPath, "/shared/outbound/self/report (3).pdf");
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
  // find -printf '%p\t%y\t%s\t%T@\n' output
  const mtime = 1700000000;
  const raw = [
    `/workspace/output/file.txt\tf\t512\t${mtime}`,
    `/workspace/output/subdir\td\t4096\t${mtime}`
  ].join("\n");
  const exec = makeExec([{ exitCode: 0, stdout: raw, stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileList(CTX, { path: "/workspace/output" });

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

test("workspaceFileDelete: shared input path → delete_denied, exec NOT called", async () => {
  const exec = makeExec();
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  const result = await bridge.workspaceFileDelete(CTX, {
    path: `/shared/${WS_ID}/input/protected.csv`
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "delete_denied");
  assert.equal(exec.calls.length, 0);
  assert.equal(audit.ops[0]?.reason, "delete_denied");
});

// ─── D7 quota enforcement ─────────────────────────────────────────────────────

function makeQuotaCtx(
  overrides: Partial<Pick<WorkspaceBridgeContext, "workspaceQuotaBytes" | "sharedQuotaBytes">> = {}
): WorkspaceBridgeContext {
  return {
    ...CTX,
    ...overrides
  };
}

test("workspaceFileWrite: workspace cap exceeded → workspace_quota_exhausted", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "1000\n", stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("x".repeat(100));

  const result = await bridge.workspaceFileWrite(makeQuotaCtx({ workspaceQuotaBytes: 1000 }), {
    path: "/workspace/big.bin",
    contents
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "workspace_quota_exhausted");
  assert.equal(exec.calls.length, 1);
  assert.ok(exec.calls[0]?.shellCommand.includes("du -sb '/workspace/'"));
  assert.equal(audit.ops[0]?.status, "error");
  assert.equal(audit.ops[0]?.reason, "workspace_quota_exhausted");
});

test("workspaceFileWrite: shared cap exceeded → shared_quota_exhausted", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "900\n", stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("y".repeat(200));

  const result = await bridge.workspaceFileWrite(makeQuotaCtx({ sharedQuotaBytes: 1000 }), {
    path: `/shared/${WS_ID}/outbound/self/out.csv`,
    contents
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "shared_quota_exhausted");
  assert.equal(exec.calls.length, 1);
  assert.ok(exec.calls[0]?.shellCommand.includes(`du -sb '/shared/${WS_ID}/'`));
  assert.equal(audit.ops[0]?.reason, "shared_quota_exhausted");
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
    path: "/workspace/foo.txt",
    contents: Buffer.from("ok")
  });

  assert.equal(result.success, true);
  assert.equal(exec.calls.length, 1);
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
    path: "/workspace/small.txt",
    contents: Buffer.from("fits")
  });

  assert.equal(result.success, true);
  assert.equal(exec.calls.length, 2);
  assert.ok(exec.calls[0]?.shellCommand.includes("du -sb"));
  assert.ok(exec.calls[1]?.shellCommand.includes("cat >"));
});

test("writeSharedOutboundWithCollision: shared cap exceeded → shared_quota_exhausted", async () => {
  const exec = makeExec([{ exitCode: 0, stdout: "900\n", stderr: "" }]);
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("y".repeat(200));

  const result = await bridge.writeSharedOutboundWithCollision(
    makeQuotaCtx({ sharedQuotaBytes: 1000 }),
    {
      basename: "artefact.bin",
      contents,
      collisionStrategy: "overwrite"
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.reason, "shared_quota_exhausted");
  assert.equal(exec.calls.length, 1);
  assert.ok(exec.calls[0]?.shellCommand.includes(`du -sb '/shared/${WS_ID}/'`));
  assert.equal(audit.ops[0]?.reason, "shared_quota_exhausted");
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

test("workspaceFileCopy: workspace→shared success (cp + GCS mirror)", async () => {
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
    targetPath: `/shared/${WS_ID}/outbound/self/report.csv`
  });

  assert.equal(result.success, true);
  assert.equal(result.data.bytes, fileBytes.length);
  assert.equal(storage.savedObjects.length, 1);
  assert.ok(exec.calls[0]?.shellCommand.includes("cp -f"));
});

test("workspaceFileCopy: shared_outbound_self→shared_outbound_self no-op", async () => {
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

  const path = `/shared/${WS_ID}/outbound/self/report.csv`;
  const result = await bridge.workspaceFileCopy(CTX, {
    sourcePath: path,
    targetPath: path
  });

  assert.equal(result.success, true);
  assert.equal(result.data.sourcePath, path);
  assert.equal(result.data.targetPath, path);
  assert.equal(exec.calls.length, 1);
});

test("workspaceFileCopy: shared_input source rejected", async () => {
  const bridge = makeBridge(
    makeExec().service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  await assert.rejects(
    () =>
      bridge.workspaceFileCopy(CTX, {
        sourcePath: `/shared/${WS_ID}/input/sales.csv`,
        targetPath: `/shared/${WS_ID}/outbound/self/sales.csv`
      }),
    (e: unknown) => e instanceof WorkspacePathError
  );
});

test("workspaceFileCopy: sibling outbound source rejected", async () => {
  const bridge = makeBridge(
    makeExec().service,
    makeStorage().service,
    makeObs().service,
    makeAudit().service
  );

  await assert.rejects(
    () =>
      bridge.workspaceFileCopy(CTX, {
        sourcePath: `/shared/${WS_ID}/outbound/${OTHER_HANDLE}/secret.csv`,
        targetPath: `/shared/${WS_ID}/outbound/self/secret.csv`
      }),
    (e: unknown) => e instanceof WorkspacePathError
  );
});

// ─── ADR-126 v3 amendment (2026-06-25): writeSharedInputControlPlane ──────────
//
// Hot-pod inbound bytes-push. Called by api `manage-chat-media.stageForWebThread`
// right after the GCS upload so the running pod sees the upload immediately
// instead of only after the next cold-start hydrate.

test("writeSharedInputControlPlane: pod Running → atomic chmod gymnastics + write + mode=written", async () => {
  const exec = makeExec([], {
    tryHotPodResponses: [{ exitCode: 0, stdout: "", stderr: "" }]
  });
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("upload payload");

  const result = await bridge.writeSharedInputControlPlane(CTX, {
    basename: "3470.png",
    contents
  });

  assert.equal(result.success, true);
  assert.equal(result.reason, null);
  assert.equal(result.data.mode, "written");
  assert.equal(result.data.workspaceRelPath, "/shared/input/3470.png");
  assert.equal(result.data.absolutePath, `/shared/${WS_ID}/input/3470.png`);
  assert.equal(result.data.bytes, contents.length);
  assert.equal(exec.tryCalls.length, 1);
  const shell = exec.tryCalls[0]?.shellCommand ?? "";
  // The shell must (a) make the input dir writable temporarily, (b) cat the
  // bytes into the target, then (c) put both the file and the dir back to 0444.
  // Without `chmod 0744 input/` first the cat would fail (dir is 0444 after
  // bootstrap); without `chmod 0444` after the file the assistant could
  // overwrite uploads from inside the model surface.
  assert.ok(shell.includes(`chmod 0744 '/shared/${WS_ID}/input'`), shell);
  assert.ok(shell.includes(`cat > '/shared/${WS_ID}/input/3470.png'`), shell);
  assert.ok(shell.includes(`chmod 0444 '/shared/${WS_ID}/input/3470.png'`), shell);
  assert.ok(shell.includes(`chmod 0444 '/shared/${WS_ID}/input'`), shell);
  assert.equal(exec.tryCalls[0]?.stdin?.toString(), "upload payload");
  // execShellInSessionPod must NOT have been called: control-plane writes
  // must NEVER trigger cold-pod bootstrap, only push into already-warm pods.
  assert.equal(exec.calls.length, 0);
  assert.equal(audit.ops.at(-1)?.status, "ok");
});

test("writeSharedInputControlPlane: no Running pod → success with mode=deferred and no exec call", async () => {
  // tryHotPodResponses entry of `null` simulates "pod not Running" — the
  // bridge must NOT call execShellInSessionPod (would force cold-start),
  // must NOT throw, and must report mode=deferred so the api treats this as
  // "GCS hydrate will pick it up on next pod boot".
  const exec = makeExec([], { tryHotPodResponses: [null] });
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("payload");

  const result = await bridge.writeSharedInputControlPlane(CTX, {
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

test("writeSharedInputControlPlane: pod exec fails → success=false with reason=write_failed", async () => {
  const exec = makeExec([], {
    tryHotPodResponses: [{ exitCode: 1, stdout: "", stderr: "boom" }]
  });
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);
  const contents = Buffer.from("payload");

  const result = await bridge.writeSharedInputControlPlane(CTX, {
    basename: "broken.bin",
    contents
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, "write_failed");
  assert.equal(result.data.mode, "written");
  assert.equal(audit.ops.at(-1)?.status, "error");
  assert.equal(audit.ops.at(-1)?.reason, "write_failed");
});

test("writeSharedInputControlPlane: rejects basenames with path separators (defence-in-depth)", async () => {
  const exec = makeExec();
  const audit = makeAudit();
  const bridge = makeBridge(exec.service, makeStorage().service, makeObs().service, audit.service);

  for (const evilBasename of ["../escape.png", "sub/dir.png", "", ".", "..", "\u0000nul"]) {
    const result = await bridge.writeSharedInputControlPlane(CTX, {
      basename: evilBasename,
      contents: Buffer.from("x")
    });
    assert.equal(result.success, false, `basename=${JSON.stringify(evilBasename)}`);
    assert.equal(result.reason, "write_denied");
  }
  // No exec call must have been made for any rejected basename.
  assert.equal(exec.tryCalls.length, 0);
  assert.equal(exec.calls.length, 0);
});
