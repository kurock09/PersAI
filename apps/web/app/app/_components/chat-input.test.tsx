import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "./chat-input";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

function toFileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: function* () {
      yield* files;
    }
  } as unknown as FileList;
}

describe("ChatInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a knowledge-base checkbox for eligible documents", () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdfFile = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, {
      target: {
        files: toFileList([pdfFile])
      }
    });

    expect(screen.getByLabelText("knowledgeAddToBase")).toBeInTheDocument();
  });

  it("forwards addToKnowledgeBase when the checkbox is enabled", () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdfFile = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, {
      target: {
        files: toFileList([pdfFile])
      }
    });

    fireEvent.click(screen.getByLabelText("knowledgeAddToBase"));
    fireEvent.change(screen.getByPlaceholderText("placeholder"), {
      target: { value: "Use this file" }
    });
    fireEvent.click(screen.getByTitle("send"));

    expect(onSend).toHaveBeenCalledWith("Use this file", [pdfFile], {
      addToKnowledgeBase: true
    });
  });

  it("keeps the checkbox hidden for non-knowledge files", () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const audioFile = new File(["audio"], "voice.mp3", { type: "audio/mpeg" });
    fireEvent.change(fileInput, {
      target: {
        files: toFileList([audioFile])
      }
    });

    expect(screen.queryByLabelText("knowledgeAddToBase")).toBeNull();
  });
});
