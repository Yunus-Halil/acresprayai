// Development only: screenshots of the corn inspector, every step, through a headless Chrome (playwright-core, as
// scripts/directGeoref/twinShots.mjs). Console errors in the page are listed and fail the run.
//
//   node scripts/rowCrop/cornInspectShots.mjs --base http://localhost:8091 --path <folder or photo> --out <dir> [--photo <name>] [--click u,v]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:8080"), PATH = arg("path"), OUT = resolve(arg("out", "data/corn-inspector/shots")), PHOTO = arg("photo", null);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`${BASE}/dev/corn-inspector`, { waitUntil: "domcontentloaded" });
await page.fill("input >> nth=0", PATH);
await page.click("text=Open");
if (PHOTO) { await page.waitForSelector("select"); await page.selectOption("select", PHOTO); }
// Wait for the photograph's views and, for a flight, the field.
await page.waitForFunction(() => !document.body.innerText.includes("Loading the photograph"), null, { timeout: 600000 });
await page.waitForFunction(() => /This photograph: done/.test(document.body.innerText), null, { timeout: 900000 });
const flight = await page.evaluate(() => /Flight:/.test(document.body.innerText));
if (flight) await page.waitForFunction(() => /Field: done/.test(document.body.innerText), null, { timeout: 900000 });
await page.waitForTimeout(1500);
const steps = ["Views", "Marks in this photo", "Placed on the ground", "Obvious plants", "What it learned", "Judged", "Report"];
for (let k = 0; k < steps.length; k++) {
  await page.click(`button:has-text("${k + 1}. ${steps[k]}")`);
  await page.waitForTimeout(k === 2 ? 4000 : 1200);
  await page.screenshot({ path: join(OUT, `step${k + 1}.png`) });
  if (k === 0) for (const v of ["Green view", "Cores view"]) { await page.click(`button:has-text("${v}")`); await page.waitForTimeout(1500); await page.screenshot({ path: join(OUT, `step1-${v.split(" ")[0].toLowerCase()}.png`) }); }
  if (k === 5 && flight) {
    // Zoom in at the canvas centre and click near the middle: a dot's panel.
    const box = await page.locator("canvas").boundingBox();
    for (let z = 0; z < 3; z++) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -400); await page.waitForTimeout(150); }
    await page.waitForTimeout(800); await page.screenshot({ path: join(OUT, "step6-zoom.png") });
    // Click over a grid near the middle until a dot's panel opens.
    let got = false;
    for (let gy = -120; gy <= 120 && !got; gy += 20) for (let gx = -200; gx <= 200 && !got; gx += 20) {
      await page.mouse.click(box.x + box.width / 2 + gx, box.y + box.height / 2 + gy); await page.waitForTimeout(120);
      got = await page.evaluate(() => /(^|\n)Dot \d+\n/.test(document.querySelector("aside")?.innerText ?? ""));
    }
    await page.screenshot({ path: join(OUT, "step6-dot.png") });
    writeFileSync(join(OUT, "dot-panel.txt"), got ? await page.evaluate(() => document.querySelector("aside")?.innerText ?? "") : "no dot was hit");
  }
}
const text = await page.evaluate(() => document.querySelector("aside")?.innerText ?? "");
writeFileSync(join(OUT, "panel.txt"), text);
writeFileSync(join(OUT, "errors.json"), JSON.stringify(errors, null, 1));
console.log(`${steps.length} steps shot into ${OUT}; console errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log("  " + e.slice(0, 300));
await browser.close();
process.exit(errors.length ? 1 : 0);
