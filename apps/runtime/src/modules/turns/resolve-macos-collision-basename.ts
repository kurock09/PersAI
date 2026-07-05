/** ADR-131 Block 1 — macOS-style numeric suffix collision for workspace filenames. */
export function resolveMacOsCollisionBasename(
  basename: string,
  existingNames: ReadonlySet<string>
): string {
  if (!existingNames.has(basename)) {
    return basename;
  }
  const dotIdx = basename.lastIndexOf(".");
  const stem = dotIdx > 0 ? basename.slice(0, dotIdx) : basename;
  const ext = dotIdx > 0 ? basename.slice(dotIdx) : "";
  const suffixMatch = /^(.*) \((\d+)\)$/.exec(stem);
  const baseStem = suffixMatch?.[1] ?? stem;
  const startIndex = suffixMatch ? Number(suffixMatch[2]) + 1 : 1;
  for (let index = startIndex; index < 10_000; index += 1) {
    const candidate = `${baseStem} (${index})${ext}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }
  return `${baseStem} (${Date.now()})${ext}`;
}
