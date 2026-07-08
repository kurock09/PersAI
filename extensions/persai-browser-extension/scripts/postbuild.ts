import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const distDir = resolve(packageRoot, "dist");
const hostScriptsSource = resolve(repoRoot, "scripts", "browser-sites");
const hostScriptsTarget = resolve(distDir, "browser-sites");

async function main(): Promise<void> {
  await mkdir(distDir, { recursive: true });
  await cp(resolve(packageRoot, "manifest.json"), resolve(distDir, "manifest.json"));
  await cp(resolve(packageRoot, "popup.html"), resolve(distDir, "popup.html"));
  await mkdir(hostScriptsTarget, { recursive: true });
  await cp(hostScriptsSource, hostScriptsTarget, { recursive: true });
}

void main();
