import type {
  RuntimeBrowserExtractedItem,
  RuntimeBrowserInteractiveElement,
  RuntimeBrowserOperation
} from "./contract.js";

export interface PageRunnerInput {
  maxChars: number;
  maxElements: number;
  maxExtractItems: number;
  settleAfterMutationMs: number;
  domReadyTimeoutMs: number;
  hostPageScript: string | null;
  operations: RuntimeBrowserOperation[];
}

export interface PageRunnerResult {
  finalUrl: string;
  title: string | null;
  content: string;
  truncated: boolean;
  elements: RuntimeBrowserInteractiveElement[];
  extracted: RuntimeBrowserExtractedItem[] | null;
  warning?: string | null;
  needsUserAction?: boolean;
}

export function runPageCommandInPage(input: PageRunnerInput): Promise<PageRunnerResult> {
  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const normalizeText = (value: unknown): string =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  const isVisible = (element: Element): boolean => {
    if (element.getClientRects().length === 0) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  };

  const buildSelector = (element: Element): string => {
    const anyElement = element as HTMLElement;
    if (anyElement.id) {
      return `#${CSS.escape(anyElement.id)}`;
    }
    const attrCandidates = ["name", "aria-label", "placeholder", "data-testid", "data-type"];
    for (const attr of attrCandidates) {
      const value = anyElement.getAttribute(attr);
      if (typeof value === "string" && value.trim().length > 0) {
        return `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(value.trim())}"]`;
      }
    }
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && parts.length < 5) {
      let selector = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((entry) => entry.tagName === current?.tagName);
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };

  const scoreInteractiveElement = (element: Element): number => {
    if (element.closest("header, nav, [role='navigation'], footer")) {
      return 5;
    }
    if (element.closest("main, [role='main'], article, [role='article']")) {
      return 50;
    }
    return 25;
  };

  const collectInteractiveElements = (): RuntimeBrowserInteractiveElement[] => {
    const candidates = [
      ...document.querySelectorAll(
        "a, button, input, textarea, select, [role='button'], [role='link']"
      )
    ].filter(isVisible);
    const counts = new Map<string, number>();
    return candidates
      .map((element, index) => ({ element, index, score: scoreInteractiveElement(element) }))
      .sort((left, right) =>
        right.score !== left.score ? right.score - left.score : left.index - right.index
      )
      .slice(0, input.maxElements)
      .map(({ element }) => {
        const selector = buildSelector(element);
        const count = counts.get(selector) ?? 0;
        counts.set(selector, count + 1);
        const htmlElement = element as
          | HTMLInputElement
          | HTMLTextAreaElement
          | HTMLSelectElement
          | HTMLAnchorElement;
        const ariaLabelRaw = element.getAttribute("aria-label");
        return {
          selector,
          tagName: element.tagName.toLowerCase(),
          text:
            normalizeText(
              element.textContent ||
                ("value" in htmlElement && typeof htmlElement.value === "string"
                  ? htmlElement.value
                  : "") ||
                ariaLabelRaw ||
                ""
            ) || null,
          role: element.getAttribute("role"),
          type:
            "type" in htmlElement && typeof htmlElement.type === "string" ? htmlElement.type : null,
          href: element instanceof HTMLAnchorElement ? element.href : null,
          placeholder:
            "placeholder" in htmlElement && typeof htmlElement.placeholder === "string"
              ? htmlElement.placeholder || null
              : null,
          ariaLabel: typeof ariaLabelRaw === "string" ? normalizeText(ariaLabelRaw) || null : null,
          disabled: "disabled" in htmlElement ? Boolean(htmlElement.disabled) : false,
          ...(count > 0 ? { matchIndex: count } : {})
        };
      });
  };

  const applyHostScript = (
    genericElements: RuntimeBrowserInteractiveElement[]
  ): RuntimeBrowserInteractiveElement[] => {
    const source = input.hostPageScript?.trim() ?? "";
    if (source.length === 0) {
      return genericElements;
    }
    try {
      const result = window.eval(source);
      if (typeof result === "string") {
        const parsed = JSON.parse(result) as { elements?: RuntimeBrowserInteractiveElement[] };
        if (Array.isArray(parsed.elements) && parsed.elements.length > 0) {
          return parsed.elements.slice(0, input.maxElements);
        }
        return genericElements;
      }
      if (
        result &&
        typeof result === "object" &&
        Array.isArray((result as { elements?: RuntimeBrowserInteractiveElement[] }).elements)
      ) {
        const elements =
          (result as { elements?: RuntimeBrowserInteractiveElement[] }).elements ?? [];
        return elements.length > 0 ? elements.slice(0, input.maxElements) : genericElements;
      }
    } catch {
      return genericElements;
    }
    return genericElements;
  };

  const collectContent = (): { content: string; truncated: boolean } => {
    const bodyText =
      document.body && typeof document.body.innerText === "string"
        ? document.body.innerText.replace(/\n{3,}/g, "\n\n").trim()
        : "";
    if (bodyText.length > input.maxChars) {
      return { content: bodyText.slice(0, input.maxChars).trimEnd(), truncated: true };
    }
    return { content: bodyText, truncated: false };
  };

  const resolveMatchIndex = (matchIndex?: number | null): number =>
    Number.isInteger(matchIndex) && Number(matchIndex) >= 0 ? Number(matchIndex) : 0;

  const getIndexedElement = (selector: string, matchIndex?: number | null): Element => {
    const index = resolveMatchIndex(matchIndex);
    const element = document.querySelectorAll(selector).item(index);
    if (!element) {
      throw new Error(`No element at index ${String(index)} for selector: ${selector}`);
    }
    return element;
  };

  const clearElementValue = (element: Element): void => {
    if ("value" in (element as HTMLInputElement)) {
      (element as HTMLInputElement).value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const extractItems = (selector: string, maxItems: number): RuntimeBrowserExtractedItem[] => {
    const counts = new Map<string, number>();
    return [...document.querySelectorAll(selector)].slice(0, maxItems).map((element) => {
      const builtSelector = buildSelector(element);
      const count = counts.get(builtSelector) ?? 0;
      counts.set(builtSelector, count + 1);
      return {
        selector: builtSelector,
        tagName: element.tagName.toLowerCase(),
        text: normalizeText(element.textContent) || null,
        href: element instanceof HTMLAnchorElement ? element.href : null,
        ariaLabel: normalizeText(element.getAttribute("aria-label")) || null,
        ...(count > 0 ? { matchIndex: count } : {})
      };
    });
  };

  const mightNeedUserAction = (pageText: string): boolean =>
    /(captcha|recaptcha|hcaptcha|cf-chl|verify you are human|confirm you are human|checking your browser|verification code|enter (?:the )?(?:security )?code|one[-\s]?time (?:password|code)|otp|2fa|3-d secure|3ds challenge|капча|подтвердите,? что вы не робот|проверка,? что вы не робот|код подтверждения|одноразовый код|код из смс|смс-код)/i.test(
      pageText
    );
  const sensitiveControlRe =
    /(pay[-_\s]?now|checkout|place[-_\s]?order|confirm[-_\s]?(?:order|purchase|payment)|purchase[-_\s]?now|card[-_\s]?number|cc-number|cvv|security[-_\s]?code|verification[-_\s]?code|one-time-code|otp|3-d secure|3ds|оплатить|перейти к оплате|оформить заказ|подтвердить заказ|номер карты|код подтверждения|код из смс|смс-код)/i;
  const controlNeedsUserAction = (element: Element | null, selector = ""): boolean => {
    if (!(element instanceof HTMLElement)) {
      return sensitiveControlRe.test(selector);
    }
    return sensitiveControlRe.test(
      [
        selector,
        element.id,
        element.getAttribute("name"),
        element.getAttribute("type"),
        element.getAttribute("autocomplete"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("placeholder"),
        element.textContent
      ]
        .filter(Boolean)
        .join(" ")
    );
  };

  const waitForDomReadyBeforeRead = async (): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < input.domReadyTimeoutMs) {
      const readyState = document.readyState;
      const body = document.body;
      const text = body && typeof body.innerText === "string" ? normalizeText(body.innerText) : "";
      if (text.length >= 40) {
        return;
      }
      let visibleControls = 0;
      for (const element of document.querySelectorAll(
        "a, button, input, textarea, select, [role='button'], [data-testid]"
      )) {
        if (!isVisible(element)) {
          continue;
        }
        visibleControls += 1;
        if (visibleControls >= 2) {
          return;
        }
      }
      if (readyState === "complete" && text.length > 0) {
        return;
      }
      await sleep(200);
    }
  };

  return (async () => {
    const extracted: RuntimeBrowserExtractedItem[] = [];
    const warnings: string[] = [];
    await waitForDomReadyBeforeRead();
    let needsUserAction = mightNeedUserAction(collectContent().content);

    for (const [index, operation] of input.operations.entries()) {
      if (needsUserAction) {
        break;
      }
      try {
        switch (operation.kind) {
          case "click": {
            const element = getIndexedElement(
              operation.selector,
              operation.matchIndex
            ) as HTMLElement;
            if (controlNeedsUserAction(element, operation.selector)) {
              needsUserAction = true;
              break;
            }
            element.click();
            await sleep(input.settleAfterMutationMs);
            break;
          }
          case "click_at": {
            const ownershipOverlay = document.getElementById("__persai_assistant_ownership__");
            const previousPointerEvents = ownershipOverlay?.style.pointerEvents ?? "";
            if (ownershipOverlay instanceof HTMLElement) {
              ownershipOverlay.style.pointerEvents = "none";
            }
            const element = document.elementFromPoint(operation.x, operation.y);
            if (ownershipOverlay instanceof HTMLElement) {
              ownershipOverlay.style.pointerEvents = previousPointerEvents;
            }
            if (!(element instanceof HTMLElement)) {
              throw new Error("No clickable element at the requested coordinates.");
            }
            if (controlNeedsUserAction(element)) {
              needsUserAction = true;
              break;
            }
            element.click();
            await sleep(input.settleAfterMutationMs);
            break;
          }
          case "extract": {
            extracted.push(
              ...extractItems(
                operation.selector,
                Number.isInteger(operation.maxItems) && Number(operation.maxItems) > 0
                  ? Math.min(Number(operation.maxItems), input.maxExtractItems)
                  : input.maxExtractItems
              )
            );
            break;
          }
          case "goto":
            throw new Error("goto must be handled by the extension service worker.");
          case "hover": {
            const element = getIndexedElement(operation.selector, operation.matchIndex);
            element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            await sleep(input.settleAfterMutationMs);
            break;
          }
          case "press": {
            const target = document.activeElement ?? document.body;
            target?.dispatchEvent(
              new KeyboardEvent("keydown", { key: operation.key, bubbles: true })
            );
            target?.dispatchEvent(
              new KeyboardEvent("keyup", { key: operation.key, bubbles: true })
            );
            await sleep(input.settleAfterMutationMs);
            break;
          }
          case "scroll": {
            if (typeof operation.selector === "string" && operation.selector.length > 0) {
              const element = getIndexedElement(operation.selector, operation.matchIndex);
              element.scrollIntoView({ behavior: "instant", block: "center" });
            } else {
              window.scrollBy(0, window.innerHeight);
            }
            await sleep(input.settleAfterMutationMs);
            break;
          }
          case "select_option": {
            const element = getIndexedElement(operation.selector, operation.matchIndex);
            if (controlNeedsUserAction(element, operation.selector)) {
              needsUserAction = true;
              break;
            }
            if (!(element instanceof HTMLSelectElement)) {
              throw new Error("Target element is not a select.");
            }
            element.value = operation.value;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            await sleep(input.settleAfterMutationMs);
            break;
          }
          case "type": {
            const element = getIndexedElement(operation.selector, operation.matchIndex);
            if (controlNeedsUserAction(element, operation.selector)) {
              needsUserAction = true;
              break;
            }
            if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
              throw new Error("Target element is not typable.");
            }
            clearElementValue(element);
            element.focus();
            element.value = operation.text;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            await sleep(input.settleAfterMutationMs);
            break;
          }
          case "wait_for_selector": {
            const timeoutMs =
              Number.isInteger(operation.timeoutMs) && Number(operation.timeoutMs) >= 0
                ? Number(operation.timeoutMs)
                : 5_000;
            const startedAt = Date.now();
            while (Date.now() - startedAt < timeoutMs) {
              const nodes = document.querySelectorAll(operation.selector);
              if (nodes.length > resolveMatchIndex(operation.matchIndex)) {
                break;
              }
              await sleep(100);
            }
            break;
          }
          case "wait_for_timeout":
            await sleep(operation.timeoutMs);
            break;
        }
      } catch (error) {
        warnings.push(
          `op_${String(index)} (${operation.kind}): ${
            error instanceof Error ? error.message : "Operation failed."
          }`
        );
      }
    }

    await waitForDomReadyBeforeRead();
    const snapshot = collectContent();
    const finalElements = applyHostScript(collectInteractiveElements());
    const warning =
      warnings.length > 0 ? `Browser operation warnings: ${warnings.join("; ")}` : null;
    needsUserAction = needsUserAction || mightNeedUserAction(snapshot.content);

    return {
      finalUrl: window.location.href,
      title: document.title || null,
      content: snapshot.content,
      truncated: snapshot.truncated,
      elements: finalElements,
      extracted: extracted.length > 0 ? extracted.slice(0, input.maxExtractItems) : null,
      warning,
      needsUserAction
    };
  })();
}
