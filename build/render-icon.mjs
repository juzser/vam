/**
 * Renders build/icon.svg to PNG at a given size using the Playwright
 * Chromium already installed for e2e (never a downloaded image library).
 * The page is sized exactly to the target so what gets screenshotted is
 * what a dock/taskbar/tab would actually rasterize, not a downscale of a
 * bigger render.
 *
 * Usage: node build/render-icon.mjs <size> <outPath>
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const size = Number(process.argv[2]);
const outPath = process.argv[3];
if (!size || !outPath) {
  console.error('usage: node build/render-icon.mjs <size> <outPath>');
  process.exit(1);
}

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// Loaded by explicit path rather than a bare specifier: this script lives in
// build/, outside e2e/, so plain ESM resolution never finds e2e's hand-made
// node_modules (which has no package.json for `pnpm install` to rebuild).
const playwrightCoreEntry = path.join(repoRoot, 'e2e', 'node_modules', 'playwright-core', 'index.mjs');
const { chromium } = await import(pathToFileURL(playwrightCoreEntry).href);
const svg = readFileSync(path.join(repoRoot, 'build', 'icon.svg'), 'utf8');

const html = `<!doctype html><html><head><style>
  html,body{margin:0;padding:0;background:transparent;}
  svg{display:block;width:${size}px;height:${size}px;}
</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: size, height: size },
  deviceScaleFactor: 1,
});
await page.setContent(html);
await page.screenshot({ path: outPath, omitBackground: true });
await browser.close();
console.log(outPath);
