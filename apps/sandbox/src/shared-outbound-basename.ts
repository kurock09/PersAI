/**
 * ADR-126 D8 — macOS-style numeric suffix collision for shared-outbound basenames.
 * `report.pdf` → `report (2).pdf` → `report (3).pdf`.
 */
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
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem} (${index})${ext}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }
  return `${stem} (${Date.now()})${ext}`;
}
