/**
 * Host page model: lavka.yandex.ru (Яндекс Лавка)
 *
 * Returns { elements } for provider-gateway host-script hook → page.elements.
 * Domain mechanics only. Shopping flows live in skill scenarios.
 */
(() => {
  const norm = (value) =>
    typeof value === "string"
      ? value.replace(/\u00ad/g, "").replace(/\s+/g, " ").trim()
      : "";

  const vis = (element) => {
    if (!element || element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  };

  const selectors = {
    productCard: '[data-testid="product-card"]',
    productCardLink: 'a[data-type="product-card-link"], a[href*="/good/"]',
    addButton: 'button[data-testid="add-spin-button"]',
    removeButton: 'button[data-testid="remove-spin-button"]',
    cartItem: '[data-testid^="cart_item_"]',
    searchInput: "input[data-testid='search-input']",
    catalogNav:
      'nav[aria-label="Каталог"] a[data-testid^="catalog-menu-item"], nav[aria-label="Каталог"] a[href^="/catalog/"]',
    cartLink: 'a[href="/cart"]'
  };

  const cardLinkSelector = `${selectors.productCard} ${selectors.productCardLink}`;
  const cardAddSelector = `${selectors.productCard} ${selectors.addButton}`;
  const cardRemoveSelector = `${selectors.productCard} ${selectors.removeButton}`;
  const cartItemLinkSelector = `${selectors.cartItem} a[href*="/good/"]`;

  const pushElement = (elements, entry) => {
    if (!entry.selector || !entry.tagName) {
      return;
    }
    elements.push({
      selector: entry.selector,
      tagName: entry.tagName,
      text: entry.text ?? null,
      role: entry.role ?? null,
      type: entry.type ?? null,
      href: entry.href ?? null,
      placeholder: entry.placeholder ?? null,
      ariaLabel: entry.ariaLabel ?? null,
      disabled: entry.disabled === true,
      ...(Number.isInteger(entry.matchIndex) && entry.matchIndex > 0
        ? { matchIndex: entry.matchIndex }
        : {})
    });
  };

  const elements = [];

  const searchInput = document.querySelector(selectors.searchInput);
  if (searchInput && vis(searchInput)) {
    pushElement(elements, {
      selector: selectors.searchInput,
      tagName: "input",
      text: norm(searchInput.value ?? "") || null,
      role: "searchbox",
      type: "search",
      placeholder: norm(searchInput.getAttribute("placeholder") ?? "") || null,
      ariaLabel: "host:search_input",
      disabled: Boolean(searchInput.disabled)
    });
  }

  Array.from(document.querySelectorAll(selectors.productCard))
    .filter(vis)
    .forEach((card, cardIndex) => {
      const link = card.querySelector(selectors.productCardLink);
      const title = link ? norm(link.textContent) : null;
      const href = link?.getAttribute("href") ?? null;
      const matchIndex = cardIndex > 0 ? cardIndex : undefined;

      if (link) {
        pushElement(elements, {
          selector: cardLinkSelector,
          tagName: "a",
          text: title,
          href,
          ariaLabel: "host:product_card_link",
          disabled: false,
          matchIndex
        });
      }

      const addButton = card.querySelector(selectors.addButton);
      if (addButton && vis(addButton)) {
        pushElement(elements, {
          selector: cardAddSelector,
          tagName: "button",
          text: norm(addButton.getAttribute("aria-label") ?? "Увеличить"),
          ariaLabel: "host:product_card_add",
          disabled: Boolean(addButton.disabled),
          matchIndex
        });
      }

      const removeButton = card.querySelector(selectors.removeButton);
      if (removeButton && vis(removeButton)) {
        pushElement(elements, {
          selector: cardRemoveSelector,
          tagName: "button",
          text: norm(removeButton.getAttribute("aria-label") ?? "Уменьшить"),
          ariaLabel: "host:product_card_remove",
          disabled: Boolean(removeButton.disabled),
          matchIndex
        });
      }
    });

  Array.from(document.querySelectorAll(selectors.cartItem))
    .filter(vis)
    .forEach((item, cartIndex) => {
      const link = item.querySelector('a[href*="/good/"]');
      const matchIndex = cartIndex > 0 ? cartIndex : undefined;
      pushElement(elements, {
        selector: cartItemLinkSelector,
        tagName: "a",
        text: link ? norm(link.textContent) : null,
        href: link?.getAttribute("href") ?? null,
        ariaLabel: "host:cart_sidebar_item",
        disabled: false,
        matchIndex
      });
    });

  Array.from(document.querySelectorAll(selectors.catalogNav))
    .filter(vis)
    .slice(0, 24)
    .forEach((link, matchIndex) => {
      pushElement(elements, {
        selector: selectors.catalogNav,
        tagName: "a",
        text: norm(link.textContent).slice(0, 80) || null,
        href: link.getAttribute("href"),
        ariaLabel: "host:catalog_nav_link",
        disabled: false,
        matchIndex: matchIndex > 0 ? matchIndex : undefined
      });
    });

  const cartLink = document.querySelector(selectors.cartLink);
  if (cartLink && vis(cartLink)) {
    pushElement(elements, {
      selector: selectors.cartLink,
      tagName: "a",
      text: norm(cartLink.textContent).slice(0, 80) || "Корзина",
      href: "/cart",
      ariaLabel: "host:cart_checkout_link",
      disabled: false
    });
  }

  return { elements };
})();
