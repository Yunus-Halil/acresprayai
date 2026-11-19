// Development only: the corn inspector's Layers panel, driven headless (playwright-core, as cornInspectShots.mjs):
// open a flight, press "Frozen preset", switch the layer options asked, wait for the field, score against the
// session's labels, and shoot the L5, L7, L8 and score steps. Console errors in the page are listed and fail the run.
//
//   node scripts/rowCrop/cornInspectLayersShots.mjs --base http://localhost:8092 --path <folder> --photo <name> --layers secondLook,unsureList --out <dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:8092"), PATH = arg("path"), OUT = resolve(arg("out", "data/corn-inspector/shots-layers-panel")), PHOTO = arg("photo", null);
const LAYERS = (arg("layers", "") || "").split(",").filter(Boolean);
const LABEL = { groundFromObvious: "2a.", coresBySize: "3a.", tooCloseFromSpread: "3b.", secondLook: "Second look where", unsureList: "Unsure list" };
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
const aside = () => page.evaluate(() => document.querySelector("aside")?.innerText ?? "");
const waitText = (re, ms = 1800000) => page.waitForFunction(([src, fl]) => new RegExp(src, fl).test(document.querySelector("aside")?.innerText ?? ""), [re.source, re.flags], { timeout: ms, polling: 2000 });
await page.goto(`${BASE}/dev/corn-inspector`, { waitUntil: "domcontentloaded" });
await page.fill("input >> nth=0", PATH);
await page.click("text=Open");
await page.waitForSelector("select");
if (PHOTO) await page.selectOption("select", PHOTO);
await page.click('button:has-text("Frozen preset (FINAL-3)")');
await waitText(/Field: done/);
for (const k of LAYERS) {
  const box = page.locator("label", { hasText: LABEL[k] }).locator('input[type="checkbox"]');
  await box.check();
  await page.waitForTimeout(3000);
}
// The field of the switched setup (Field: running, then done).
if (LAYERS.length) { await page.waitForTimeout(4000); await waitText(/Field: done/); }
await page.waitForTimeout(3000);
const shots = [["L5 Field profile", 5], ["L7 Second look", 7], ["L8 Report", 8]];
for (const [name, k] of shots) { await page.click(`button:has-text("${k}. ${name}")`); await page.waitForTimeout(2500); await page.screenshot({ path: join(OUT, `step${k}.png`) }); writeFileSync(join(OUT, `step${k}.txt`), await aside()); }
// The score: both setups on the dev tiles (labels are the session's).
const scoreBtn = page.locator('button:has-text("Score this photograph with both")');
if (await scoreBtn.count()) { await scoreBtn.click(); await waitText(/Dev tiles: found [+−-]?\d/); }
await page.click('button:has-text("9. Labels and score")'); await page.waitForTimeout(3000);
await page.screenshot({ path: join(OUT, "step9.png") }); writeFileSync(join(OUT, "step9.txt"), await aside());
writeFileSync(join(OUT, "errors.json"), JSON.stringify(errors, null, 1));
console.log(`layers ${LAYERS.join(",") || "(frozen preset)"}: shots in ${OUT}; console errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log("  " + e.slice(0, 300));
await browser.close();
process.exit(errors.length ? 1 : 0);
