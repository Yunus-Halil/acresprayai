// Live release check for the shipped weed classifier, in the real app, as a
// signed-in operator. Every model version should pass this before it ships:
//
//   loads -> scores -> popup -> operator override -> (saves -> reopens with the
//   model gone -> keeps the stored prediction -> separates operator truth) ->
//   survives a missing manifest and a missing model file
//
// It drives a Chrome you started and signed into yourself; it never handles a
// password or moves a session:
//
//   chrome --remote-debugging-port=9333 --user-data-dir=<scratch dir> <BASE>/auth
//   (sign in, leave the window open)
//   node tests/integration/weed-v1-live-validation.mjs --base <BASE> --task <scanId> [--write]
//
// Read-only by default: scans, reads scores and popups, flips verdicts in
// memory, never saves. `--write` adds the save / reopen / re-save checks; it
// writes two weed_observations rows tagged as a validation test and deletes
// them (and their chips) at the end. Run --write only with the account
// owner's go-ahead: those rows land in the shared archive until deleted.
//
// Exit code is the number of failed checks.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => {
  if (v.startsWith("--")) a.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return a;
}, []));
const BASE = String(args.base ?? "http://localhost:8080").replace(/\/$/, "");
const TASK = args.task;
const WRITE = args.write === true;
const CDP = String(args.cdp ?? "http://127.0.0.1:9333");
const NOTE = "VALIDATION TEST: not ground truth, delete";
if (!TASK) { console.error("--task <scanId> is required"); process.exit(2); }

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  | ${detail}` : ""}`);
};
const log = (...a) => console.log("....", ...a);

async function openScout(page) {
  await page.goto(`${BASE}/app/orthomosaic/${TASK}`);
  const btn = page.getByRole("button", { name: "Weed Scout" }).first();
  await btn.waitFor({ timeout: 60_000 });
  await btn.click();
  await page.getByRole("button", { name: /Scan this field/ }).waitFor({ timeout: 30_000 });
}

async function scan(page, label) {
  const t0 = Date.now();
  await page.getByRole("button", { name: /Scan this field/ }).click();
  const stages = new Set();
  const deadline = Date.now() + 40 * 60_000;
  while (Date.now() < deadline) {
    if (await page.getByText("Run details").count()) break;
    const err = await page.locator("aside .text-red-400").first().textContent({ timeout: 200 }).catch(() => null);
    if (err) throw new Error(`scan error: ${err}`);
    const stage = await page.locator("aside .animate-spin + span").first().textContent({ timeout: 200 }).catch(() => null);
    if (stage) stages.add(stage.replace(/\s\d+%$/, ""));
    await page.waitForTimeout(1000);
  }
  if (!(await page.getByText("Run details").count())) throw new Error("scan did not finish in 40 min");
  log(`${label}: ${Math.round((Date.now() - t0) / 1000)} s; ${[...stages].join(" > ")}`);
  await page.getByText("Run details").click();
  const notes = await page.locator("aside details", { has: page.locator("summary", { hasText: "Run details" }) }).innerText();
  const diag = page.locator('[data-testid="classifier-diagnostics"] > summary');
  if (await diag.count()) await diag.click();
  return { notes, stages: [...stages] };
}

const diagRows = page => page.$$eval('[data-testid="diag-row"]', trs => trs.map(tr => {
  const td = [...tr.querySelectorAll("td")].map(t => t.textContent.trim());
  return td.length >= 8
    ? { id: tr.dataset.spot, w: +td[1], c: +td[2], o: +td[3], cls: td[4], verdict: td[5], model: td[6] }
    : { id: tr.dataset.spot, w: null, verdict: td[2], model: td[3] };
}));

async function openPopup(page, id) {
  await page.locator(`[data-testid="diag-row"][data-spot="${id}"]`).click();
  const popup = page.locator(".leaflet-popup .scout-popup").last();
  await popup.waitFor({ timeout: 10_000 });
  return popup;
}

async function saveRow(page, id) {
  const row = page.locator(`[data-testid="diag-row"][data-spot="${id}"]`);
  await row.locator('[data-testid="diag-save"]').click();
  await row.locator('[data-testid="diag-save-state"] span').waitFor({ timeout: 60_000 });
  return row.locator('[data-testid="diag-save-state"]').getAttribute("title");
}

// The project URL and publishable key, as the app itself reads them.
const env = Object.fromEntries(readFileSync(".env", "utf8").split(/\r?\n/).filter(l => l.includes("="))
  .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const SB = { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY };

/** Supabase REST from inside the signed-in page, so the session never leaves it. */
const rest = (page, method, path, body) => page.evaluate(async ({ method, path, body, sb }) => {
  const tokenKey = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
  const s = JSON.parse(localStorage.getItem(tokenKey));
  const res = await fetch(`${sb.url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${s.access_token}`, apikey: sb.key, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}, { method, path, body, sb: SB });

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 1000 });
const consoleLines = [];
const watch = (p, tag) => {
  p.on("console", m => { if (m.type() === "error" || /weed-scout/.test(m.text())) consoleLines.push(`${tag} ${m.type()}: ${m.text()}`.slice(0, 300)); });
  p.on("pageerror", e => consoleLines.push(`${tag} pageerror: ${e.message}`.slice(0, 300)));
};
watch(page, "p1");
await page.goto(`${BASE}/app/fields`);
await page.evaluate(() => localStorage.setItem("swathwise.developer", JSON.stringify({ weedScout: true })));
const manifest = await page.evaluate(async () => (await fetch("/models/manifest.json", { cache: "no-cache" })).json()).catch(() => null);
const MODEL = manifest?.current;
log(`base ${BASE}, scan ${TASK}, model ${MODEL ?? "(none shipped)"}, ${WRITE ? "WRITE" : "read-only"}`);

const written = [];
try {
  check("a model is shipped", !!MODEL, MODEL);
  await openScout(page);
  const p1 = await scan(page, "model on");
  const cand = p1.notes.match(/Candidates\s+(\d+)/);
  check("shape detector produced candidates", cand && +cand[1] > 0, cand?.[0]);
  check("classifying stage ran", p1.stages.includes("Scoring plant spots"));
  const scoredNote = p1.notes.match(/Classifier \S+ scored \d+ plant spots?/)?.[0] ?? p1.notes.match(/Classifier[^\n]*/)?.[0];
  check(`${MODEL} scored eligible chips`, new RegExp(`Classifier ${MODEL} scored [1-9]`).test(scoredNote ?? ""), scoredNote);
  const rows = await diagRows(page);
  const scored = rows.filter(r => r.w != null);
  check("weed / crop / other returned, summing to ~100%", scored.length && scored.every(r => Math.abs(r.w + r.c + r.o - 100) <= 2), `${scored.length} of ${rows.length} chipped spots`);
  check("model version on every scored spot", scored.length && scored.every(r => r.model === MODEL));
  const expectV = w => (w >= 60 ? "Weed" : w < 40 ? "Not a weed" : "Unsure");
  const testable = scored.filter(r => /\(proposed\)/.test(r.verdict) && Math.abs(r.w - 60) > 0.5 && Math.abs(r.w - 40) > 0.5);
  const mism = testable.filter(r => !r.verdict.startsWith(`${expectV(r.w)} (`));
  check("starting verdict follows the thresholds", testable.length && !mism.length, `${testable.length} checked, ${mism.length} differ (past verdicts outrank the model)`);
  const band = { "<40": 0, "40-60": 0, ">=60": 0 };
  for (const r of scored) band[r.w < 40 ? "<40" : r.w < 60 ? "40-60" : ">=60"]++;
  log("pWeed bands:", JSON.stringify(band));

  const byW = [...scored].sort((a, b) => b.w - a.w);
  const A = byW[0], B = byW[byW.length - 1];
  let popup = await openPopup(page, A.id);
  const line = (await popup.innerText()).split("\n").find(l => l.startsWith("Model:"));
  check("popup shows this spot's confidence and version", new RegExp(`^Model: ${A.w}% weed .*${MODEL}\\. A suggestion, not a finding\\.`).test(line ?? ""), line);
  check("no accuracy claim in the popup", !/99%|accura|recall/i.test(await popup.innerText()));
  await popup.getByRole("button", { name: "Not a weed", exact: true }).click();
  if (WRITE) await popup.getByPlaceholder("Notes").fill(NOTE);
  popup = await openPopup(page, B.id);
  await popup.getByRole("button", { name: "Weed", exact: true }).click();
  if (WRITE) await popup.getByPlaceholder("Notes").fill(NOTE);
  const after = await diagRows(page);
  const a1 = after.find(r => r.id === A.id), b1 = after.find(r => r.id === B.id);
  check("operator override wins over the model", a1.verdict.startsWith("Not a weed (set by you") && b1.verdict.startsWith("Weed (set by you"), `${A.w}% -> ${a1.verdict}; ${B.w}% -> ${b1.verdict}`);
  check("model score untouched by the override", a1.w === A.w && b1.w === B.w);

  if (WRITE) {
    const cols = "id,candidate_id,verdict,verdict_source,prediction,model_version,chip_path,gsd_m,chip_gsd_m,field_id,captured_at,notes";
    check("two spots saved", (await saveRow(page, A.id)) === "saved" && (await saveRow(page, B.id)) === "saved");
    const db = await rest(page, "GET", `/rest/v1/weed_observations?select=${cols}&scan_id=eq.${TASK}&candidate_id=in.(${A.id},${B.id})`);
    written.push(...db);
    const ra = db.find(r => r.candidate_id === A.id), rb = db.find(r => r.candidate_id === B.id);
    check("stored: operator verdict beside the untouched prediction",
      ra?.verdict === "not_weed" && ra.verdict_source === "operator" && Math.round(ra.prediction?.pWeed * 100) === A.w && ra.model_version === MODEL &&
      rb?.verdict === "weed" && rb.verdict_source === "operator" && Math.round(rb.prediction?.pWeed * 100) === B.w,
      ra && `A ${ra.verdict}/${ra.verdict_source} p=${ra.prediction?.pWeed?.toFixed(3)} ${ra.prediction?.predictedClass} at ${ra.prediction?.inferredAt}`);
    check("evaluation metadata stored", ra?.chip_path && ra.gsd_m && ra.chip_gsd_m && ra.field_id && ra.captured_at);

    await page.route("**/models/manifest.json", r => r.fulfill({ status: 404, body: "" }));
    await openScout(page);
    await scan(page, "reopen, model gone");
    const r2 = await diagRows(page);
    const a2 = r2.find(r => r.id === A.id);
    check("reopened: saved operator verdict restored", a2?.verdict.startsWith("Not a weed (saved, operator)"), a2?.verdict);
    check("reopened: stored prediction shown", a2?.model === `${MODEL} (stored)` && a2.w === A.w, `${a2?.model} ${a2?.w}`);
    popup = await openPopup(page, A.id);
    check("reopened popup shows the score saved with the verdict", new RegExp(`When saved: Model: ${A.w}% weed`).test(await popup.innerText()));
    await saveRow(page, A.id);
    const ra2 = (await rest(page, "GET", `/rest/v1/weed_observations?select=${cols}&id=eq.${ra.id}`))[0];
    check("re-save with no model keeps the stored prediction", ra2?.prediction?.pWeed === ra.prediction.pWeed && ra2.verdict_source === "operator");
    await page.unroute("**/models/manifest.json");
  }

  for (const [label, pattern, expectNote] of [
    ["manifest missing", "**/models/manifest.json", /No classifier is shipped in this build/],
    ["model file missing", `**/models/${MODEL}.onnx`, new RegExp(`Classifier ${MODEL} could not be loaded`)],
  ]) {
    const p = await ctx.newPage();
    watch(p, label);
    await p.setViewportSize({ width: 1600, height: 1000 });
    await p.route(pattern, r => r.fulfill({ status: 404, body: "" }));
    await openScout(p);
    const res = await scan(p, label);
    check(`scan completes safely: ${label}`, /Candidates\s+\d+/.test(res.notes) && expectNote.test(res.notes), res.notes.split("\n").find(l => /lassifier/.test(l)));
    await p.close();
  }
} catch (e) {
  check("run completed", false, e.message);
} finally {
  if (written.length) {
    const rows = await rest(page, "GET", `/rest/v1/weed_observations?select=id,notes,chip_path&id=in.(${written.map(r => r.id).join(",")})`);
    const ours = rows.filter(r => r.notes === NOTE);
    if (ours.length) {
      await rest(page, "DELETE", `/rest/v1/weed_observations?id=in.(${ours.map(r => r.id).join(",")})`);
      const chips = ours.map(r => r.chip_path).filter(Boolean);
      if (chips.length) await rest(page, "DELETE", "/storage/v1/object/weed-chips", { prefixes: chips });
    }
    const left = await rest(page, "GET", `/rest/v1/weed_observations?select=id&id=in.(${written.map(r => r.id).join(",")})`);
    check("validation rows deleted", left.length === 0, `${ours.length} deleted`);
  }
  for (const l of [...new Set(consoleLines)].slice(0, 30)) console.log(l);
  const failed = results.filter(r => !r.ok).length;
  console.log(`---- ${results.length - failed}/${results.length} checks passed ----`);
  await page.close().catch(() => {});
  process.exit(failed);
}
