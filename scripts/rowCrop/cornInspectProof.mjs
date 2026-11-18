// Development only: the inspector's own page, driven in a headless Chrome (playwright-core, the installed Chrome):
// open a flight, load a labels file, score a photograph's dev tiles with the defaults, then with a preset, and print
// the score table the page shows. Screenshots of step 8 for each. Console errors are listed.
//
//   node scripts/rowCrop/cornInspectProof.mjs --base http://localhost:8093 --path <folder> --labels <file> --photo <name> --preset "<preset name>" --out <dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg("base"), PATH = arg("path"), LABELS = arg("labels"), PHOTO = arg("photo"), PRESET = arg("preset"), OUT = resolve(arg("out", "data/corn-inspector/proof"));
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
const aside = () => page.evaluate(() => document.querySelector("aside")?.innerText ?? "");
const until = async (re, ms = 1200000) => page.waitForFunction(([src, flags]) => new RegExp(src, flags).test(document.querySelector("aside")?.innerText ?? ""), [re.source, re.flags], { timeout: ms, polling: 1000 });
await page.goto(`${BASE}/dev/corn-inspector`, { waitUntil: "domcontentloaded" });
await page.fill("input >> nth=0", PATH);
await page.click("text=Open");
await page.waitForSelector("select");
await page.selectOption("select >> nth=0", PHOTO);
await until(/Field: done/);
await page.click('button:has-text("8. Labels and score")');
await page.setInputFiles('input[type="file"]', LABELS);
await until(/Loaded:/);
await page.waitForTimeout(3000);
await page.locator('button:has-text("Score this photograph")').dispatchEvent("click");
await until(/^Defaults\t/m);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, "defaults.png") });
const t1 = await aside(); writeFileSync(join(OUT, "defaults.txt"), t1);
console.log("DEFAULTS:\n" + t1.split("\n").filter(l => /^(Dev tiles|Defaults|This setup)/.test(l)).join("\n"));
await page.locator(`button:has-text("${PRESET}")`).dispatchEvent("click");
// The new setup's jobs first show as waiting or running; then its field is done.
await page.waitForTimeout(5000);
await until(/Applied: /);
await until(/^Field: done/m);
await page.waitForTimeout(3000);
await page.locator('button:has-text("Score this photograph")').dispatchEvent("click");
await until(/^This setup\t/m);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, "preset.png") });
const t2 = await aside(); writeFileSync(join(OUT, "preset.txt"), t2);
console.log(`${PRESET}:\n` + t2.split("\n").filter(l => /^(Dev tiles|Defaults|This setup)/.test(l)).join("\n"));
// The other steps with the comparison on: one screenshot each.
for (const [k, s] of [[2, "Marks in this photo"], [6, "Judged"], [7, "Report"]]) { await page.locator(`button:has-text("${k}. ${s}")`).dispatchEvent("click"); await page.waitForTimeout(2500); await page.screenshot({ path: join(OUT, `preset-step${k}.png`) }); }
writeFileSync(join(OUT, "errors.json"), JSON.stringify(errors, null, 1));
console.log(`console errors: ${errors.length}`); for (const e of errors.slice(0, 8)) console.log("  " + e.slice(0, 300));
await browser.close();
