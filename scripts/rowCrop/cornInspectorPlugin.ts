// Development only: the dev server's side of the corn inspector (/dev/corn-inspector). `apply: "serve"`: never part
// of a build. It keeps sessions under data/corn-inspector/ (git-ignored) and runs scripts/rowCrop/cornInspect.ts in
// child processes, so the page waits on files and the dev server stays free. It reads only the folder or photograph
// it is given (and a labels file the page sends), and serves only that folder's photographs and its own cache.
//
//   POST /__corn-inspector/open   { path, analysis? }               a flight's folder or one photograph: a session
//   GET  /__corn-inspector/session/<id>                             the session: photographs, setups, jobs
//   POST /__corn-inspector/setup/<id>   { read, field }             a setup of the options: reads (if new) then the field
//   POST /__corn-inspector/photo/<id>/<name>   { read }             one photograph's views and marks (once; cached)
//   POST /__corn-inspector/labels/<id>   <the labeler's JSON>       labels for this session
//   POST /__corn-inspector/score/<id>   { setup, name, hidden, spend }   a photograph scored against the labels;
//                                                                   the held-back tiles only with spend: "spend"
//   GET  /__corn-inspector/hidden-spent                             every hidden-half check spent (data/corn-inspector/hidden-spent.json)
//   GET  /__corn-inspector/photo-file/<id>/<name>                   the photograph itself
//   GET  /__corn-inspector/cache/<id>/<path>                        a file the jobs wrote
//   GET  /__corn-inspector/known                                    analysis records found on this computer
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, resolve, sep } from "node:path";
import type { Plugin } from "vite";

type Job = { state: "waiting" | "running" | "done" | "failed"; started?: number; ended?: number; log?: string; error?: string; done?: number; total?: number };
type Options = Record<string, unknown>;
type Setup = { key: string; readKey: string; fieldKey: string; read: Options; field: Options; fieldJob?: Job };
type Session = {
  id: string; kind: "flight" | "photo"; path: string; created: number;
  photos: { name: string; file: string }[];
  analysis: string | null; analysisSource: string | null;
  build?: Job; reads: Record<string, Job>; setups: Record<string, Setup>; photoJobs: Record<string, Job>; scores: Record<string, Job>;
  labels: { images: { image: string; plants: number; unsure: number }[] } | null;
};
const sortDeep = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v as Options).sort().map(k => [k, sortDeep((v as Options)[k])])) : v);
/** An options object's key: "default" when it asks nothing, else a short hash of it. */
const keyOf = (o: Options) => (Object.keys(o).length ? createHash("sha1").update(JSON.stringify(sortDeep(o))).digest("hex").slice(0, 10) : "default");

export function cornInspectorDev(root: string): Plugin {
  const DATA = resolve(root, "data/corn-inspector"), VITE_NODE = resolve(root, "node_modules/vite-node/vite-node.mjs"), SCRIPT = resolve(root, "scripts/rowCrop/cornInspect.ts"), SPENT = join(DATA, "hidden-spent.json");
  const sessions = new Map<string, Session>(), running = new Set<ChildProcess>();
  const dirOf = (s: Session) => join(DATA, "sessions", s.id), readsDir = (s: Session, rk: string) => join(dirOf(s), `R-${rk}`), fieldDir = (s: Session, st: Setup) => join(readsDir(s, st.readKey), `F-${st.fieldKey}`);
  const save = (s: Session) => { mkdirSync(dirOf(s), { recursive: true }); writeFileSync(join(dirOf(s), "session.json"), JSON.stringify(s, null, 1)); };
  const load = (id: string): Session | null => {
    if (sessions.has(id)) return sessions.get(id)!;
    const f = join(DATA, "sessions", id, "session.json"); if (!/^[a-f0-9]{16}$/.test(id) || !existsSync(f)) return null;
    const s = JSON.parse(readFileSync(f, "utf8")) as Session;
    if (!s.setups) return null; // a session of pass 1: opened again from scratch
    for (const j of [s.build, ...Object.values(s.reads), ...Object.values(s.setups).map(x => x.fieldJob), ...Object.values(s.photoJobs), ...Object.values(s.scores)]) if (j && (j.state === "running" || j.state === "waiting")) { j.state = "failed"; j.error = "the dev server stopped while it ran"; }
    // A job said done whose files are gone (a cache cleared, or made by an older version): forgotten, to be run again.
    for (const k of Object.keys(s.photoJobs)) { const [rk, name] = k.split("/"), f = join(readsDir(s, rk), "photo", name, "info.json"); if (s.photoJobs[k].state === "done" && !(existsSync(f) && /"marks":/.test(readFileSync(f, "utf8")))) delete s.photoJobs[k]; }
    for (const st of Object.values(s.setups)) if (st.fieldJob?.state === "done" && !existsSync(join(fieldDir(s, st), "field.json"))) delete st.fieldJob;
    for (const k of Object.keys(s.scores)) { const [sk, name, h] = k.split("/"), st = s.setups[sk]; if (s.scores[k].state === "done" && (!st || !existsSync(scoreFile(s, st, name, h === "hidden")))) delete s.scores[k]; }
    sessions.set(id, s); return s;
  };
  const scoreFile = (s: Session, st: Setup, name: string, hidden: boolean) => join(s.kind === "flight" ? fieldDir(s, st) : readsDir(s, st.readKey), `score-${name}${hidden ? "-hidden" : ""}.json`);
  const send = (res: ServerResponse, code: number, body: unknown) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
  const raw = (req: IncomingMessage) => new Promise<string>(ok => { let b = ""; req.on("data", c => (b += c)); req.on("end", () => ok(b)); });
  const body = async (req: IncomingMessage) => JSON.parse((await raw(req)) || "{}") as Record<string, unknown>;

  /** Run a job: node + vite-node + the script, its output kept in the session's folder. */
  const run = (s: Session, args: string[], logName: string, onEnd: (ok: boolean) => void) => {
    mkdirSync(dirOf(s), { recursive: true });
    const log = join(dirOf(s), `${logName}.log`), p = spawn(process.execPath, [VITE_NODE, ...args], { cwd: root, windowsHide: true });
    running.add(p); let out = "";
    const keep = (d: Buffer) => { out += d.toString(); if (out.length > 200000) out = out.slice(-100000); writeFileSync(log, out); };
    p.stdout.on("data", keep); p.stderr.on("data", keep);
    p.on("close", code => { running.delete(p); onEnd(code === 0); });
    return log;
  };

  /** Photographs of a folder: its own JPEGs, and those one folder down named "<folder>_<file>" (as the records name them). */
  const photosIn = (dir: string) => {
    const out: { name: string; file: string }[] = [];
    for (const f of readdirSync(dir)) {
      const p = join(dir, f), st = statSync(p);
      if (st.isFile() && /\.jpe?g$/i.test(f)) out.push({ name: basename(f, extname(f)), file: p });
      else if (st.isDirectory()) for (const g of readdirSync(p)) if (/\.jpe?g$/i.test(g)) out.push({ name: `${f}_${basename(g, extname(g))}`, file: join(p, g) });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  };
  /** Analysis records on this computer: the twins built here, and the inspector's own builds. */
  const known = () => {
    const out: { path: string; reads: string[]; mtime: number }[] = [];
    for (const base of [resolve(root, "data/direct-georef/twin"), join(DATA, "builds")]) if (existsSync(base)) for (const d of readdirSync(base)) {
      const f = join(base, d, "analysis.json"); if (!existsSync(f)) continue;
      try { out.push({ path: f, reads: (JSON.parse(readFileSync(f, "utf8")) as { reads: { name: string }[] }).reads.map(r => r.name), mtime: statSync(f).mtimeMs }); } catch { /* not a record */ }
    }
    return out;
  };
  const countReads = (s: Session, rk: string) => { const d = join(readsDir(s, rk), "reads"); return existsSync(d) ? readdirSync(d).length : 0; };

  // ---- A setup: its reads (shared by every setup with the same read options), then its field.
  const startField = (s: Session, st: Setup) => {
    if (existsSync(join(fieldDir(s, st), "field.json"))) { st.fieldJob = { state: "done" }; save(s); return; }
    st.fieldJob = { state: "running", started: Date.now() }; save(s);
    st.fieldJob.log = run(s, [SCRIPT, "--", "field", "--analysis", s.analysis!, "--reads", readsDir(s, st.readKey), "--out", fieldDir(s, st), "--read", JSON.stringify(st.read), "--field", JSON.stringify(st.field)], `field-${st.key}`, ok => { st.fieldJob = { ...st.fieldJob!, state: ok ? "done" : "failed", ended: Date.now(), ...(ok ? {} : { error: "see the field log" }) }; save(s); });
  };
  const startSetup = (s: Session, st: Setup) => {
    if (!s.analysis) return; // the build runs first; it starts the default setup when done
    const total = (JSON.parse(readFileSync(s.analysis, "utf8")) as { reads: unknown[] }).reads.length, rk = st.readKey;
    if (s.reads[rk]?.state === "running") { st.fieldJob = { state: "waiting", error: "waiting for the reads" }; save(s); return; }
    if (countReads(s, rk) >= total) { s.reads[rk] = { state: "done", done: total, total }; startField(s, st); return; }
    const parts = 6, step = Math.ceil(total / parts); let left = 0;
    s.reads[rk] = { state: "running", started: Date.now(), done: countReads(s, rk), total }; st.fieldJob = { state: "waiting", error: "waiting for the reads" }; save(s);
    for (let a = 0; a < total; a += step) {
      left++;
      run(s, [SCRIPT, "--", "reads", "--analysis", s.analysis, "--photos", s.path, "--out", readsDir(s, rk), "--range", `${a}:${Math.min(total, a + step)}`, "--read", JSON.stringify(st.read)], `reads-${rk}-${a}`, ok => {
        left--; if (!ok) s.reads[rk].error = "a part of the reads failed (see its log)";
        if (left) return;
        s.reads[rk] = { ...s.reads[rk], state: s.reads[rk].error ? "failed" : "done", ended: Date.now(), done: countReads(s, rk) }; save(s);
        if (s.reads[rk].state === "done") for (const x of Object.values(s.setups)) if (x.readKey === rk && x.fieldJob?.state === "waiting") startField(s, x);
      });
    }
  };
  const setupOf = (s: Session, read: Options, field: Options) => {
    const readKey = keyOf(read), fieldKey = keyOf(field), key = `${readKey}.${fieldKey}`;
    return (s.setups[key] ??= { key, readKey, fieldKey, read, field });
  };
  const startFlight = (s: Session) => {
    const def = setupOf(s, {}, {});
    if (s.analysis) { startSetup(s, def); return; }
    // No record of this flight: build it here as the app does (cameras and the analysis record), then read it.
    const id = `insp-${s.id}`;
    s.build = { state: "running", started: Date.now() }; save(s);
    s.build.log = run(s, [resolve(root, "scripts/directGeoref/buildTwinApp.ts"), "--", "--dir", s.path, "--out", join(DATA, "builds"), "--id", id, "--name", `Corn inspector ${s.id}`, "--crop", "corn", "--weeds", "none", "--analysis"], "build", ok => {
      const f = join(DATA, "builds", id, "analysis.json");
      s.build = { ...s.build!, state: ok && existsSync(f) ? "done" : "failed", ended: Date.now() };
      if (s.build.state === "done") { s.analysis = f; s.analysisSource = "built here by scripts/directGeoref/buildTwinApp.ts (the app's build pipeline)"; save(s); startSetup(s, def); } else save(s);
    });
  };
  const startPhoto = (s: Session, name: string, read: Options) => {
    const p = s.photos.find(q => q.name === name); if (!p) return null;
    const rk = keyOf(read), k = `${rk}/${name}`, cur = s.photoJobs[k];
    // A photograph's views made by this version (an older one carried no `marks`): kept; otherwise read again.
    const infoFile = join(readsDir(s, rk), "photo", name, "info.json"), fresh = existsSync(infoFile) && /"marks":/.test(readFileSync(infoFile, "utf8"));
    if (fresh) { s.photoJobs[k] = { state: "done" }; save(s); return s.photoJobs[k]; }
    if (cur?.state === "done") delete s.photoJobs[k];
    if (cur && cur.state === "running") return cur;
    if (s.kind === "flight" && !s.analysis) { s.photoJobs[k] = { state: "waiting", error: "waiting for the flight's cameras" }; save(s); return s.photoJobs[k]; }
    if (s.kind === "flight" && !(JSON.parse(readFileSync(s.analysis!, "utf8")) as { reads: { name: string }[] }).reads.some(r => r.name === name)) { s.photoJobs[k] = { state: "failed", error: "this photograph is not in the flight's record (it has no camera)" }; save(s); return s.photoJobs[k]; }
    s.photoJobs[k] = { state: "running", started: Date.now() }; save(s);
    s.photoJobs[k].log = run(s, [SCRIPT, "--", "photo", "--photo", p.file, "--name", name, "--out", readsDir(s, rk), "--read", JSON.stringify(read), ...(s.analysis ? ["--analysis", s.analysis] : [])], `photo-${rk}-${name}`, ok => { s.photoJobs[k] = { ...s.photoJobs[k], state: ok ? "done" : "failed", ended: Date.now(), ...(ok ? {} : { error: "see the photograph's log" }) }; save(s); });
    return s.photoJobs[k];
  };
  const startScore = (s: Session, st: Setup, name: string, hidden: boolean) => {
    const p = s.photos.find(q => q.name === name); if (!p) return null;
    const k = `${st.key}/${name}/${hidden ? "hidden" : "dev"}`, file = scoreFile(s, st, name, hidden);
    if (existsSync(file)) { s.scores[k] = { state: "done" }; save(s); return s.scores[k]; }
    if (s.scores[k]?.state === "running") return s.scores[k];
    if (s.kind === "flight" && st.fieldJob?.state !== "done") { s.scores[k] = { state: "failed", error: "the setup's field is not done yet" }; save(s); return s.scores[k]; }
    s.scores[k] = { state: "running", started: Date.now() }; save(s);
    const args = [SCRIPT, "--", "score", "--labels", join(dirOf(s), "labels.json"), "--image", name, "--out", join(file, ".."), "--read", JSON.stringify(st.read), "--field", JSON.stringify(st.field), ...(hidden ? ["--hidden"] : []),
      ...(s.kind === "flight" ? ["--analysis", s.analysis!, "--reads", readsDir(s, st.readKey)] : ["--photo", p.file])];
    s.scores[k].log = run(s, args, `score-${st.key}-${name}${hidden ? "-hidden" : ""}`, ok => { s.scores[k] = { ...s.scores[k], state: ok ? "done" : "failed", ended: Date.now(), ...(ok ? {} : { error: "see the score log" }) }; save(s); });
    return s.scores[k];
  };
  const spent = () => (existsSync(SPENT) ? (JSON.parse(readFileSync(SPENT, "utf8")) as Record<string, unknown>[]) : []);

  return {
    name: "corn-inspector-dev",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.on("close", () => { for (const p of running) p.kill(); });
      mkdirSync(DATA, { recursive: true });
      // The hidden-half check spent before the inspector existed (FINAL-1.md Part 4), so the page can say so.
      if (!existsSync(SPENT)) writeFileSync(SPENT, JSON.stringify([{ when: "2026-11-18", image: "53", photograph: "53.JPG (2024 Day001_Corn2)", what: "the held-back tiles scored once, today's read against the cores on (FINAL-1.md Part 4), outside the inspector" }], null, 1));
      server.middlewares.use("/__corn-inspector", async (req, res, next) => {
        try {
          const url = (req.url ?? "/").split("?")[0];
          if (req.method === "GET" && url === "/known") return send(res, 200, known().map(k => ({ path: k.path, photographs: k.reads.length })));
          if (req.method === "GET" && url === "/hidden-spent") return send(res, 200, spent());
          if (req.method === "POST" && url === "/open") {
            const b = await body(req), path = resolve(String(b.path ?? "").trim().replace(/^"|"$/g, "")), given = b.analysis ? resolve(String(b.analysis).trim().replace(/^"|"$/g, "")) : null;
            if (!existsSync(path)) return send(res, 400, { error: `no such file or folder: ${path}` });
            if (given && !existsSync(given)) return send(res, 400, { error: `no such analysis record: ${given}` });
            const isDir = statSync(path).isDirectory();
            if (!isDir && !/\.jpe?g$/i.test(path)) return send(res, 400, { error: "a photograph is a JPEG file" });
            const id = createHash("sha1").update(`${path}|${given ?? ""}|default`).digest("hex").slice(0, 16);
            const old = load(id);
            if (old) { const def = setupOf(old, {}, {}); if (old.kind === "flight" && def.fieldJob?.state !== "done" && def.fieldJob?.state !== "running" && old.build?.state !== "running") startFlight(old); save(old); return send(res, 200, old); }
            const photos = isDir ? photosIn(path) : [{ name: basename(path, extname(path)), file: path }];
            if (!photos.length) return send(res, 400, { error: "no JPEG photographs in that folder" });
            const s: Session = { id, kind: isDir ? "flight" : "photo", path, created: Date.now(), photos, analysis: null, analysisSource: null, reads: {}, setups: {}, photoJobs: {}, scores: {}, labels: null };
            if (isDir) {
              if (given) { s.analysis = given; s.analysisSource = "given"; }
              else {
                // A record of this flight already on this computer: most of its photographs in this folder.
                const names = new Set(photos.map(p => p.name)), best = known().map(k => ({ ...k, hit: k.reads.filter(n => names.has(n)).length })).filter(k => k.hit >= 0.9 * k.reads.length && k.hit >= 2).sort((x, y) => y.hit - x.hit || y.mtime - x.mtime)[0];
                if (best) { s.analysis = best.path; s.analysisSource = `found on this computer, the newest record of this flight (${best.hit} of its ${best.reads.length} photographs are in this folder)`; }
              }
            } else setupOf(s, {}, {});
            sessions.set(id, s); save(s);
            if (isDir) startFlight(s);
            return send(res, 200, s);
          }
          let m = /^\/session\/([a-f0-9]{16})$/.exec(url);
          if (req.method === "GET" && m) { const s = load(m[1]); if (!s) return send(res, 404, { error: "no such session" }); for (const [rk, j] of Object.entries(s.reads)) if (j.state === "running") j.done = countReads(s, rk); return send(res, 200, s); }
          m = /^\/setup\/([a-f0-9]{16})$/.exec(url);
          if (req.method === "POST" && m) {
            const s = load(m[1]); if (!s) return send(res, 404, { error: "no such session" });
            const b = await body(req), st = setupOf(s, (b.read ?? {}) as Options, (b.field ?? {}) as Options);
            if (s.kind === "flight" && st.fieldJob?.state !== "done" && st.fieldJob?.state !== "running") startSetup(s, st);
            save(s); return send(res, 200, s);
          }
          m = /^\/photo\/([a-f0-9]{16})\/([^/]+)$/.exec(url);
          if (req.method === "POST" && m) { const s = load(m[1]); if (!s) return send(res, 404, { error: "no such session" }); const b = await body(req), j = startPhoto(s, decodeURIComponent(m[2]), (b.read ?? {}) as Options); return j ? send(res, 200, j) : send(res, 404, { error: "not a photograph of this session" }); }
          m = /^\/labels\/([a-f0-9]{16})$/.exec(url);
          if (req.method === "POST" && m) {
            const s = load(m[1]); if (!s) return send(res, 404, { error: "no such session" });
            const text = await raw(req), L = JSON.parse(text) as { images?: { image: string; points: { type: string }[] }[] };
            if (!Array.isArray(L.images)) return send(res, 400, { error: "not a labels file from the labeler (no images list)" });
            writeFileSync(join(dirOf(s), "labels.json"), text);
            // New labels: every score made with the old ones is let go.
            for (const st of Object.values(s.setups)) for (const p of s.photos) for (const h of [false, true]) { const f = scoreFile(s, st, p.name, h); if (existsSync(f) && !h) rmSync(f); }
            s.scores = Object.fromEntries(Object.entries(s.scores).filter(([k]) => k.endsWith("/hidden")));
            s.labels = { images: L.images.map(i => ({ image: i.image, plants: i.points.filter(p => p.type === "plant").length, unsure: i.points.filter(p => p.type === "unsure").length })) }; save(s);
            return send(res, 200, s.labels);
          }
          m = /^\/score\/([a-f0-9]{16})$/.exec(url);
          if (req.method === "POST" && m) {
            const s = load(m[1]); if (!s) return send(res, 404, { error: "no such session" });
            if (!s.labels) return send(res, 400, { error: "load a labels file first" });
            const b = await body(req), st = s.setups[String(b.setup)], name = String(b.name), hidden = b.hidden === true;
            if (!st) return send(res, 400, { error: "no such setup" });
            if (hidden) {
              if (b.spend !== "spend") return send(res, 400, { error: "the held-back tiles are scored only when the hidden-half check is spent" });
              if (!existsSync(scoreFile(s, st, name, true))) writeFileSync(SPENT, JSON.stringify([...spent(), { when: new Date().toISOString(), image: name, photograph: s.photos.find(p => p.name === name)?.file ?? name, setup: { read: st.read, field: st.field }, what: "the held-back tiles scored in the corn inspector" }], null, 1));
            }
            const j = startScore(s, st, name, hidden); return j ? send(res, 200, j) : send(res, 404, { error: "not a photograph of this session" });
          }
          m = /^\/photo-file\/([a-f0-9]{16})\/([^/]+)$/.exec(url);
          if (req.method === "GET" && m) { const s = load(m[1]), p = s?.photos.find(q => q.name === decodeURIComponent(m![2])); if (!p) return send(res, 404, { error: "not a photograph of this session" }); res.setHeader("Content-Type", "image/jpeg"); res.setHeader("Cache-Control", "max-age=3600"); createReadStream(p.file).pipe(res); return; }
          m = /^\/cache\/([a-f0-9]{16})\/(.+)$/.exec(url);
          if (req.method === "GET" && m) {
            const s = load(m[1]); if (!s) return send(res, 404, { error: "no such session" });
            const base = dirOf(s), f = resolve(base, decodeURIComponent(m[2]));
            // The labels file itself is never served back: the page gets only the scored tiles' labels, from a score.
            if (!f.startsWith(base + sep) || !existsSync(f) || !statSync(f).isFile() || /labels\.json$/.test(f)) return send(res, 404, { error: "not there (yet)" });
            res.setHeader("Content-Type", f.endsWith(".json") ? "application/json" : f.endsWith(".png") ? "image/png" : f.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream");
            createReadStream(f).pipe(res); return;
          }
          next();
        } catch (e) { send(res, 500, { error: (e as Error).message }); }
      });
    },
  };
}
