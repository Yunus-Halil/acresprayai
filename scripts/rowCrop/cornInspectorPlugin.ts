// Development only: the dev server's side of the corn inspector (/dev/corn-inspector). `apply: "serve"`: never part
// of a build. It keeps sessions under data/corn-inspector/ (git-ignored) and runs scripts/rowCrop/cornInspect.ts in
// child processes, so the page waits on files and the dev server stays free. It reads only the folder or photograph
// it is given, and serves only that folder's photographs and its own cache.
//
//   POST /__corn-inspector/open   { path, analysis? }       a flight's folder or one photograph: a session
//   GET  /__corn-inspector/session/<id>                     the session: photographs, jobs, logs
//   POST /__corn-inspector/photo/<id>/<name>                the views and marks of one photograph (once; cached)
//   GET  /__corn-inspector/photo-file/<id>/<name>           the photograph itself
//   GET  /__corn-inspector/cache/<id>/<path>                a file the jobs wrote (field.json, field.bin, photo/...)
//   GET  /__corn-inspector/known                            analysis records found on this computer
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, resolve, sep } from "node:path";
import type { Plugin } from "vite";

type JobState = { state: "waiting" | "running" | "done" | "failed"; started?: number; ended?: number; log?: string; error?: string };
type Session = {
  id: string; kind: "flight" | "photo"; path: string; created: number;
  photos: { name: string; file: string }[];
  analysis: string | null; analysisSource: string | null;
  /** The read options' key (pass 1: every option as the code has it). */
  readKey: string;
  jobs: { build?: JobState; reads?: JobState & { done: number; total: number }; field?: JobState; photos: Record<string, JobState> };
};

export function cornInspectorDev(root: string): Plugin {
  const DATA = resolve(root, "data/corn-inspector"), VITE_NODE = resolve(root, "node_modules/vite-node/vite-node.mjs"), SCRIPT = resolve(root, "scripts/rowCrop/cornInspect.ts");
  const sessions = new Map<string, Session>(), running = new Set<ChildProcess>();
  const dirOf = (s: Session) => join(DATA, "sessions", s.id), readsDir = (s: Session) => join(dirOf(s), `R-${s.readKey}`);
  const save = (s: Session) => { mkdirSync(dirOf(s), { recursive: true }); writeFileSync(join(dirOf(s), "session.json"), JSON.stringify(s, null, 1)); };
  const load = (id: string): Session | null => { if (sessions.has(id)) return sessions.get(id)!; const f = join(DATA, "sessions", id, "session.json"); if (!/^[a-f0-9]{16}$/.test(id) || !existsSync(f)) return null; const s = JSON.parse(readFileSync(f, "utf8")) as Session; for (const j of [s.jobs.build, s.jobs.reads, s.jobs.field, ...Object.values(s.jobs.photos)]) if (j && j.state === "running") { j.state = "failed"; j.error = "the dev server stopped while it ran"; } sessions.set(id, s); return s; };
  const send = (res: ServerResponse, code: number, body: unknown) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
  const body = (req: IncomingMessage) => new Promise<Record<string, string>>((ok, no) => { let b = ""; req.on("data", c => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch (e) { no(e); } }); });

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

  const startField = (s: Session) => {
    s.jobs.field = { state: "running", started: Date.now() }; save(s);
    s.jobs.field.log = run(s, [SCRIPT, "--", "field", "--analysis", s.analysis!, "--out", readsDir(s)], "field", ok => { s.jobs.field = { ...s.jobs.field!, state: ok ? "done" : "failed", ended: Date.now() }; save(s); });
  };
  const startReads = (s: Session) => {
    const total = (JSON.parse(readFileSync(s.analysis!, "utf8")) as { reads: unknown[] }).reads.length, parts = 6, step = Math.ceil(total / parts);
    s.jobs.reads = { state: "running", started: Date.now(), done: 0, total }; save(s);
    let left = 0;
    for (let a = 0; a < total; a += step) {
      left++;
      run(s, [SCRIPT, "--", "reads", "--analysis", s.analysis!, "--photos", s.path, "--out", readsDir(s), "--range", `${a}:${Math.min(total, a + step)}`], `reads-${a}`, ok => {
        left--; if (!ok) s.jobs.reads!.error = "a part of the reads failed (see its log)";
        if (!left) { s.jobs.reads = { ...s.jobs.reads!, state: s.jobs.reads!.error ? "failed" : "done", ended: Date.now(), done: countReads(s) }; save(s); if (!s.jobs.reads.error) startField(s); }
      });
    }
  };
  const countReads = (s: Session) => { const d = join(readsDir(s), "reads"); return existsSync(d) ? readdirSync(d).length : 0; };
  const startFlight = (s: Session) => {
    if (s.analysis) { if (existsSync(join(readsDir(s), "field.json"))) { s.jobs.reads = { state: "done", done: countReads(s), total: countReads(s) }; s.jobs.field = { state: "done" }; save(s); return; } startReads(s); return; }
    // No record of this flight: build it here as the app does (cameras and the analysis record), then read it.
    const id = `insp-${s.id}`;
    s.jobs.build = { state: "running", started: Date.now() }; save(s);
    s.jobs.build.log = run(s, [resolve(root, "scripts/directGeoref/buildTwinApp.ts"), "--", "--dir", s.path, "--out", join(DATA, "builds"), "--id", id, "--name", `Corn inspector ${s.id}`, "--crop", "corn", "--weeds", "none", "--analysis"], "build", ok => {
      const f = join(DATA, "builds", id, "analysis.json");
      s.jobs.build = { ...s.jobs.build!, state: ok && existsSync(f) ? "done" : "failed", ended: Date.now() };
      if (s.jobs.build.state === "done") { s.analysis = f; s.analysisSource = "built here by scripts/directGeoref/buildTwinApp.ts (the app's build pipeline)"; save(s); startReads(s); } else save(s);
    });
  };
  const startPhoto = (s: Session, name: string) => {
    const p = s.photos.find(q => q.name === name); if (!p) return false;
    const cur = s.jobs.photos[name]; if (cur && (cur.state === "running" || cur.state === "done")) return true;
    if (s.kind === "flight" && !s.analysis) { s.jobs.photos[name] = { state: "waiting", error: "waiting for the flight's cameras" }; save(s); return true; }
    if (s.kind === "flight" && !(JSON.parse(readFileSync(s.analysis!, "utf8")) as { reads: { name: string }[] }).reads.some(r => r.name === name)) { s.jobs.photos[name] = { state: "failed", error: "this photograph is not in the flight's record (it has no camera)" }; save(s); return true; }
    const busy = Object.values(s.jobs.photos).filter(j => j.state === "running").length;
    if (busy >= 2) { s.jobs.photos[name] = { state: "waiting", error: "two photographs are being read; this one is next" }; save(s); return true; }
    s.jobs.photos[name] = { state: "running", started: Date.now() }; save(s);
    s.jobs.photos[name].log = run(s, [SCRIPT, "--", "photo", "--photo", p.file, "--name", name, "--out", readsDir(s), ...(s.analysis ? ["--analysis", s.analysis] : [])], `photo-${name}`, ok => {
      s.jobs.photos[name] = { ...s.jobs.photos[name], state: ok ? "done" : "failed", ended: Date.now() };
      // Next in the queue.
      const next = Object.entries(s.jobs.photos).find(([, j]) => j.state === "waiting" && j.error?.startsWith("two photographs"));
      save(s); if (next) { delete s.jobs.photos[next[0]]; startPhoto(s, next[0]); }
    });
    return true;
  };

  return {
    name: "corn-inspector-dev",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.on("close", () => { for (const p of running) p.kill(); });
      server.middlewares.use("/__corn-inspector", async (req, res, next) => {
        try {
          const url = (req.url ?? "/").split("?")[0];
          if (req.method === "GET" && url === "/known") return send(res, 200, known().map(k => ({ path: k.path, photographs: k.reads.length })));
          if (req.method === "POST" && url === "/open") {
            const b = await body(req), path = resolve(String(b.path ?? "").trim().replace(/^"|"$/g, "")), given = b.analysis ? resolve(String(b.analysis).trim().replace(/^"|"$/g, "")) : null;
            if (!existsSync(path)) return send(res, 400, { error: `no such file or folder: ${path}` });
            if (given && !existsSync(given)) return send(res, 400, { error: `no such analysis record: ${given}` });
            const isDir = statSync(path).isDirectory();
            if (!isDir && !/\.jpe?g$/i.test(path)) return send(res, 400, { error: "a photograph is a JPEG file" });
            const readKey = "default", id = createHash("sha1").update(`${path}|${given ?? ""}|${readKey}`).digest("hex").slice(0, 16);
            const old = load(id); if (old) { if (old.kind === "flight" && old.jobs.field?.state !== "done" && old.jobs.reads?.state !== "running" && old.jobs.build?.state !== "running") startFlight(old); return send(res, 200, old); }
            const photos = isDir ? photosIn(path) : [{ name: basename(path, extname(path)), file: path }];
            if (!photos.length) return send(res, 400, { error: "no JPEG photographs in that folder" });
            const s: Session = { id, kind: isDir ? "flight" : "photo", path, created: Date.now(), photos, analysis: null, analysisSource: null, readKey, jobs: { photos: {} } };
            if (isDir) {
              if (given) { s.analysis = given; s.analysisSource = "given"; }
              else {
                // A record of this flight already on this computer: most of its photographs in this folder.
                const names = new Set(photos.map(p => p.name)), best = known().map(k => ({ ...k, hit: k.reads.filter(n => names.has(n)).length })).filter(k => k.hit >= 0.9 * k.reads.length && k.hit >= 2).sort((x, y) => y.hit - x.hit || y.mtime - x.mtime)[0];
                if (best) { s.analysis = best.path; s.analysisSource = `found on this computer, the newest record of this flight (${best.hit} of its ${best.reads.length} photographs are in this folder)`; }
              }
            }
            sessions.set(id, s); save(s);
            if (isDir) startFlight(s);
            return send(res, 200, s);
          }
          let m = /^\/session\/([a-f0-9]{16})$/.exec(url);
          if (req.method === "GET" && m) { const s = load(m[1]); if (!s) return send(res, 404, { error: "no such session" }); if (s.jobs.reads?.state === "running") s.jobs.reads.done = countReads(s); return send(res, 200, s); }
          m = /^\/photo\/([a-f0-9]{16})\/([^/]+)$/.exec(url);
          if (req.method === "POST" && m) { const s = load(m[1]); if (!s) return send(res, 404, { error: "no such session" }); const name = decodeURIComponent(m[2]); if (existsSync(join(readsDir(s), "photo", name, "info.json"))) { s.jobs.photos[name] = { state: "done" }; save(s); return send(res, 200, s.jobs.photos[name]); } return startPhoto(s, name) ? send(res, 200, s.jobs.photos[name]) : send(res, 404, { error: "not a photograph of this session" }); }
          m = /^\/photo-file\/([a-f0-9]{16})\/([^/]+)$/.exec(url);
          if (req.method === "GET" && m) { const s = load(m[1]), p = s?.photos.find(q => q.name === decodeURIComponent(m![2])); if (!p) return send(res, 404, { error: "not a photograph of this session" }); res.setHeader("Content-Type", "image/jpeg"); res.setHeader("Cache-Control", "max-age=3600"); createReadStream(p.file).pipe(res); return; }
          m = /^\/cache\/([a-f0-9]{16})\/(.+)$/.exec(url);
          if (req.method === "GET" && m) {
            const s = load(m[1]); if (!s) return send(res, 404, { error: "no such session" });
            const base = readsDir(s), f = resolve(base, decodeURIComponent(m[2]));
            if (!f.startsWith(base + sep) || !existsSync(f) || !statSync(f).isFile()) return send(res, 404, { error: "not there (yet)" });
            res.setHeader("Content-Type", f.endsWith(".json") ? "application/json" : f.endsWith(".png") ? "image/png" : f.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream");
            createReadStream(f).pipe(res); return;
          }
          next();
        } catch (e) { send(res, 500, { error: (e as Error).message }); }
      });
    },
  };
}
