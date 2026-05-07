import assert from "node:assert/strict";
import { stringifyToolResultPayloadForModel } from "../src/modules/turns/sanitize-tool-result-for-model";

export async function runSanitizeToolResultForModelTest(): Promise<void> {
  // FIX 2 — strips filename / objectKey / artifactId / sizeBytes from
  // RuntimeOutputArtifact-shaped entries inside `artifacts: [...]`.
  {
    const payload = {
      toolCode: "image_generate" as const,
      action: "generated" as const,
      prompt: "Draw a serene poster",
      artifacts: [
        {
          artifactId: "11111111-2222-3333-4444-555555555555",
          kind: "image",
          objectKey: "assistant-media/runtime-output/sessions/s/requests/r/0.png",
          mimeType: "image/png",
          filename: "interesting_scene.png",
          sizeBytes: 12345,
          voiceNote: false
        }
      ]
    };

    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      toolCode: string;
      action: string;
      prompt: string;
      artifacts: Array<Record<string, unknown>>;
    };

    assert.equal(parsed.toolCode, "image_generate");
    assert.equal(parsed.action, "generated");
    assert.equal(parsed.prompt, "Draw a serene poster");
    const artifact = parsed.artifacts[0]!;
    assert.equal(artifact.kind, "image");
    assert.equal(artifact.mimeType, "image/png");
    assert.equal(artifact.voiceNote, false);
    assert.equal(artifact.artifactId, undefined);
    assert.equal(artifact.objectKey, undefined);
    assert.equal(artifact.filename, undefined);
    assert.equal(artifact.sizeBytes, undefined);
  }

  // Singular `artifact` field (used by video_generate / tts) gets the same
  // redaction treatment as a plural `artifacts` array.
  {
    const payload = {
      toolCode: "video_generate" as const,
      artifact: {
        artifactId: "video-1",
        kind: "video",
        objectKey: "assistant-media/runtime-output/sessions/s/requests/r/clip.mp4",
        mimeType: "video/mp4",
        filename: "sunrise-clip.mp4",
        sizeBytes: 999999,
        voiceNote: false
      }
    };

    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      artifact: Record<string, unknown>;
    };
    assert.equal(parsed.artifact.kind, "video");
    assert.equal(parsed.artifact.mimeType, "video/mp4");
    assert.equal(parsed.artifact.filename, undefined);
    assert.equal(parsed.artifact.objectKey, undefined);
    assert.equal(parsed.artifact.artifactId, undefined);
    assert.equal(parsed.artifact.sizeBytes, undefined);
  }

  // `caption` is preserved because runtime-synthesized captions can carry
  // semantically meaningful info for the next reasoning step (e.g.,
  // "cropped to focus on subject"). FIX 2 only strips presentation-only
  // fields the model has no business quoting back as text.
  {
    const payload = {
      artifacts: [
        {
          artifactId: "art-1",
          kind: "image",
          mimeType: "image/png",
          filename: "out.png",
          sizeBytes: 100,
          voiceNote: false,
          caption: "Cropped to focus on the subject"
        }
      ]
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      artifacts: Array<Record<string, unknown>>;
    };
    assert.equal(parsed.artifacts[0]!.caption, "Cropped to focus on the subject");
    assert.equal(parsed.artifacts[0]!.filename, undefined);
  }

  // RuntimeAttachmentRef-shaped objects (uses `attachmentId`, not
  // `artifactId`) are user-uploaded inputs the model already has filename
  // context for — they pass through unchanged.
  {
    const payload = {
      attachments: [
        {
          attachmentId: "attachment-1",
          kind: "image",
          objectKey: "assistant-media/uploads/photo.png",
          mimeType: "image/png",
          filename: "photo.png",
          sizeBytes: 4096
        }
      ]
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      attachments: Array<Record<string, unknown>>;
    };
    assert.equal(parsed.attachments[0]!.attachmentId, "attachment-1");
    assert.equal(parsed.attachments[0]!.filename, "photo.png");
    assert.equal(parsed.attachments[0]!.objectKey, "assistant-media/uploads/photo.png");
    assert.equal(parsed.attachments[0]!.sizeBytes, 4096);
  }

  // Non-artifact-bearing payloads (e.g., web_search) pass through verbatim
  // — the JSON output is byte-equivalent to the un-sanitized version.
  {
    const payload = {
      toolCode: "web_search" as const,
      action: "succeeded" as const,
      query: "PersAI runtime",
      results: [{ title: "PersAI", url: "https://persai.io", snippet: "..." }]
    };
    const json = stringifyToolResultPayloadForModel(payload);
    assert.equal(json, JSON.stringify(payload));
  }

  // Successful files.send / files.write_and_send results are deliberately
  // reduced for the model. The full internal payload still drives attachment
  // delivery, but the model should not see fileRef/raw attachment metadata and
  // copy it into the final user-visible answer.
  {
    const payload = {
      toolCode: "files" as const,
      executionMode: "inline" as const,
      requestedAction: "send" as const,
      action: "queued" as const,
      reason: null,
      warning: null,
      item: null,
      items: [],
      content: null,
      job: null,
      fileRefs: ["file-ref-1"],
      queuedArtifacts: 1
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      toolCode: string;
      requestedAction: string;
      action: string;
      delivered: boolean;
      queuedAttachments: number;
      fileRefs?: string[];
      instruction?: string;
    };
    assert.equal(parsed.toolCode, "files");
    assert.equal(parsed.requestedAction, "send");
    assert.equal(parsed.action, "queued");
    assert.equal(parsed.delivered, true);
    assert.equal(parsed.queuedAttachments, 1);
    assert.equal(parsed.fileRefs, undefined);
    assert.match(parsed.instruction ?? "", /Do not print fileRef/);
  }

  // Non-delivery files results still keep user-meaningful metadata, but raw
  // file selectors and sandbox job internals stay hidden from the model.
  {
    const payload = {
      toolCode: "files" as const,
      executionMode: "inline" as const,
      requestedAction: "read" as const,
      action: "read" as const,
      reason: null,
      warning: null,
      item: {
        fileRef: "file-ref-1",
        origin: "uploaded_attachment",
        relativePath: "uploads/report.txt",
        displayName: "report.txt",
        mimeType: "text/plain",
        sizeBytes: 42,
        logicalSizeBytes: 42,
        aliases: ["previous attachment #1"]
      },
      items: [
        {
          fileRef: "file-ref-1",
          origin: "uploaded_attachment",
          relativePath: "uploads/report.txt",
          displayName: "report.txt",
          mimeType: "text/plain",
          sizeBytes: 42,
          logicalSizeBytes: 42,
          aliases: ["previous attachment #1"]
        }
      ],
      content: "hello",
      job: {
        status: "completed",
        files: [{ fileRef: "file-ref-1", path: "uploads/report.txt" }]
      },
      fileRefs: ["file-ref-1"],
      queuedArtifacts: 0
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      item: Record<string, unknown>;
      items: Array<Record<string, unknown>>;
      content: string;
      job: unknown;
      fileRefs?: string[];
    };
    assert.equal(parsed.item.fileRef, undefined);
    assert.deepEqual(parsed.item.aliases, ["previous attachment #1"]);
    assert.equal(parsed.items[0]?.fileRef, undefined);
    assert.equal(parsed.content, "hello");
    assert.equal(parsed.job, null);
    assert.equal(parsed.fileRefs, undefined);
  }

  // Top-level user-supplied filenames (`sourceFilename`, `referenceFilename`
  // on image_edit / video_generate results) are NOT redacted because the
  // model already saw them in the user's message context — only output
  // artifacts get the redaction.
  {
    const payload = {
      sourceFilename: "user-uploaded.png",
      referenceFilename: null,
      artifacts: [
        {
          artifactId: "art-1",
          kind: "image",
          mimeType: "image/png",
          filename: "tool-generated.png",
          sizeBytes: 100,
          voiceNote: false
        }
      ]
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      sourceFilename: string;
      referenceFilename: string | null;
      artifacts: Array<Record<string, unknown>>;
    };
    assert.equal(parsed.sourceFilename, "user-uploaded.png");
    assert.equal(parsed.referenceFilename, null);
    assert.equal(parsed.artifacts[0]!.filename, undefined);
  }

  // Defensive: a null `artifact` field on a skipped tool result must not
  // crash the replacer.
  {
    const payload = {
      toolCode: "tts" as const,
      action: "skipped" as const,
      reason: "tool_unavailable",
      artifact: null
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      toolCode: string;
      artifact: unknown;
    };
    assert.equal(parsed.toolCode, "tts");
    assert.equal(parsed.artifact, null);
  }
}
