// Renders the app and tray icons in resources/ from the Lictory mark
// (apps/platform/static/icon.svg). The PNGs are committed; run this again
// only when the mark changes: `node icons.mjs`.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const tile = await readFile(
  new URL("../platform/static/icon.svg", import.meta.url),
  "utf8",
);
// The mark alone, for the monochrome macOS menu bar (a template image).
const mark = (
  await readFile(
    new URL(
      "../../packages/ui/public/brand/lictory-logomark.svg",
      import.meta.url,
    ),
    "utf8",
  )
).replace('color="#FFFFFF"', 'color="#000000"');

/** @param {string} svg @param {number} size @param {number} inset */
async function png(svg, size, inset = 0) {
  const inner = size - inset * 2;
  const image = await sharp(Buffer.from(svg), { density: 72 * (inner / 16) })
    .resize(inner, inner, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: image, left: inset, top: inset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** @param {string} name */
const out = (name) => new URL(`resources/${name}`, import.meta.url);
// The macOS icon grid leaves a margin around the tile; the same file serves
// Windows and Linux.
await writeFile(out("icon.png"), await png(tile, 1024, 100));
await writeFile(out("tray.png"), await png(tile, 32, 1));
await writeFile(out("trayTemplate.png"), await png(mark, 16, 1));
await writeFile(out("trayTemplate@2x.png"), await png(mark, 32, 2));
console.log("Wrote resources/icon.png, tray.png, trayTemplate(@2x).png");
