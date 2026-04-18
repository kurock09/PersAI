import { describe, expect, it } from "vitest";
import { splitStreamingMarkdownContent } from "./chat-message-streaming";

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
});
