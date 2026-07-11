export const PAGE_RUNNER_SOURCE = String.raw`async (input) => {
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const normalizeText = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const isVisible = (element) => {
    if (!element || element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const buildSelector = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    for (const attr of ["name", "aria-label", "placeholder", "data-testid", "data-type"]) {
      const value = element.getAttribute(attr);
      if (typeof value === "string" && value.trim().length > 0) {
        return element.tagName.toLowerCase() + "[" + attr + "=\"" + CSS.escape(value.trim()) + "\"]";
      }
    }
    const parts = [];
    let current = element;
    while (current && parts.length < 5) {
      let selector = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((entry) => entry.tagName === current.tagName);
        if (siblings.length > 1) selector += ":nth-of-type(" + String(siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };
  const collectInteractiveElements = () => {
    const counts = new Map();
    return [...document.querySelectorAll("a, button, input, textarea, select, [role='button'], [role='link']")]
      .filter(isVisible)
      .map((element, index) => ({
        element,
        index,
        score: element.closest("main, [role='main'], article, [role='article']")
          ? 50
          : element.closest("header, nav, [role='navigation'], footer")
            ? 5
            : 25
      }))
      .sort((left, right) => (right.score !== left.score ? right.score - left.score : left.index - right.index))
      .slice(0, input.maxElements)
      .map(({ element }) => {
        const selector = buildSelector(element);
        const count = counts.get(selector) ?? 0;
        counts.set(selector, count + 1);
        const ariaLabelRaw = element.getAttribute("aria-label");
        return {
          selector,
          tagName: element.tagName.toLowerCase(),
          text: normalizeText(element.textContent || element.value || ariaLabelRaw || "") || null,
          role: element.getAttribute("role"),
          type: typeof element.type === "string" ? element.type : null,
          href: element instanceof HTMLAnchorElement ? element.href : null,
          placeholder: typeof element.placeholder === "string" ? element.placeholder || null : null,
          ariaLabel: typeof ariaLabelRaw === "string" ? normalizeText(ariaLabelRaw) || null : null,
          disabled: typeof element.disabled === "boolean" ? Boolean(element.disabled) : false,
          ...(count > 0 ? { matchIndex: count } : {})
        };
      });
  };
  const collectContent = () => {
    const bodyText = document.body && typeof document.body.innerText === "string"
      ? document.body.innerText.replace(/\n{3,}/g, "\n\n").trim()
      : "";
    if (bodyText.length > input.maxChars) {
      return { content: bodyText.slice(0, input.maxChars).trimEnd(), truncated: true };
    }
    return { content: bodyText, truncated: false };
  };
  const resolveMatchIndex = (matchIndex) => Number.isInteger(matchIndex) && Number(matchIndex) >= 0 ? Number(matchIndex) : 0;
  const getIndexedElement = (selector, matchIndex) => {
    const index = resolveMatchIndex(matchIndex);
    const element = document.querySelectorAll(selector).item(index);
    if (!element) throw new Error("No element at index " + String(index) + " for selector: " + selector);
    return element;
  };
  const waitForDomStabilityBeforeRead = () => new Promise((resolve) => {
    const quietIntervalMs = 750;
    let observer = null;
    let quietTimer = null;
    let timeoutTimer = null;
    let settled = false;
    let quietWindowStarted = false;
    const cleanup = () => {
      observer?.disconnect();
      observer = null;
      document.removeEventListener("DOMContentLoaded", beginQuietWindow);
      document.removeEventListener("readystatechange", beginQuietWindow);
      if (quietTimer !== null) {
        window.clearTimeout(quietTimer);
        quietTimer = null;
      }
      if (timeoutTimer !== null) {
        window.clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };
    const finish = (loadStatus) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(loadStatus);
    };
    const resetQuietWindow = () => {
      if (quietTimer !== null) window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => finish("stable"), quietIntervalMs);
    };
    function beginQuietWindow() {
      if (settled || quietWindowStarted || document.readyState === "loading" || !document.body) return;
      quietWindowStarted = true;
      observer = new MutationObserver(resetQuietWindow);
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true
      });
      resetQuietWindow();
    }
    timeoutTimer = window.setTimeout(() => finish("partial"), Math.max(0, input.domReadyTimeoutMs));
    document.addEventListener("DOMContentLoaded", beginQuietWindow);
    document.addEventListener("readystatechange", beginQuietWindow);
    beginQuietWindow();
  });
  const extracted = [];
  const warnings = [];
  let requestedNavigationUrl = null;
  const loadStatus = await waitForDomStabilityBeforeRead();
  for (const [index, operation] of (input.operations ?? []).entries()) {
    try {
      switch (operation.kind) {
        case "click": {
          const element = getIndexedElement(operation.selector, operation.matchIndex);
          const anchor = element.closest?.("a[href]");
          const anchorUrl = anchor instanceof HTMLAnchorElement ? anchor.href : "";
          if (/^https?:\/\//i.test(anchorUrl)) {
            requestedNavigationUrl = anchorUrl;
          } else {
            element.click();
            await sleep(input.settleAfterMutationMs);
          }
          break;
        }
        case "click_at": {
          const ownershipOverlay = document.getElementById("__persai_assistant_ownership__");
          const previousPointerEvents = ownershipOverlay?.style.pointerEvents ?? "";
          if (ownershipOverlay instanceof HTMLElement) ownershipOverlay.style.pointerEvents = "none";
          const element = document.elementFromPoint(operation.x, operation.y);
          if (ownershipOverlay instanceof HTMLElement) ownershipOverlay.style.pointerEvents = previousPointerEvents;
          if (!(element instanceof HTMLElement)) throw new Error("No clickable element at the requested coordinates.");
          element.click();
          await sleep(input.settleAfterMutationMs);
          break;
        }
        case "extract": {
          extracted.push(...[...document.querySelectorAll(operation.selector)]
            .slice(0, Math.min(Number(operation.maxItems) || input.maxExtractItems, input.maxExtractItems))
            .map((element) => ({
              selector: buildSelector(element),
              tagName: element.tagName.toLowerCase(),
              text: normalizeText(element.textContent) || null,
              href: element instanceof HTMLAnchorElement ? element.href : null,
              ariaLabel: normalizeText(element.getAttribute("aria-label")) || null
            })));
          break;
        }
        case "hover": {
          getIndexedElement(operation.selector, operation.matchIndex).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          await sleep(input.settleAfterMutationMs);
          break;
        }
        case "press": {
          const target = document.activeElement ?? document.body;
          target?.dispatchEvent(new KeyboardEvent("keydown", { key: operation.key, bubbles: true }));
          target?.dispatchEvent(new KeyboardEvent("keyup", { key: operation.key, bubbles: true }));
          await sleep(input.settleAfterMutationMs);
          break;
        }
        case "scroll": {
          if (typeof operation.selector === "string" && operation.selector.length > 0) {
            getIndexedElement(operation.selector, operation.matchIndex).scrollIntoView({ behavior: "instant", block: "center" });
          } else {
            window.scrollBy(0, window.innerHeight);
          }
          await sleep(input.settleAfterMutationMs);
          break;
        }
        case "select_option": {
          const element = getIndexedElement(operation.selector, operation.matchIndex);
          if (!(element instanceof HTMLSelectElement)) throw new Error("Target element is not a select.");
          element.value = operation.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(input.settleAfterMutationMs);
          break;
        }
        case "type": {
          const element = getIndexedElement(operation.selector, operation.matchIndex);
          if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("Target element is not typable.");
          element.value = "";
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.focus();
          element.value = operation.text;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(input.settleAfterMutationMs);
          break;
        }
        case "wait_for_selector": {
          const timeoutMs = Number.isInteger(operation.timeoutMs) && Number(operation.timeoutMs) >= 0 ? Number(operation.timeoutMs) : 5000;
          const startedAt = Date.now();
          while (Date.now() - startedAt < timeoutMs) {
            if (document.querySelectorAll(operation.selector).length > resolveMatchIndex(operation.matchIndex)) break;
            await sleep(100);
          }
          break;
        }
        case "wait_for_timeout":
          await sleep(operation.timeoutMs);
          break;
        case "goto":
          throw new Error("goto must be handled by the native bridge wrapper.");
      }
    } catch (error) {
      warnings.push("op_" + String(index) + " (" + operation.kind + "): " + (error instanceof Error ? error.message : "Operation failed."));
    }
    try {
      globalThis.__persaiBrowserPreviewStep?.();
    } catch {
      // Native preview updates are best-effort and must never affect browser execution.
    }
    if (requestedNavigationUrl) break;
  }
  const snapshot = collectContent();
  return {
    finalUrl: window.location.href,
    title: document.title || null,
    loadStatus,
    content: snapshot.content,
    truncated: snapshot.truncated,
    elements: collectInteractiveElements(),
    extracted: extracted.length > 0 ? extracted.slice(0, input.maxExtractItems) : null,
    warning: warnings.length > 0 ? "Browser operation warnings: " + warnings.join("; ") : null,
    ...(requestedNavigationUrl ? { navigationUrl: requestedNavigationUrl } : {})
  };
}`;
