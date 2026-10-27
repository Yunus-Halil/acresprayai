// Screenshots of the public website at four screen sizes, section by section, through the installed Chrome.
//
//   npx vite --port 8081          (in another terminal)
//   node scripts/site/siteShots.mjs [--base http://localhost:8081] [--out data/site-shots] [--reduced]
//
// A full-page capture cannot show the scroll-driven Field Twin section (the page is taller than any capture
// and the section is sticky), so each size gets one screenshot per moment that matters, plus overview.jpg,
// the moments stacked in order. --reduced captures with prefers-reduced-motion set.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:8081");
const REDUCED = argv.includes("--reduced");
const OUT = resolve(arg("out", REDUCED ? "data/site-shots-reduced" : "data/site-shots"));
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SIZES = [
  { name: "desktop", width: 1920, height: 1080, scale: 1 },
  { name: "laptop", width: 1440, height: 900, scale: 1 },
  { name: "tablet", width: 834, height: 1112, scale: 1 },
  { name: "mobile", width: 390, height: 844, scale: 2 },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const report = {};
for (const size of SIZES) {
  const dir = join(OUT, size.name);
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, reducedMotion: REDUCED ? "reduce" : "no-preference" });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  const marks = await page.evaluate(() => {
    const top = sel => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().top + window.scrollY : null; };
    const canvas = document.querySelector("#beyond canvas");
    const track = canvas ? canvas.parentElement.parentElement : null;
    const t = track ? { top: track.getBoundingClientRect().top + window.scrollY, height: track.offsetHeight } : null;
    return { beyond: top("#beyond"), track: t, plant: top("#plant"), operations: top("#operations"), who: top("#who"), access: top("#access"), end: document.documentElement.scrollHeight - window.innerHeight, vh: window.innerHeight };
  });
  const moments = [["01-hero", 0], ["02-beyond", marks.beyond]];
  if (marks.track) {
    const span = marks.track.height - marks.vh;
    for (const [n, p] of [["03-field", 0.05], ["04-crop", 0.3], ["05-plant", 0.62], ["06-finding", 0.82], ["07-evidence", 0.97]]) moments.push([n, marks.track.top + span * p]);
  } else {
    moments.push(["03-stills", marks.beyond + marks.vh * 0.7], ["04-stills", marks.beyond + marks.vh * 1.6]);
  }
  moments.push(["08-plant", marks.plant], ["09-operations", marks.operations], ["10-operations", marks.operations + marks.vh * 0.85],
    ["11-who", marks.who], ["12-who", marks.who + marks.vh * 0.8], ["13-access", marks.access], ["14-end", marks.end]);

  const files = [];
  for (const [name, y] of moments) {
    // Walk there in steps so the scroll listeners and reveal observers see the page as a visitor would.
    const from = await page.evaluate(() => window.scrollY);
    const steps = 8;
    for (let k = 1; k <= steps; k++) { await page.evaluate(v => window.scrollTo(0, v), from + (y - from) * k / steps); await page.waitForTimeout(40); }
    await page.waitForTimeout(1100);
    const f = join(dir, `${name}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  report[size.name] = { errors, horizontalOverflowPx: overflow, pageHeight: marks.end + marks.vh, shots: files.length };
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
