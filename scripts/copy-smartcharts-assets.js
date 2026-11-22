import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'node_modules', '@deriv-com', 'smartcharts-champion', 'dist');
const DEST = path.join(ROOT, 'public');

if (!fs.existsSync(SOURCE)) {
  console.warn(`[copy-smartcharts-assets] skip: source not found at ${SOURCE}`);
  process.exit(0);
}

const SW_EXCLUSIONS = new Set(['flutter_bootstrap.js', 'flutter_service_worker.js']);

fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(SOURCE, DEST, {
  recursive: true,
  force: true,
  filter: (src) => !SW_EXCLUSIONS.has(path.basename(src)),
});

for (const file of SW_EXCLUSIONS) {
  const target = path.join(DEST, 'chart', file);
  if (fs.existsSync(target)) {
    fs.rmSync(target);
  }
}

console.log(`[copy-smartcharts-assets] copied ${SOURCE} -> ${DEST}`);
