import { describe, expect, it } from "vitest";
import {
  buildStreamingMarkdownTailPreview,
  splitStreamingMarkdownContent
} from "./chat-message-streaming";

describe("splitStreamingMarkdownContent", () => {
  it("keeps completed heading blocks stable while the next block streams", () => {
    expect(splitStreamingMarkdownContent("# Heading\nBody in progress")).toEqual({
      stableContent: "# Heading\n",
      liveTail: "Body in progress"
    });
  });

  it("keeps completed fenced code blocks stable", () => {
    expect(
      splitStreamingMarkdownContent("Intro\n\n```ts\nconst value = 1;\n```\nTail still streaming")
    ).toEqual({
      stableContent: "Intro\n\n```ts\nconst value = 1;\n```\n",
      liveTail: "Tail still streaming"
    });
  });

  it("leaves unfinished fenced blocks in the live tail", () => {
    expect(
      splitStreamingMarkdownContent("Intro\n\n```ts\nconst value = 1;\nconst next = 2;")
    ).toEqual({
      stableContent: "Intro\n\n",
      liveTail: "```ts\nconst value = 1;\nconst next = 2;"
    });
  });

  it("moves fully separated paragraphs into the stable prefix", () => {
    expect(
      splitStreamingMarkdownContent("First paragraph.\n\nSecond paragraph.\n\nThird paragraph")
    ).toEqual({
      stableContent: "First paragraph.\n\nSecond paragraph.\n\n",
      liveTail: "Third paragraph"
    });
  });

  it("closes unfinished code fences for live markdown preview", () => {
    expect(buildStreamingMarkdownTailPreview("```ts\nconst value = 1;")).toBe(
      "```ts\nconst value = 1;\n```"
    );
  });

  it("closes unfinished math fences for live markdown preview", () => {
    expect(buildStreamingMarkdownTailPreview("$$\na^2 + b^2 = c^2")).toBe(
      "$$\na^2 + b^2 = c^2\n$$"
    );
  });
});

describe("working preamble format (new contract)", () => {
  it("no longer exports splitWorkingMarkdownContent or appendWorkingMarkdownBlock", () => {
    // These were removed as part of the :::working block pipeline removal.
    // The module only exports the streaming-markdown helpers now.
    const mod = { splitStreamingMarkdownContent, buildStreamingMarkdownTailPreview };
    const keys = Object.keys(mod);
    expect(keys).toContain("splitStreamingMarkdownContent");
    expect(keys).toContain("buildStreamingMarkdownTailPreview");
  });
});
