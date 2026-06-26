const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SVG_PATH = path.join(__dirname, 'favicon.svg');
const OUT = __dirname;

const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192x192.png', size: 192 },
  { name: 'icon-512x512.png', size: 512 },
];

(async () => {
  const svg = fs.readFileSync(SVG_PATH);
  for (const { name, size } of sizes) {
    await sharp(svg).resize(size, size).png().toFile(path.join(OUT, name));
    console.log(`  ${name} (${size}x${size})`);
  }
  console.log('Done.');
})();
