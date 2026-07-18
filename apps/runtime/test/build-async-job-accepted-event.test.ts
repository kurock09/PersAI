import assert from "node:assert/strict";
import test from "node:test";
import { buildAsyncJobAcceptedEvent } from "../src/modules/turns/build-async-job-accepted-event";

test("builds media async_job_accepted for pending image_generate", () => {
  const event = buildAsyncJobAcceptedEvent({
    requestId: "req-1",
    sessionId: "sess-1",
    isError: false,
    payload: {
      toolCode: "image_generate",
      executionMode: "worker",
      provider: "openai",
      model: "gpt-image",
      prompt: "cat",
      revisedPrompt: null,
      requestedCount: 2,
      size: "1024x1024",
      artifacts: [],
      usage: null,
      action: "pending_delivery",
      reason: null,
      warning: null,
      jobId: "media-job-1",
      jobRef: "jr1.media.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      canSendFileNow: false
    }
  });
  assert.ok(event);
  assert.equal(event.type, "async_job_accepted");
  assert.equal(event.kind, "media");
  assert.equal(event.jobRef, "jr1.media.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(event.mediaJob?.id, "media-job-1");
  assert.equal(event.mediaJob?.kind, "image");
  assert.equal(event.mediaJob?.operation, "image_generate");
  assert.equal(event.mediaJob?.requestedCount, 2);
  assert.equal(event.mediaJob?.status, "queued");
});

test("builds document async_job_accepted for pending presentation", () => {
  const event = buildAsyncJobAcceptedEvent({
    requestId: "req-1",
    sessionId: "sess-1",
    isError: false,
    payload: {
      toolCode: "document",
      executionMode: "worker",
      descriptorMode: "create_presentation",
      documentType: "presentation",
      provider: null,
      prompt: null,
      outputFormat: "pptx",
      docId: null,
      requestedName: null,
      artifacts: [],
      usage: null,
      action: "pending_delivery",
      reason: null,
      warning: null,
      jobId: "doc-job-1",
      jobRef: "jr1.document.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      canSendFileNow: false
    }
  });
  assert.ok(event);
  assert.equal(event.kind, "document");
  assert.equal(event.documentJob?.id, "doc-job-1");
  assert.equal(event.documentJob?.documentType, "presentation");
  assert.equal(event.documentJob?.descriptorMode, "create_presentation");
});

test("builds sandbox async_job_accepted without raw SandboxJob id", () => {
  const event = buildAsyncJobAcceptedEvent({
    requestId: "req-1",
    sessionId: "sess-1",
    isError: false,
    payload: {
      toolCode: "shell",
      executionMode: "sandbox",
      action: "background",
      reason: "foreground_threshold_reached",
      warning: null,
      jobRef: "jr1.sandbox.cccccccccccccccccccccccccccccccc",
      job: null,
      paths: []
    }
  });
  assert.ok(event);
  assert.equal(event.kind, "sandbox");
  assert.equal(event.jobRef, "jr1.sandbox.cccccccccccccccccccccccccccccccc");
  assert.equal(event.sandboxJob?.toolCode, "shell");
  assert.equal(event.sandboxJob?.status, "detached");
  assert.equal(event.sandboxJob?.notifyState, "none");
  assert.equal("jobId" in (event.sandboxJob ?? {}), false);
});

test("returns null when tool result is an error or missing jobRef", () => {
  assert.equal(
    buildAsyncJobAcceptedEvent({
      requestId: "req-1",
      sessionId: "sess-1",
      isError: true,
      payload: {
        toolCode: "shell",
        executionMode: "sandbox",
        action: "background",
        reason: null,
        warning: null,
        jobRef: "jr1.sandbox.dddddddddddddddddddddddddddddddd",
        job: null,
        paths: []
      }
    }),
    null
  );
  assert.equal(
    buildAsyncJobAcceptedEvent({
      requestId: "req-1",
      sessionId: "sess-1",
      isError: false,
      payload: {
        toolCode: "image_generate",
        executionMode: "worker",
        provider: null,
        model: null,
        prompt: null,
        revisedPrompt: null,
        requestedCount: 1,
        size: null,
        artifacts: [],
        usage: null,
        action: "pending_delivery",
        reason: null,
        warning: null,
        jobId: "media-job-2"
      }
    }),
    null
  );
});
