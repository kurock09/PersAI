import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantSettingsDialogShell } from "./assistant-settings-dialog-shell";

afterEach(cleanup);

describe("AssistantSettingsDialogShell", () => {
  it("uses fullscreen mobile chrome and a centered desktop dialog", () => {
    render(
      <AssistantSettingsDialogShell open title="Personalization" onClose={() => undefined}>
        <p>Body</p>
      </AssistantSettingsDialogShell>
    );

    const dialog = screen.getByRole("dialog", { name: "Personalization" });
    expect(dialog.className).toContain("h-full");
    expect(dialog.className).toContain("md:h-auto");
    expect(dialog.className).toContain("md:rounded-2xl");
    expect(dialog.className).toContain("md:max-w-lg");

    const backdrop = dialog.parentElement;
    expect(backdrop?.className).toContain("fixed inset-0");
    expect(backdrop?.className).toContain("md:bg-black/40");
    expect(backdrop?.className).not.toMatch(/(?:^|\s)p-3(?:\s|$)/);
  });

  it("widens the desktop dialog for xl size", () => {
    render(
      <AssistantSettingsDialogShell open size="xl" title="Choose a new role" onClose={vi.fn()}>
        <p>Body</p>
      </AssistantSettingsDialogShell>
    );

    expect(screen.getByRole("dialog", { name: "Choose a new role" }).className).toContain(
      "md:max-w-4xl"
    );
  });
});
