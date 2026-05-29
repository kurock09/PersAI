import { describe, expect, it } from "vitest";
import {
  buildStreamingMarkdownTailPreview,
  normalizeAssistantVisibleProgress,
  splitStreamingMarkdownContent
} from "./chat-message-streaming";

describe("normalizeAssistantVisibleProgress", () => {
  it("splits inline progress markers onto separate lines", () => {
    expect(
      normalizeAssistantVisibleProgress(
        "· Проверю список файлов в проекте. · Проверяю вложения точнее. · Проверяю вложения ещё раз."
      )
    ).toBe(
      "· Проверю список файлов в проекте.\n· Проверяю вложения точнее.\n· Проверяю вложения ещё раз."
    );
  });

  it("separates the final answer from the last progress line", () => {
    expect(
      normalizeAssistantVisibleProgress(
        "· Проверяю вложения точнее, чтобы назвать доступный файл без путаницы. Да. Сейчас вижу один файл:"
      )
    ).toBe(
      "· Проверяю вложения точнее, чтобы назвать доступный файл без путаницы.\n\nДа. Сейчас вижу один файл:"
    );
  });

  it("leaves already well-formatted progress blocks unchanged", () => {
    const content = "· Проверяю локальные файлы\n· Сверяю внешний реф\n· Собираю итог";
    expect(normalizeAssistantVisibleProgress(content)).toBe(content);
  });
});

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
