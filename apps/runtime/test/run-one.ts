import { pathToFileURL } from "node:url";

async function run(): Promise<void> {
  const [modulePath, exportName] = process.argv.slice(2);
  if (!modulePath || !exportName) {
    throw new Error("Usage: tsx test/run-one.ts <modulePath> <exportName>");
  }
  const moduleUrl = pathToFileURL(modulePath).href;
  const loaded = (await import(moduleUrl)) as Record<string, unknown>;
  const candidate = loaded[exportName];
  if (typeof candidate !== "function") {
    throw new Error(`Export "${exportName}" was not found in ${modulePath}.`);
  }
  await (candidate as () => Promise<void>)();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
