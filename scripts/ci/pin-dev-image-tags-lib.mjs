/**
 * Authoritative pin surface for `scripts/ci/pin-dev-image-tags.mjs`.
 *
 * Keep service → section mapping and the `  image:` / `    tag:` walk here so
 * detect-affected classification cannot drift from what the pin script writes.
 */

export const PIN_DEV_IMAGE_SERVICE_TO_SECTION = Object.freeze({
  api: "api",
  runtime: "runtime",
  web: "web",
  "provider-gateway": "providerGateway",
  sandbox: "sandbox",
  "sandbox-exec": "sandboxExec"
});

export const PIN_DEV_IMAGE_SECTIONS = Object.freeze(
  new Set(Object.values(PIN_DEV_IMAGE_SERVICE_TO_SECTION))
);

/** Exact line shape written by the pin script (`    tag: <sha>`). */
export const PIN_DEV_IMAGE_TAG_LINE_PREFIX = "    tag:";

const PINABLE_TAG_SENTINEL = "__PERSAI_PIN_DEV_IMAGE_TAG__";

/**
 * Walk values-dev.yaml exactly like `pin-dev-image-tags.mjs`:
 * top-level section → `  image:` block → first `    tag:` scalar.
 *
 * @param {string} fileText
 * @returns {{ tags: Map<string, string>, normalized: string, ok: boolean }}
 */
export function analyzePinableServiceImageTags(fileText) {
  if (typeof fileText !== "string") {
    return { tags: new Map(), normalized: "", ok: false };
  }

  const lines = fileText.split(/\r?\n/u);
  const normalizedLines = lines.slice();
  const tags = new Map();
  let currentSection = "";
  let inImageBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const topLevelMatch = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*$/u);
    if (topLevelMatch) {
      currentSection = topLevelMatch[1];
      inImageBlock = false;
      continue;
    }

    if (!PIN_DEV_IMAGE_SECTIONS.has(currentSection)) {
      continue;
    }

    if (line === "  image:") {
      inImageBlock = true;
      continue;
    }

    if (inImageBlock && /^  [A-Za-z]/u.test(line)) {
      inImageBlock = false;
    }

    if (inImageBlock && /^    tag:\s*/u.test(line)) {
      const value = line.replace(/^    tag:\s*/u, "").replace(/\s+$/u, "");
      tags.set(currentSection, value);
      normalizedLines[index] = `${PIN_DEV_IMAGE_TAG_LINE_PREFIX} ${PINABLE_TAG_SENTINEL}`;
      inImageBlock = false;
    }
  }

  return {
    tags,
    normalized: normalizedLines.join("\n"),
    ok: true
  };
}

/**
 * Apply the same mutation the pin CLI writes for one or more services.
 * Used by resume mutation asserts and tests as the authoritative expected body.
 *
 * Write shape: `lines.join("\n")`, then ensure a single POSIX trailing newline
 * only when the joined body does not already end with `\n`. Never append an
 * extra blank line after a file that already ends in newline — the historical
 * `writeFileSync(\`${join}\\n\`)` form accumulated EOF blanks and failed live
 * `assert-resume-pin-state` against this helper.
 *
 * @param {string} fileText
 * @param {string[]} serviceNames deploy service ids (api, web, …)
 * @param {string} sha
 * @returns {string}
 */
export function applyPinDevImageTags(fileText, serviceNames, sha) {
  const targetSections = new Set(
    serviceNames.map((service) => {
      const section = PIN_DEV_IMAGE_SERVICE_TO_SECTION[service];
      if (!section) {
        throw new Error(`Unsupported service: ${service}`);
      }
      return section;
    })
  );

  const lines = String(fileText).split(/\r?\n/u);
  let currentSection = "";
  let inImageBlock = false;
  const updatedSections = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const topLevelMatch = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*$/u);
    if (topLevelMatch) {
      currentSection = topLevelMatch[1];
      inImageBlock = false;
      continue;
    }

    if (!targetSections.has(currentSection)) {
      continue;
    }

    if (line === "  image:") {
      inImageBlock = true;
      continue;
    }

    if (inImageBlock && /^  [A-Za-z]/u.test(line)) {
      inImageBlock = false;
    }

    if (inImageBlock && /^    tag:\s*/u.test(line)) {
      lines[index] = line.replace(/^    tag:\s*.*/u, `${PIN_DEV_IMAGE_TAG_LINE_PREFIX} ${sha}`);
      updatedSections.add(currentSection);
      inImageBlock = false;
    }
  }

  for (const section of targetSections) {
    if (!updatedSections.has(section)) {
      throw new Error(`Expected to update image tag for section "${section}".`);
    }
  }

  const joined = lines.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}
