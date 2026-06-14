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

  test("builds source reference plus output artifacts for image_edit", () => {
    const artifacts = buildMediaJobCompletionArtifacts({
      toolCode: "image_edit",
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
      ],
      requestAttachments: [
        {
          attachmentId: "att-1",
          kind: "image",
          objectKey: "uploads/source.png",
          mimeType: "image/png",
          filename: "source.png",
          sizeBytes: 20
        }
      ]
    });

    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[0]?.role, "source_reference");
    assert.equal(artifacts[0]?.objectKey, "uploads/source.png");
    assert.equal(artifacts[1]?.role, "output");
    assert.equal(artifacts[1]?.objectKey, "runtime-output/out.png");
  });

  test("builds only outputs for image_generate", () => {
    const artifacts = buildMediaJobCompletionArtifacts({
      toolCode: "image_generate",
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
      ],
      requestAttachments: []
    });

    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0]?.role, "output");
  });
});
