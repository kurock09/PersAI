"use client";

export const PROJECT_FILES_CHANGED_EVENT = "persai:project-files-changed";
export const PROJECT_MODE_ACTIVATED_EVENT = "persai:project-mode-activated";

const PROJECT_FILES_HINT_SESSION_PREFIX = "persai:project-files-hint:";

let pendingProjectFilesHighlightChatId: string | null = null;

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

export function dispatchProjectModeActivated(chatId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  pendingProjectFilesHighlightChatId = chatId;
  window.dispatchEvent(
    new CustomEvent(PROJECT_MODE_ACTIVATED_EVENT, {
      detail: { chatId }
    })
  );
}

export function consumePendingProjectFilesHighlight(chatId: string): boolean {
  if (pendingProjectFilesHighlightChatId !== chatId) {
    return false;
  }
  pendingProjectFilesHighlightChatId = null;
  return true;
}

export function shouldShowProjectFilesHint(chatId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return sessionStorage.getItem(`${PROJECT_FILES_HINT_SESSION_PREFIX}${chatId}`) !== "1";
  } catch {
    return true;
  }
}

export function markProjectFilesHintShown(chatId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(`${PROJECT_FILES_HINT_SESSION_PREFIX}${chatId}`, "1");
  } catch {
    // Ignore quota / privacy-mode failures — hint may repeat once per session.
  }
}

/** Resets in-memory highlight queue between vitest cases. */
export function resetProjectFilesHintStateForTests(): void {
  pendingProjectFilesHighlightChatId = null;
}
