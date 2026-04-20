import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = resolve(__dir, "../public");

const icon = readFileSync(resolve(pub, "icon.svg"));
const maskable = readFileSync(resolve(pub, "icon-maskable.svg"));

const targets = [
  { src: icon,     size: 16,  name: "favicon-16.png" },
  { src: icon,     size: 32,  name: "favicon-32.png" },
  { src: icon,     size: 180, name: "apple-icon.png" },
  { src: icon,     size: 192, name: "icon-192.png" },
  { src: icon,     size: 512, name: "icon-512.png" },
  { src: maskable, size: 512, name: "icon-512-maskable.png" },
];

for (const { src, size, name } of targets) {
  await sharp(src)
    .resize(size, size)
    .png()
    .toFile(resolve(pub, name));
  console.log(`✓ ${name} (${size}×${size})`);
}
