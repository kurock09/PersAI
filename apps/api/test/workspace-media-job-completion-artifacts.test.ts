import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildMediaJobCompletionArtifacts,
  resolveMediaJobCompletionToolCode
} from "../src/modules/workspace-management/application/workspace-media-job-completion-artifacts";

describe("workspace-media-job-completion-artifacts", () => {
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
          kind: "image",
          storagePath: "/shared/workspace-1/outbound/self/out.png",
          mimeType: "image/png",
          filename: "out.png",
          sizeBytes: 10,
          voiceNote: false
        }
      ]
    });

    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0]?.role, "output");
    assert.equal(artifacts[0]?.storagePath, "/shared/workspace-1/outbound/self/out.png");
  });

  test("ignores non-image outputs", () => {
    const artifacts = buildMediaJobCompletionArtifacts({
      outputArtifacts: [
        {
          artifactId: "artifact-audio",
          kind: "audio",
          storagePath: "/shared/workspace-1/outbound/self/out.mp3",
          mimeType: "audio/mpeg",
          filename: "out.mp3",
          sizeBytes: 10,
          voiceNote: false
        },
        {
          artifactId: "artifact-1",
          kind: "image",
          storagePath: "/shared/workspace-1/outbound/self/out.png",
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
          kind: "image",
          storagePath: "/shared/workspace-1/outbound/self/out.png",
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
