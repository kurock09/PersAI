import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageBubble, parseAssistantResponseBlocks } from "./chat-message";
import type { ChatMessage } from "./use-chat";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("./voice-message-player", () => ({
  VoiceMessagePlayer: () => <div data-testid="voice-message-player" />
}));

vi.mock("./image-lightbox", () => ({
  ImageLightbox: () => null
}));

vi.mock("../assistant-api-client", () => ({
  getAttachmentDownloadUrl: () => "/dummy"
}));

function assistantMessage(content: string): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content,
    status: "committed"
  };
}

describe("assistant response blocks", () => {
  it("parses header, body sections, callout, divider, and final action chips", () => {
    const blocks = parseAssistantResponseBlocks(`Понял

Короткая суть ответа.

### Что важно
- первый пункт
- второй пункт

> Итог
> Делаем спокойно и без шума.

---

### Дальше
- Дать короткий план
- Сделать мягкий режим`);

    expect(blocks.map((block) => block.type)).toEqual([
      "header",
      "body",
      "body",
      "callout",
      "divider",
      "actions"
    ]);
    expect(blocks[0]).toMatchObject({ type: "header", content: "Понял" });
    expect(blocks[2]).toMatchObject({ type: "body", title: "Что важно" });
    expect(blocks[3]).toMatchObject({ type: "callout", label: "Итог" });
    expect(blocks[5]).toMatchObject({
      type: "actions",
      actions: ["Дать короткий план", "Сделать мягкий режим"]
    });
  });

  it("keeps fenced code inside a body block instead of treating markdown markers as UI sections", () => {
    const blocks = parseAssistantResponseBlocks(`Готово

\`\`\`ts
const title = "### not a heading";
console.log(title);
\`\`\`

### Дальше
- Объяснить код`);

    expect(blocks.map((block) => block.type)).toEqual(["header", "body", "actions"]);
    expect(blocks[1]).toMatchObject({
      type: "body",
      content: expect.stringContaining("### not a heading")
    });
  });

  it("renders action chips that draft the chosen follow-up instead of auto-sending", () => {
    const onAction = vi.fn();

    render(
      <ChatMessageBubble
        message={assistantMessage(`Собрал

Короткая суть.

### Дальше
- Дать короткий план
- Показать подробнее`)}
        onAssistantAction={onAction}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Дать короткий план" }));

    expect(onAction).toHaveBeenCalledWith("Дать короткий план");
    expect(screen.getByTestId("assistant-response-actions")).toBeInTheDocument();
  });
});
