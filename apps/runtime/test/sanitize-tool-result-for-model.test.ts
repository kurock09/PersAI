import assert from "node:assert/strict";
import { PERSAI_WEB_BROWSER_LOGIN_CONTINUE_URL } from "@persai/runtime-contract";
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
          storagePath: "assistant-media/runtime-output/sessions/s/requests/r/0.png",
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
    assert.equal(artifact.storagePath, undefined);
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
        storagePath: "assistant-media/runtime-output/sessions/s/requests/r/clip.mp4",
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
    assert.equal(parsed.artifact.storagePath, undefined);
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
          displayName: "out.png",
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
          storagePath: "assistant-media/uploads/photo.png",
          mimeType: "image/png",
          displayName: "photo.png",
          sizeBytes: 4096
        }
      ]
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      attachments: Array<Record<string, unknown>>;
    };
    assert.equal(parsed.attachments[0]!.attachmentId, "attachment-1");
    assert.equal(parsed.attachments[0]!.displayName, "photo.png");
    assert.equal(parsed.attachments[0]!.storagePath, "assistant-media/uploads/photo.png");
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

  // files.read results pass through item/items with the new path-based shape;
  // sandbox job internals (job field) and internal selectors (fileRefs) are hidden from the model.
  {
    const payload = {
      toolCode: "files" as const,
      executionMode: "inline" as const,
      requestedAction: "read" as const,
      action: "read" as const,
      reason: null,
      warning: null,
      item: {
        path: "/workspace/assistants/assistant-handle/sessions/session-id/uploads/report.txt",
        type: "file",
        sizeBytes: 42,
        mimeType: "text/plain",
        modifiedAt: null,
        shortDescription: "Quarterly revenue report for the EMEA region."
      },
      items: [
        {
          path: "/workspace/assistants/assistant-handle/sessions/session-id/uploads/report.txt",
          type: "file",
          sizeBytes: 42,
          mimeType: "text/plain",
          modifiedAt: null
        }
      ],
      content: "hello",
      job: {
        status: "completed",
        files: []
      },
      queuedArtifacts: 0
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      item: Record<string, unknown>;
      items: Array<Record<string, unknown>>;
      content: string;
      job: unknown;
      fileRefs?: string[];
    };
    assert.equal(
      parsed.item.path,
      "/workspace/assistants/assistant-handle/sessions/session-id/uploads/report.txt"
    );
    assert.equal(parsed.item.shortDescription, "Quarterly revenue report for the EMEA region.");
    assert.equal(
      parsed.items[0]?.path,
      "/workspace/assistants/assistant-handle/sessions/session-id/uploads/report.txt"
    );
    assert.equal(parsed.content, "hello");
    assert.equal(parsed.job, null);
    assert.equal(parsed.fileRefs, undefined);
  }

  // Top-level user-supplied filenames (`sourceFilename`, `referenceFilename`
  // on video_generate results) are NOT redacted because the model already
  // saw them in the user's message context — only output artifacts get the
  // redaction.
  {
    const payload = {
      sourceFilename: "user-uploaded.png",
      referenceFilename: null,
      artifacts: [
        {
          artifactId: "art-1",
          kind: "image",
          mimeType: "image/png",
          displayName: "tool-generated.png",
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

  // Defensive guard for the production regression where files.read returned
  // raw PDF bytes into the tool-result channel and inflated the next OpenAI
  // request to ~95k tokens.
  {
    const payload = {
      toolCode: "files" as const,
      executionMode: "inline" as const,
      requestedAction: "read" as const,
      action: "read" as const,
      reason: null,
      warning: null,
      item: null,
      items: [],
      content: "%PDF-1.4\n\u0000\u0001\u0002binary-data",
      job: null,
      fileHandles: [],
      queuedArtifacts: 0
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      content: string | null;
    };
    assert.equal(parsed.content, "[binary file content omitted from model context]");
  }

  // Large text reads stay useful but are capped before they become the next
  // turn's whole context.
  {
    const payload = {
      toolCode: "files" as const,
      executionMode: "inline" as const,
      requestedAction: "read" as const,
      action: "read" as const,
      reason: null,
      warning: null,
      item: null,
      items: [],
      content: "a".repeat(20_000),
      job: null,
      fileHandles: [],
      queuedArtifacts: 0
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      content: string | null;
      charCount: number;
      truncated: boolean;
    };
    assert.equal(parsed.content?.startsWith("a".repeat(100)), true);
    assert.match(parsed.content ?? "", /content truncated for model context/);
    assert.ok((parsed.content ?? "").length < 17_000);
    assert.equal(parsed.charCount, 20_000);
    assert.equal(parsed.truncated, true);
  }

  // ADR-116 — document read metadata survives sanitization.
  {
    const payload = {
      toolCode: "files" as const,
      executionMode: "inline" as const,
      requestedAction: "read" as const,
      action: "read" as const,
      reason: null,
      warning: "Extracted text from spec.pdf through PersAI document extraction.",
      item: null,
      items: [],
      content: "hello pdf text",
      charCount: 16,
      truncated: false,
      readNote: "Served from durable extraction cache.",
      extractionQuality: {
        status: "ok" as const,
        score: 0.98,
        reasonCodes: [] as string[],
        textChars: 16
      },
      extractionCached: true,
      job: null,
      fileHandles: [],
      queuedArtifacts: 0
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      content: string | null;
      charCount: number;
      truncated: boolean;
      note: string;
      extractionCached: boolean;
    };
    assert.equal(parsed.content, "hello pdf text");
    assert.equal(parsed.charCount, 16);
    assert.equal(parsed.truncated, false);
    assert.equal(parsed.note, "Served from durable extraction cache.");
    assert.equal(parsed.extractionCached, true);
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

  // Browser login tool results must not expose internal liveUrl to the model.
  {
    const payload = {
      toolCode: "browser" as const,
      executionMode: "worker" as const,
      action: "login" as const,
      login: {
        profileId: "prof-lavka",
        displayName: "Яндекс Лавка",
        liveUrl: "https://production-sfo.browserless.io/e/abc/live/index.html?i=secret"
      },
      pendingBrowserLogin: {
        profileId: "prof-lavka",
        displayName: "Яндекс Лавка",
        liveUrl: "https://production-sfo.browserless.io/e/abc/live/index.html?i=secret"
      }
    };
    const parsed = JSON.parse(stringifyToolResultPayloadForModel(payload)) as {
      login: Record<string, unknown>;
      pendingBrowserLogin: Record<string, unknown>;
      webBrowserLogin: { continueUrl: string; displayName: string; delivery: string };
    };
    assert.equal(parsed.login.liveUrl, undefined);
    assert.equal(parsed.pendingBrowserLogin.liveUrl, undefined);
    assert.equal(parsed.webBrowserLogin.continueUrl, PERSAI_WEB_BROWSER_LOGIN_CONTINUE_URL);
    assert.equal(parsed.webBrowserLogin.displayName, "Яндекс Лавка");
    assert.match(parsed.webBrowserLogin.delivery, /Never paste internal Browserless/);
  }
}
