// One-off slicer for the premium landing channel icons (set 4).
// Source: a 1024×1024 PNG with 4 squircle icons in a 2×2 grid (transparent
// background, soft drop shadow that fades into alpha). We crop each quadrant,
// trim near-transparent edges with a threshold low enough to keep the drop
// shadow intact, and write 384×384 PNGs at default compression.
//
// Run from repo root:
//   node scripts/slice-channel-icons.mjs <source-png>

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const sourceArg = process.argv[2];
if (!sourceArg) {
  console.error("Usage: node scripts/slice-channel-icons.mjs <source-png>");
  process.exit(1);
}
const sourcePath = path.resolve(sourceArg);

const targetDir = path.join(repoRoot, "apps/web/public/landing/channels");

const QUADRANTS = [
  { name: "web", left: 0, top: 0 },
  { name: "telegram", left: 512, top: 0 },
  { name: "android", left: 0, top: 512 },
  { name: "ios", left: 512, top: 512 }
];

const FINAL_SIZE = 384;

const meta = await sharp(sourcePath).metadata();
console.log(
  `source: ${sourcePath} (${meta.width}×${meta.height}, ${meta.channels} ch, alpha=${meta.hasAlpha})`
);
if (meta.width !== 1024 || meta.height !== 1024) {
  console.warn(
    `! source is not 1024x1024 — quadrant offsets are hardcoded for that grid; verify output before committing`
  );
}

/**
 * Find the alpha-bounding box of an RGBA buffer: the smallest rect that
 * contains every pixel whose alpha exceeds `alphaThreshold`. We use a small
 * threshold (rather than 0) so faint drop-shadow tails do not falsely extend
 * the box; that keeps the icon visually centered while still preserving the
 * meaningful shadow halo (which lives at much higher alpha than the tail).
 */
function alphaBoundingBox(rgba, width, height, alphaThreshold = 8) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

for (const q of QUADRANTS) {
  const out = path.join(targetDir, `${q.name}.png`);

  // Step 1 — extract the raw quadrant pixels.
  const quadrantBuffer = await sharp(sourcePath)
    .extract({ left: q.left, top: q.top, width: 512, height: 512 })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Step 2 — find the icon's actual alpha bounding box. The source isn't
  // perfectly centered inside each 512×512 quadrant, so a naive crop leaves
  // the icon visibly off-center inside the final PNG.
  const box = alphaBoundingBox(quadrantBuffer, 512, 512);
  if (!box) {
    console.error(`  ${q.name}: empty alpha — skipping`);
    continue;
  }

  // Step 3 — re-extract the icon tightly to its alpha bounding box. We
  // commit this to an intermediate PNG buffer so the next sharp() pipeline
  // sees a clean square-friendly input rather than chaining multiple
  // geometric operations on a single pipeline (which proved unreliable).
  const tightBuffer = await sharp(sourcePath)
    .extract({
      left: q.left + box.left,
      top: q.top + box.top,
      width: box.width,
      height: box.height
    })
    .png()
    .toBuffer();

  // Step 4 — extend back to a square canvas with equal padding on all sides
  // (12% of the icon's longest side keeps the soft drop-shadow tail without
  // leaving huge dead space), then resize to FINAL_SIZE.
  const maxDim = Math.max(box.width, box.height);
  const padding = Math.round(maxDim * 0.12);
  const canvasSize = maxDim + padding * 2;
  const padX = Math.round((canvasSize - box.width) / 2);
  const padY = Math.round((canvasSize - box.height) / 2);

  const extendedBuffer = await sharp(tightBuffer)
    .extend({
      top: padY,
      bottom: canvasSize - box.height - padY,
      left: padX,
      right: canvasSize - box.width - padX,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  await sharp(extendedBuffer)
    .resize(FINAL_SIZE, FINAL_SIZE, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toFile(out);
  const info = await sharp(out).metadata();
  console.log(
    `  ${q.name} → ${path.relative(repoRoot, out)} ` +
      `(icon ${box.width}×${box.height} @ ${box.left},${box.top}, ` +
      `canvas ${canvasSize}×${canvasSize} → ${info.width}×${info.height})`
  );
}
