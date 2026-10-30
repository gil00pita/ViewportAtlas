import sharp from "sharp";
import { mkdir } from "node:fs/promises";
await mkdir("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128])
  await sharp("public/viewport-atlas-logo.svg")
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}.png`);
console.log("Generated Chrome icons from the supplied SVG.");
