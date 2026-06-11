import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import { AssistantKnowledgeManager } from "./assistant-knowledge-manager";

const apiMocks = vi.hoisted(() => ({
  deleteAssistantKnowledgeSource: vi.fn(),
  getAssistantKnowledgeSources: vi.fn(),
  inspectAssistantKnowledgeSource: vi.fn(),
  reindexAssistantKnowledgeSource: vi.fn(),
  uploadAssistantKnowledgeSource: vi.fn()
}));

vi.mock("../assistant-api-client", () => ({
  deleteAssistantKnowledgeSource: apiMocks.deleteAssistantKnowledgeSource,
  getAssistantKnowledgeSources: apiMocks.getAssistantKnowledgeSources,
  inspectAssistantKnowledgeSource: apiMocks.inspectAssistantKnowledgeSource,
  reindexAssistantKnowledgeSource: apiMocks.reindexAssistantKnowledgeSource,
  uploadAssistantKnowledgeSource: apiMocks.uploadAssistantKnowledgeSource
}));

function renderManager(getToken: () => Promise<string | null>) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AssistantKnowledgeManager getToken={getToken} mode="inline" />
    </NextIntlClientProvider>
  );
}

describe("AssistantKnowledgeManager", () => {
  afterEach(() => {
    cleanup();
    apiMocks.deleteAssistantKnowledgeSource.mockReset();
    apiMocks.getAssistantKnowledgeSources.mockReset();
    apiMocks.inspectAssistantKnowledgeSource.mockReset();
    apiMocks.reindexAssistantKnowledgeSource.mockReset();
    apiMocks.uploadAssistantKnowledgeSource.mockReset();
  });

  it("does not reload knowledge list on every rerender when getToken identity changes", async () => {
    apiMocks.getAssistantKnowledgeSources.mockResolvedValue({
      sources: [],
      quota: { usedBytes: 512, limitBytes: 2048 }
    });

    const firstGetToken = vi.fn().mockResolvedValue("token-1");
    const { rerender } = renderManager(firstGetToken);

    await waitFor(() => {
      expect(apiMocks.getAssistantKnowledgeSources).toHaveBeenCalledTimes(1);
    });

    const secondGetToken = vi.fn().mockResolvedValue("token-1");
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AssistantKnowledgeManager getToken={secondGetToken} mode="inline" />
      </NextIntlClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload documents" })).toBeInTheDocument();
    });
    expect(apiMocks.getAssistantKnowledgeSources).toHaveBeenCalledTimes(1);
  });

  it("reloads the knowledge list only when the manual refresh button is clicked", async () => {
    apiMocks.getAssistantKnowledgeSources.mockResolvedValue({
      sources: [],
      quota: { usedBytes: 512, limitBytes: 2048 }
    });

    renderManager(vi.fn().mockResolvedValue("token-1"));

    await waitFor(() => {
      expect(apiMocks.getAssistantKnowledgeSources).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh knowledge status" }));

    await waitFor(() => {
      expect(apiMocks.getAssistantKnowledgeSources).toHaveBeenCalledTimes(2);
    });
  });
});
