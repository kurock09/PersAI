import { pathToFileURL } from "node:url";

async function run(): Promise<void> {
  const [modulePath] = process.argv.slice(2);
  if (!modulePath) {
    throw new Error("Usage: tsx test/run-one.ts <modulePath>");
  }
  const loaded = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
  const runners = Object.entries(loaded)
    .filter(([name, value]) => /^run.+Test$/u.test(name) && typeof value === "function")
    .sort(([left], [right]) => left.localeCompare(right));

  if (runners.length === 0) {
    return;
  }
  // Every exported `run*Test` function is a file entry point. Shared helpers
  // must not be exported; this replaces the old hand-maintained selection list.
  for (const [, candidate] of runners) {
    await (candidate as () => Promise<void>)();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
