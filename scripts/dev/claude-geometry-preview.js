/**
 * PersAI — Claude geometry preview (Chrome console / Snippet)
 *
 * Вставь в DevTools → Console на открытой PersAI-странице.
 * Повторный запуск — toggle. Плашка внизу слева.
 */
(function persaiClaudeGeometryPreview() {
  const ROOT_ID = "persai-claude-geometry-preview-root";
  const STYLE_ID = "persai-claude-geometry-preview-style";

  /** Высота CTA −18% от предыдущего превью (44→36, 32→26, min-h-9 36→30). */
  const HEIGHT_SCALE = 0.82;

  const TOKENS = {
    ctaRadius: "12px",
    ctaMinHeight: `${Math.round(44 * HEIGHT_SCALE)}px`,
    ctaSmallMinHeight: `${Math.round(32 * HEIGHT_SCALE)}px`,
    ctaMinH9: `${Math.round(36 * HEIGHT_SCALE)}px`,
    ctaPaddingX: "16px",
    fieldRadius: "12px",
    cardRadius: "24px",
    composerRadius: "24px",
    chipRadius: "9999px"
  };

  const CSS = `
/* ── CTA: мягкий rect как у Claude ── */
button.rounded-full[class*="px-"],
a.rounded-full[class*="px-"],
[role="button"].rounded-full[class*="px-"] {
  border-radius: ${TOKENS.ctaRadius} !important;
  min-height: ${TOKENS.ctaMinHeight} !important;
  height: auto !important;
  padding-top: 6px !important;
  padding-bottom: 6px !important;
  padding-left: ${TOKENS.ctaPaddingX} !important;
  padding-right: ${TOKENS.ctaPaddingX} !important;
}

button.rounded-full.min-h-9[class*="px-"],
button.rounded-full.h-9[class*="px-"] {
  min-height: ${TOKENS.ctaMinH9} !important;
}

button.rounded-full.h-10[class*="px-"] {
  min-height: ${Math.round(40 * HEIGHT_SCALE)}px !important;
}

button.rounded-full.h-11[class*="px-"] {
  min-height: ${TOKENS.ctaMinHeight} !important;
}

button.rounded-full.text-\\[11px\\],
button.rounded-full.text-xs {
  min-height: ${TOKENS.ctaSmallMinHeight} !important;
  border-radius: 10px !important;
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}

/* Иконки-кружки */
button.rounded-full:is(.h-7, .w-7, .h-8, .w-8, .h-9, .w-9, .h-10, .w-10):not([class*="px-"]),
button.rounded-full[class*="p-2"]:not([class*="px-"]),
button.rounded-full[class*="p-1"]:not([class*="px-"]),
button.rounded-full[class*="p-0"]:not([class*="px-"]) {
  border-radius: ${TOKENS.chipRadius} !important;
  min-height: unset !important;
  height: unset !important;
  padding-top: unset !important;
  padding-bottom: unset !important;
  padding-left: unset !important;
  padding-right: unset !important;
}

button.rounded-full.touch-none,
.composer-icon-target {
  border-radius: ${TOKENS.chipRadius} !important;
  min-height: unset !important;
  height: unset !important;
}

/* Primary — без обводки (раньше border-width давал светлый halo) */
button.rounded-full[class*="bg-accent"] {
  border: none !important;
  font-weight: 500;
  letter-spacing: -0.01em;
}

/* Secondary — тонкая рамка как у Claude */
button.rounded-full[class*="bg-bg"],
button.rounded-full[class*="bg-surface"]:not([class*="bg-accent"]) {
  border-width: 1px !important;
  font-weight: 500;
  letter-spacing: -0.01em;
}

input.rounded-2xl,
textarea.rounded-2xl,
select.rounded-2xl,
input[class*="rounded-2xl"],
textarea[class*="rounded-2xl"],
.rounded-2xl.border input {
  border-radius: ${TOKENS.fieldRadius} !important;
}

.rounded-2xl.border,
.rounded-2xl.bg-surface,
.rounded-2xl.bg-surface-raised,
.rounded-\\[22px\\] {
  border-radius: ${TOKENS.cardRadius} !important;
}

[data-testid="chat-composer-shell"] {
  border-radius: ${TOKENS.composerRadius} !important;
}

span.rounded-full,
.inline-flex.rounded-full.border:not(button):not(a) {
  border-radius: ${TOKENS.chipRadius} !important;
  min-height: unset !important;
}

[data-testid="voice-stretch-pill"] {
  border-radius: ${TOKENS.chipRadius} !important;
}
`.trim();

  function removePreview() {
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(ROOT_ID)?.remove();
    delete window.__persaiClaudeGeometryPreview;
  }

  function mountBadge(active) {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.style.cssText =
        "position:fixed;bottom:16px;left:16px;z-index:2147483646;font:500 12px/1.2 ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;background:#f3efe6;border:1px solid rgba(0,0,0,.12);border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-width:260px";
      document.documentElement.appendChild(root);
    }
    root.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px">Claude geometry preview</div>
      <div style="opacity:.75;margin-bottom:8px;font-size:11px">CTA h ${TOKENS.ctaMinHeight} (−18%) · r ${TOKENS.ctaRadius}</div>
      <button type="button" data-action="toggle" style="border:1px solid rgba(0,0,0,.15);background:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;font:inherit;margin-right:6px">${active ? "Выключить" : "Включить"}</button>
      <button type="button" data-action="remove" style="border:none;background:transparent;color:#666;cursor:pointer;font:inherit;text-decoration:underline;padding:6px 0">Убрать</button>
    `;
    root.querySelector('[data-action="toggle"]')?.addEventListener("click", () => {
      window.__persaiClaudeGeometryPreview.toggle();
    });
    root.querySelector('[data-action="remove"]')?.addEventListener("click", () => {
      window.__persaiClaudeGeometryPreview.remove();
    });
  }

  function applyStyles() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.documentElement.appendChild(style);
    }
  }

  if (window.__persaiClaudeGeometryPreview) {
    window.__persaiClaudeGeometryPreview.toggle();
    return;
  }

  let active = false;

  window.__persaiClaudeGeometryPreview = {
    apply() {
      applyStyles();
      active = true;
      mountBadge(true);
    },
    remove() {
      removePreview();
    },
    toggle() {
      if (active) {
        document.getElementById(STYLE_ID)?.remove();
        active = false;
        mountBadge(false);
      } else {
        this.apply();
      }
    }
  };

  window.__persaiClaudeGeometryPreview.apply();
})();
