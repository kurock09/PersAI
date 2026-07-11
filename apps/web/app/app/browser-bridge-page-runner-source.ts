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
  const resolveGetFormNavigationUrl = (element) => {
    const isSubmitter =
      (element instanceof HTMLButtonElement &&
        (element.type === "submit" || element.type === "")) ||
      (element instanceof HTMLInputElement &&
        (element.type === "submit" || element.type === "image"));
    if (!isSubmitter) return null;
    const form =
      element instanceof HTMLButtonElement || element instanceof HTMLInputElement
        ? element.form
        : null;
    if (!(form instanceof HTMLFormElement)) return null;
    const method = (form.getAttribute("method") || "get").trim().toLowerCase();
    if (method !== "get") return null;
    let target;
    try {
      target = new URL(form.getAttribute("action") || "", window.location.href);
    } catch {
      return null;
    }
    if (!/^https?:$/i.test(target.protocol)) return null;
    const formData = new FormData(form, element);
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") target.searchParams.append(key, value);
    }
    return target.href;
  };
  const resolveGetFormNavigationUrlFromField = (field) => {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return null;
    const form = field.form;
    if (!(form instanceof HTMLFormElement)) return null;
    const method = (form.getAttribute("method") || "get").trim().toLowerCase();
    if (method !== "get") return null;
    let target;
    try {
      target = new URL(form.getAttribute("action") || "", window.location.href);
    } catch {
      return null;
    }
    if (!/^https?:$/i.test(target.protocol)) return null;
    const formData = new FormData(form);
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") target.searchParams.append(key, value);
    }
    return target.href;
  };
  const logRunnerDiag = (event, payload) => {
    const bridge = window.PersaiBrowserBridgeNative;
    const line = JSON.stringify({ event, pageUrl: window.location.href, ...payload });
    if (bridge && typeof bridge.logRunnerDiag === "function") {
      try {
        bridge.logRunnerDiag(line);
      } catch {}
    }
  };
  const describeElementForDiag = (element) => {
    if (!(element instanceof Element)) return null;
    const rect = element.getBoundingClientRect();
    const anchor = element.closest?.("a[href]");
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      ariaLabel: element.getAttribute("aria-label"),
      dataTestId: element.getAttribute("data-testid"),
      href: anchor instanceof HTMLAnchorElement ? anchor.href : null,
      text: normalizeText(element.textContent).slice(0, 80) || null,
      rect: {
        left: Math.round(rect.left * 100) / 100,
        top: Math.round(rect.top * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100
      },
      selector: buildSelector(element)
    };
  };
  const withoutOwnershipOverlay = async (fn) => {
    const ownershipOverlay = document.getElementById("__persai_assistant_ownership__");
    const previousPointerEvents = ownershipOverlay instanceof HTMLElement ? ownershipOverlay.style.pointerEvents : "";
    if (ownershipOverlay instanceof HTMLElement) ownershipOverlay.style.pointerEvents = "none";
    try {
      return await fn();
    } finally {
      if (ownershipOverlay instanceof HTMLElement) ownershipOverlay.style.pointerEvents = previousPointerEvents;
    }
  };
  const isInteractiveElement = (element) => {
    if (!(element instanceof Element)) return false;
    if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) return true;
    const role = element.getAttribute("role");
    return role === "button" || role === "link";
  };
  const resolvePointerActivation = (element, hit, x, y) => {
    const sameNode = hit === element || (hit instanceof Node && element.contains(hit));
    if (sameNode) return { element, x, y, occluded: false, sameNode: true };
    const hitInteractive = hit instanceof Element ? hit.closest("button, a[href], [role='button'], [role='link']") : null;
    if (hitInteractive instanceof HTMLElement && isInteractiveElement(hitInteractive)) {
      const hitRect = hitInteractive.getBoundingClientRect();
      return {
        element: hitInteractive,
        x: hitRect.left + hitRect.width / 2,
        y: hitRect.top + hitRect.height / 2,
        occluded: true,
        sameNode: false
      };
    }
    return { element, x, y, occluded: false, sameNode: false };
  };
  const dispatchDomPointerSequence = (element, x, y) => {
    if (!(element instanceof HTMLElement)) return;
    try { element.focus({ preventScroll: true }); } catch {}
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1
    };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        element.dispatchEvent(new Ctor(type, eventInit));
      } catch {}
    }
  };
  const requestNativePointerTap = (x, y) => new Promise((resolve, reject) => {
    const bridge = window.PersaiBrowserBridgeNative;
    if (input.nativePointer && bridge && typeof bridge.requestPointerTap === "function") {
      try {
        bridge.requestPointerTap(x, y);
        resolve();
      } catch (error) {
        reject(error);
      }
      return;
    }
    const handler = window.webkit?.messageHandlers?.persaiBrowserBridgeNative;
    if (input.nativePointer && handler && typeof handler.postMessage === "function") {
      const syncId = Math.random().toString(36).slice(2);
      const timeoutId = window.setTimeout(() => {
        delete window.__persaiPointerTapWait;
        reject(new Error("Native pointer tap timed out."));
      }, 3000);
      window.__persaiPointerTapWait = (id) => {
        if (id !== syncId) return;
        window.clearTimeout(timeoutId);
        delete window.__persaiPointerTapWait;
        resolve();
      };
      handler.postMessage({
        type: "pointer_tap",
        syncId,
        x,
        y,
        runId: typeof window.__persaiRunnerRunId === "string" ? window.__persaiRunnerRunId : null
      });
      return;
    }
    reject(new Error("Native pointer tap is unavailable."));
  });
  const activatePointerTarget = async (element, context = {}) => {
    if (!(element instanceof HTMLElement)) throw new Error("Target element is not clickable.");
    try {
      element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
    } catch {}
    const rect = element.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    if (input.nativePointer) {
      try {
        await withoutOwnershipOverlay(async () => {
          let hit = null;
          try { hit = document.elementFromPoint(x, y); } catch { hit = null; }
          const activation = resolvePointerActivation(element, hit, x, y);
          x = activation.x;
          y = activation.y;
          try {
            logRunnerDiag(activation.occluded ? "pointer_occluded" : "pointer_target", {
              ...context,
              target: describeElementForDiag(element),
              hit: describeElementForDiag(hit),
              activated: describeElementForDiag(activation.element),
              tap: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 },
              viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
              sameNode: activation.sameNode,
              occluded: activation.occluded
            });
          } catch {}
          await requestNativePointerTap(x, y);
          dispatchDomPointerSequence(activation.element, x, y);
          await sleep(input.settleAfterMutationMs);
        });
        return;
      } catch {}
    }
    element.click();
    await sleep(input.settleAfterMutationMs);
  };
  const activatePointerAt = async (x, y, fallbackElement, context = {}) => {
    if (input.nativePointer) {
      try {
        await withoutOwnershipOverlay(async () => {
          let hit = null;
          try { hit = document.elementFromPoint(x, y); } catch { hit = null; }
          const activation = resolvePointerActivation(
            fallbackElement instanceof HTMLElement ? fallbackElement : null,
            hit,
            x,
            y
          );
          x = activation.x;
          y = activation.y;
          try {
            logRunnerDiag(activation.occluded ? "pointer_at_occluded" : "pointer_at", {
              ...context,
              fallback: describeElementForDiag(fallbackElement),
              hit: describeElementForDiag(hit),
              activated: describeElementForDiag(activation.element),
              tap: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 },
              viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
              sameNode: activation.sameNode,
              occluded: activation.occluded
            });
          } catch {}
          await requestNativePointerTap(x, y);
          if (activation.element instanceof HTMLElement) {
            dispatchDomPointerSequence(activation.element, x, y);
          }
          await sleep(input.settleAfterMutationMs);
        });
        return;
      } catch {}
    }
    if (!(fallbackElement instanceof HTMLElement)) throw new Error("No clickable element at the requested coordinates.");
    fallbackElement.click();
    await sleep(input.settleAfterMutationMs);
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
            logRunnerDiag("anchor_handoff", {
              opKind: "click",
              opSelector: operation.selector,
              opMatchIndex: resolveMatchIndex(operation.matchIndex),
              anchorUrl,
              anchor: describeElementForDiag(anchor),
              target: describeElementForDiag(element)
            });
            requestedNavigationUrl = anchorUrl;
          } else {
            const formNavigationUrl = resolveGetFormNavigationUrl(element);
            if (formNavigationUrl) {
              logRunnerDiag("form_handoff", {
                opKind: "click",
                opSelector: operation.selector,
                opMatchIndex: resolveMatchIndex(operation.matchIndex),
                navigationUrl: formNavigationUrl,
                target: describeElementForDiag(element)
              });
              requestedNavigationUrl = formNavigationUrl;
            } else {
              await activatePointerTarget(element, {
                opKind: "click",
                opSelector: operation.selector,
                opMatchIndex: resolveMatchIndex(operation.matchIndex)
              });
            }
          }
          break;
        }
        case "click_at": {
          const element = await withoutOwnershipOverlay(() => document.elementFromPoint(operation.x, operation.y));
          await activatePointerAt(operation.x, operation.y, element, {
            opKind: "click_at",
            opX: operation.x,
            opY: operation.y
          });
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
          const key = operation.key === "Return" ? "Enter" : operation.key;
          const activeField = document.activeElement;
          if (key === "Enter") {
            const formNavigationUrl = resolveGetFormNavigationUrlFromField(activeField);
            if (formNavigationUrl) {
              requestedNavigationUrl = formNavigationUrl;
              break;
            }
          }
          const bridge = window.PersaiBrowserBridgeNative;
          if (input.nativePointer && bridge && typeof bridge.requestKeyPress === "function" && (key === "Enter" || key === "Tab" || key === "Backspace")) {
            bridge.requestKeyPress(key);
          } else {
            const target = activeField ?? document.body;
            target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
            target?.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
          }
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
  try {
    globalThis.__persaiBrowserPreviewStep?.();
  } catch {
    // Native preview updates are best-effort and must never affect browser execution.
  }
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
