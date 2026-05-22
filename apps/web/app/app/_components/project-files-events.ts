"use client";

export const PROJECT_FILES_CHANGED_EVENT = "persai:project-files-changed";

export function dispatchProjectFilesChanged(chatId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(PROJECT_FILES_CHANGED_EVENT, {
      detail: { chatId }
    })
  );
}
