import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  buildChatFileUrl: () => "/dummy"
}));

afterEach(() => {
  cleanup();
});

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

## Что важно
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
    expect(blocks[2]).toMatchObject({ type: "body", title: "Что важно", titleLevel: 2 });
    expect(blocks[3]).toMatchObject({ type: "callout", label: "Итог" });
    expect(blocks[5]).toMatchObject({
      type: "actions",
      actions: ["Дать короткий план", "Сделать мягкий режим"]
    });
  });

  it("keeps markdown heading levels as spacious section titles after commit", () => {
    const blocks = parseAssistantResponseBlocks(`## Главный блок
Короткий абзац.

### Деталь
Ещё один абзац.`);

    expect(blocks).toEqual([
      {
        type: "body",
        title: "Главный блок",
        titleLevel: 2,
        content: "Короткий абзац."
      },
      {
        type: "body",
        title: "Деталь",
        titleLevel: 3,
        content: "Ещё один абзац."
      }
    ]);

    render(<ChatMessageBubble message={assistantMessage(`## Главный блок\nКороткий абзац.`)} />);

    expect(screen.getByText("Главный блок")).toHaveClass("text-[17px]", "mb-3", "leading-[1.4]");
    expect(screen.getByText("Главный блок").closest("section")).toHaveClass("py-1.5");
    expect(screen.getByText("Главный блок").closest("section")).not.toHaveClass(
      "rounded-2xl",
      "border",
      "bg-surface-raised/30"
    );
  });

  it("keeps heading-only h1/h2/h3 sections instead of dropping them", () => {
    const blocks = parseAssistantResponseBlocks(`# H1
## H2
### H3
#### H4
##### H5
###### H6`);

    expect(blocks).toEqual([
      { type: "body", title: "H1", titleLevel: 1, content: "" },
      { type: "body", title: "H2", titleLevel: 2, content: "" },
      { type: "body", title: "H3", titleLevel: 3, content: "#### H4\n##### H5\n###### H6" }
    ]);

    render(
      <ChatMessageBubble
        message={assistantMessage(`# H1
## H2
### H3
#### H4
##### H5
###### H6`)}
      />
    );

    expect(screen.getByText("H1")).toBeInTheDocument();
    expect(screen.getByText("H2")).toBeInTheDocument();
    expect(screen.getByText("H3")).toBeInTheDocument();
    expect(screen.getByText("H1")).toHaveClass("text-[19px]");
    expect(screen.getByText("H2")).toHaveClass("text-[17px]");
    expect(screen.getByText("H3")).toHaveClass("text-base", "md:text-[14px]");
  });

  it("preserves single-line breaks inside assistant body paragraphs", () => {
    const { container } = render(
      <ChatMessageBubble
        message={assistantMessage(`· Проверяю локальные файлы
· Сверяю внешний реф
· Собираю итог`)}
      />
    );

    const paragraph = container.querySelector("p.whitespace-pre-wrap");
    expect(paragraph).not.toBeNull();
    expect(paragraph?.textContent).toContain("· Проверяю локальные файлы\n· Сверяю внешний реф");
  });

  it("keeps inline progress markers untouched inside the final assistant content", () => {
    const { container } = render(
      <ChatMessageBubble
        message={assistantMessage(
          "· Проверю список файлов. · Проверяю вложения точнее. · Проверяю вложения ещё раз."
        )}
      />
    );

    const paragraph = container.querySelector("p.whitespace-pre-wrap");
    expect(paragraph?.textContent).toContain(
      "· Проверю список файлов. · Проверяю вложения точнее. · Проверяю вложения ещё раз."
    );
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

  it("renders all assistant follow-up chips with the same action styling", () => {
    render(
      <ChatMessageBubble
        message={assistantMessage(`Собрал

### Дальше
- Дать короткий план
- Показать подробнее
- Сравнить варианты`)}
        onAssistantAction={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Дать короткий план" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать подробнее" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сравнить варианты" })).toBeInTheDocument();
  });

  it("normalizes assistant-voice action chips into plain user requests", () => {
    const onAction = vi.fn();

    render(
      <ChatMessageBubble
        message={assistantMessage(`Коротко

### Дальше
- Могу **сравнить** Legion Tab, Xiaomi Pad 8 Pro и iPad
- Могу ещё показать цены в РФ`)}
        onAssistantAction={onAction}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Сравнить Legion Tab, Xiaomi Pad 8 Pro и iPad" })
    );

    expect(onAction).toHaveBeenCalledWith("Сравнить Legion Tab, Xiaomi Pad 8 Pro и iPad");
    expect(screen.getByRole("button", { name: "Показать цены в РФ" })).toBeInTheDocument();
  });

  it("does not parse live streaming tail into action chips before the message is committed", () => {
    render(
      <ChatMessageBubble
        message={{
          ...assistantMessage(`Собрал

### Дальше
- Дать короткий план`),
          status: "streaming"
        }}
        onAssistantAction={vi.fn()}
      />
    );

    expect(screen.queryByTestId("assistant-response-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Дать короткий план" })).not.toBeInTheDocument();
  });
});
