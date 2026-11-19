// Development only (APP-1, 2026-11-18): photographs through the app's own Photo Scout in the installed Chrome,
// headless, on the dev route /dev/photo-scout (the same page as /app/photo, without a sign-in). The corn read's own
// marks are taken from window.__photoScout (a development build only) and written for the scorer
// (cornInspect.ts score --marks). Console errors in the page fail the run.
//
//   node scripts/rowCrop/cornPhotoScoutRun.mjs --base http://localhost:8094 --out <dir> <photo.jpg>...
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:8094"), OUT = resolve(arg("out", "photo-scout"));
const files = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/weed-vision|status of 50[02]/.test(m.text())) errors.push(m.text()); });
await page.goto(`${BASE}/dev/photo-scout`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[type="file"]', { state: "attached", timeout: 180000 });
for (const f of files) {
  const name = basename(f), t0 = Date.now();
  await page.setInputFiles('input[type="file"]', f);
  await page.waitForFunction(n => !!window.__photoScout?.[n], name, { timeout: 900000, polling: 1000 });
  const got = await page.evaluate(n => window.__photoScout[n], name);
  writeFileSync(join(OUT, `${name.replace(/\.[^.]+$/, "")}.marks.json`), JSON.stringify(got));
  console.log(`${name}: preset ${got.preset}, ${got.marks.length} marks, ${got.rows} rows, count withheld ${got.withheld}, ${got.width} x ${got.height}, ${Date.now() - t0} ms`);
}
writeFileSync(join(OUT, "errors.json"), JSON.stringify(errors, null, 1));
console.log(`console errors: ${errors.length}`); for (const e of errors.slice(0, 5)) console.log("  " + e.slice(0, 300));
await browser.close();
process.exit(errors.length ? 1 : 0);
