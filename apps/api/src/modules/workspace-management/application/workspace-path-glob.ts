const RG_TYPE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  js: [".js", ".jsx", ".mjs", ".cjs"],
  ts: [".ts", ".tsx", ".mts", ".cts"],
  py: [".py"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
  md: [".md", ".markdown"],
  json: [".json"],
  yaml: [".yaml", ".yml"],
  xml: [".xml"],
  html: [".html", ".htm"],
  css: [".css"],
  txt: [".txt", ".log"]
};

export function globPatternToRegExp(pattern: string): RegExp {
  let regex = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*") {
      const next = pattern[index + 1];
      if (next === "*") {
        regex += ".*";
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
        }
      } else {
        regex += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    regex += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  regex += "$";
  return new RegExp(regex);
}

export function matchesWorkspaceGlob(input: {
  filePath: string;
  searchRoot: string;
  pattern: string;
}): boolean {
  const relative =
    input.filePath === input.searchRoot
      ? (input.filePath.split("/").pop() ?? input.filePath)
      : input.filePath.startsWith(`${input.searchRoot}/`)
        ? input.filePath.slice(input.searchRoot.length + 1)
        : input.filePath;
  const basename = relative.split("/").pop() ?? relative;
  const matcher = globPatternToRegExp(input.pattern);
  return matcher.test(relative) || matcher.test(basename);
}

export function pathMatchesRipgrepType(filePath: string, type: string): boolean {
  const normalized = type.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  const extensions = RG_TYPE_EXTENSIONS[normalized];
  if (extensions !== undefined) {
    const lower = filePath.toLowerCase();
    return extensions.some((ext) => lower.endsWith(ext));
  }
  return filePath.toLowerCase().endsWith(`.${normalized}`);
}
