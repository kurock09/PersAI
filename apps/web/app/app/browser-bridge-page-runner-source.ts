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
  const waitForDomReadyBeforeRead = async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < input.domReadyTimeoutMs) {
      const text = document.body && typeof document.body.innerText === "string" ? normalizeText(document.body.innerText) : "";
      if (text.length >= 40 || (document.readyState === "complete" && text.length > 0)) return;
      await sleep(200);
    }
  };
  const userCheckpointRe = /(captcha|recaptcha|hcaptcha|cf-chl|verify you are human|confirm you are human|checking your browser|verification code|enter (?:the )?(?:security )?code|one[-\s]?time (?:password|code)|otp|2fa|3-d secure|3ds challenge|капча|подтвердите,? что вы не робот|проверка,? что вы не робот|код подтверждения|одноразовый код|код из смс|смс-код)/i;
  const sensitiveControlRe = /(pay[-_\s]?now|checkout|place[-_\s]?order|confirm[-_\s]?(?:order|purchase|payment)|purchase[-_\s]?now|card[-_\s]?number|cc-number|cvv|security[-_\s]?code|verification[-_\s]?code|one-time-code|otp|3-d secure|3ds|оплатить|перейти к оплате|оформить заказ|подтвердить заказ|номер карты|код подтверждения|код из смс|смс-код)/i;
  const controlNeedsUserAction = (element, selector = "") => sensitiveControlRe.test(
    [selector, element?.id, element?.getAttribute?.("name"), element?.getAttribute?.("type"), element?.getAttribute?.("autocomplete"), element?.getAttribute?.("aria-label"), element?.getAttribute?.("title"), element?.getAttribute?.("placeholder"), element?.textContent].filter(Boolean).join(" ")
  );
  const extracted = [];
  const warnings = [];
  let requestedNavigationUrl = null;
  await waitForDomReadyBeforeRead();
  let needsUserAction = userCheckpointRe.test(collectContent().content);
  for (const [index, operation] of (input.operations ?? []).entries()) {
    if (needsUserAction) break;
    try {
      switch (operation.kind) {
        case "click": {
          const element = getIndexedElement(operation.selector, operation.matchIndex);
          if (controlNeedsUserAction(element, operation.selector)) { needsUserAction = true; break; }
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
          if (controlNeedsUserAction(element)) { needsUserAction = true; break; }
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
          if (controlNeedsUserAction(element, operation.selector)) { needsUserAction = true; break; }
          if (!(element instanceof HTMLSelectElement)) throw new Error("Target element is not a select.");
          element.value = operation.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(input.settleAfterMutationMs);
          break;
        }
        case "type": {
          const element = getIndexedElement(operation.selector, operation.matchIndex);
          if (controlNeedsUserAction(element, operation.selector)) { needsUserAction = true; break; }
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
    if (requestedNavigationUrl) break;
  }
  if ((input.operations ?? []).length > 0 && !requestedNavigationUrl) {
    await waitForDomReadyBeforeRead();
  }
  const snapshot = collectContent();
  return {
    finalUrl: window.location.href,
    title: document.title || null,
    content: snapshot.content,
    truncated: snapshot.truncated,
    elements: collectInteractiveElements(),
    extracted: extracted.length > 0 ? extracted.slice(0, input.maxExtractItems) : null,
    warning: warnings.length > 0 ? "Browser operation warnings: " + warnings.join("; ") : null,
    needsUserAction: needsUserAction || userCheckpointRe.test(snapshot.content),
    navigationUrl: requestedNavigationUrl
  };
}`;
