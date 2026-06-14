import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildMediaJobCompletionArtifacts,
  resolveMediaJobCompletionToolCode
} from "../src/modules/workspace-management/application/assistant-media-job-completion-artifacts";

describe("assistant-media-job-completion-artifacts", () => {
  test("resolves image tool codes from requestJson", () => {
    assert.equal(
      resolveMediaJobCompletionToolCode({
        directToolExecution: { toolCode: "image_edit", request: {} }
      }),
      "image_edit"
    );
    assert.equal(
      resolveMediaJobCompletionToolCode({
        directToolExecution: { toolCode: "image_generate", request: {} }
      }),
      "image_generate"
    );
    assert.equal(resolveMediaJobCompletionToolCode({}), null);
  });

  test("builds only job output artifacts for image_edit", () => {
    const artifacts = buildMediaJobCompletionArtifacts({
      outputArtifacts: [
        {
          artifactId: "artifact-1",
          fileRef: "file-out-1",
          file: {} as never,
          kind: "image",
          objectKey: "runtime-output/out.png",
          mimeType: "image/png",
          filename: "out.png",
          sizeBytes: 10,
          voiceNote: false
        }
      ]
    });

    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0]?.role, "output");
    assert.equal(artifacts[0]?.objectKey, "runtime-output/out.png");
  });

  test("ignores non-image outputs", () => {
    const artifacts = buildMediaJobCompletionArtifacts({
      outputArtifacts: [
        {
          artifactId: "artifact-audio",
          fileRef: "file-audio-1",
          file: {} as never,
          kind: "audio",
          objectKey: "runtime-output/out.mp3",
          mimeType: "audio/mpeg",
          filename: "out.mp3",
          sizeBytes: 10,
          voiceNote: false
        },
        {
          artifactId: "artifact-1",
          fileRef: "file-out-1",
          file: {} as never,
          kind: "image",
          objectKey: "runtime-output/out.png",
          mimeType: "image/png",
          filename: "out.png",
          sizeBytes: 10,
          voiceNote: false
        }
      ]
    });

    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0]?.role, "output");
  });

  test("builds only outputs for image_generate", () => {
    const artifacts = buildMediaJobCompletionArtifacts({
      outputArtifacts: [
        {
          artifactId: "artifact-1",
          fileRef: "file-out-1",
          file: {} as never,
          kind: "image",
          objectKey: "runtime-output/out.png",
          mimeType: "image/png",
          filename: "out.png",
          sizeBytes: 10,
          voiceNote: false
        }
      ]
    });

    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0]?.role, "output");
  });
});
