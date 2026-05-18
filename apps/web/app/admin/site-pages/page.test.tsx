import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminSitePagesPage from "./page";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

const RF_LOCALE = "ru" as const;

function makePage(status: "draft" | "published", overrides: Partial<Record<string, unknown>> = {}) {
  return {
    slug: "terms",
    market: "rf",
    locale: RF_LOCALE,
    status,
    title: status === "draft" ? "Old draft title" : "Published title",
    bodyMarkdown: "Initial body",
    version: "rf:persai_tos_mvp_v1",
    publishedAt: status === "published" ? "2026-05-18T10:00:00.000Z" : null,
    createdAt: "2026-05-18T09:00:00.000Z",
    updatedAt: "2026-05-18T09:30:00.000Z",
    ...overrides
  };
}

describe("Admin site pages page", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    clerkMocks.getToken.mockReset();
    clerkMocks.getToken.mockResolvedValue("token");
  });

  it("saves current editor state before publishing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pages: [makePage("draft"), makePage("published")]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            page: makePage("draft", { title: "Edited title" })
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            page: makePage("published", { title: "Edited title" })
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminSitePagesPage />);

    expect(await screen.findByDisplayValue("Old draft title")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Old draft title"), {
      target: { value: "Edited title" }
    });

    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const saveCall = fetchMock.mock.calls[1];
    const publishCall = fetchMock.mock.calls[2];

    expect(saveCall?.[0]).toBe("/api/v1/admin/site-pages/terms");
    expect((saveCall?.[1] as RequestInit).method).toBe("PUT");
    expect((saveCall?.[1] as RequestInit).body).toContain('"title":"Edited title"');

    expect(publishCall?.[0]).toBe("/api/v1/admin/site-pages/terms/publish");
    expect((publishCall?.[1] as RequestInit).method).toBe("POST");
  });
});
