// Summarises a Chrome trace from twinBuildProfile.mjs --trace: the V8 sampling profiler's samples on every thread
// (the page, the build worker, each helper), as self and inclusive time per function, per kind of thread.
//
//   node --max-old-space-size=12000 scripts/directGeoref/profileSummary.mjs <trace.json> [--top 40] [--out summary.json]
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const TOP = Number(arg("top", "40")), OUT = arg("out", "");
const raw = JSON.parse(readFileSync(argv[0], "utf8"));
const events = Array.isArray(raw) ? raw : raw.traceEvents;

const threadName = new Map();
for (const e of events) if (e.ph === "M" && e.name === "thread_name") threadName.set(`${e.pid}:${e.tid}`, e.args?.name ?? "?");

// One profile per (pid, profile id): nodes arrive in chunks, samples with time deltas.
const profiles = new Map();
for (const e of events) {
  if (e.name !== "Profile" && e.name !== "ProfileChunk") continue;
  const key = `${e.pid}:${e.id}`;
  let p = profiles.get(key);
  if (!p) { p = { pid: e.pid, tid: e.tid, nodes: new Map(), samples: [], deltas: [] }; profiles.set(key, p); }
  if (e.tid != null) p.tid = e.tid;
  const d = e.args?.data;
  if (!d) continue;
  for (const n of d.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n);
  if (d.cpuProfile?.samples) { p.samples.push(...d.cpuProfile.samples); p.deltas.push(...(d.timeDeltas ?? [])); }
}

const label = cf => `${cf.functionName || "(anonymous)"} ${String(cf.url ?? "").replace(/^.*\/src\//, "src/").replace(/\?.*$/, "")}:${(cf.lineNumber ?? -1) + 1}`;
const IDLE = new Set(["(idle)", "(program)", "(garbage collector)", "(root)"]);
const kinds = {};
for (const p of profiles.values()) {
  const tn = threadName.get(`${p.pid}:${p.tid}`) ?? `tid ${p.tid}`;
  // Every dedicated worker is "DedicatedWorker thread"; the build worker is the one that ran the pipeline.
  const self = new Map(), incl = new Map();
  let total = 0, busy = 0, gc = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const dt = (p.deltas[i + 1] ?? 0) / 1000; // ms; the delta before the next sample is this sample's time
    if (dt <= 0 || dt > 1000) continue;
    total += dt;
    const n = p.nodes.get(p.samples[i]);
    if (!n) continue;
    const name = n.callFrame?.functionName;
    if (name === "(garbage collector)") gc += dt;
    if (IDLE.has(name)) continue;
    busy += dt;
    const l = label(n.callFrame);
    self.set(l, (self.get(l) ?? 0) + dt);
    const seen = new Set();
    for (let c = n; c; c = c.parent != null ? p.nodes.get(c.parent) : null) {
      const cl = label(c.callFrame);
      if (IDLE.has(c.callFrame?.functionName) || seen.has(cl)) continue;
      seen.add(cl); incl.set(cl, (incl.get(cl) ?? 0) + dt);
    }
  }
  if (!busy) continue;
  const topOf = m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k, v]) => ({ fn: k, ms: Math.round(v) }));
  const kind = /DedicatedWorker/.test(tn) ? (incl.has([...incl.keys()].find(k => /buildFieldTwin/.test(k))) ? "build worker" : "helper worker") : tn;
  (kinds[kind] ??= []).push({ thread: tn, pid: p.pid, tid: p.tid, sampledMs: Math.round(total), busyMs: Math.round(busy), gcMs: Math.round(gc), self: topOf(self), inclusive: topOf(incl), _self: self, _incl: incl });
}

// Helpers summed: their functions over all helper threads.
const summary = {};
for (const [kind, list] of Object.entries(kinds)) {
  const self = new Map(), incl = new Map();
  for (const t of list) { for (const [k, v] of t._self) self.set(k, (self.get(k) ?? 0) + v); for (const [k, v] of t._incl) incl.set(k, (incl.get(k) ?? 0) + v); }
  const topOf = m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k, v]) => ({ fn: k, ms: Math.round(v) }));
  summary[kind] = { threads: list.length, busyMs: list.reduce((s, t) => s + t.busyMs, 0), gcMs: list.reduce((s, t) => s + t.gcMs, 0), perThreadBusyMs: list.map(t => t.busyMs), self: topOf(self), inclusive: topOf(incl) };
}
// --fns a,b,c: each function's inclusive time per thread; --within outer>inner,...: inner's time under outer only.
const fns = (arg("fns", "") || "").split(",").filter(Boolean), within = (arg("within", "") || "").split(",").filter(Boolean).map(x => x.split(">"));
if (fns.length || within.length) {
  summary.perThread = [];
  for (const p of profiles.values()) {
    const tn = threadName.get(`${p.pid}:${p.tid}`) ?? `tid ${p.tid}`;
    const row = { thread: tn, tid: p.tid, fns: {}, within: {} };
    for (let i = 0; i < p.samples.length; i++) {
      const dt = (p.deltas[i + 1] ?? 0) / 1000;
      if (dt <= 0 || dt > 1000) continue;
      const names = new Set();
      for (let c = p.nodes.get(p.samples[i]); c; c = c.parent != null ? p.nodes.get(c.parent) : null) names.add(c.callFrame?.functionName);
      for (const f of fns) if (names.has(f)) row.fns[f] = (row.fns[f] ?? 0) + dt;
      for (const [o, n] of within) if (names.has(o) && names.has(n)) row.within[`${o}>${n}`] = (row.within[`${o}>${n}`] ?? 0) + dt;
    }
    if (Object.keys(row.fns).length || Object.keys(row.within).length) summary.perThread.push(row);
  }
  for (const r of summary.perThread) console.log(`${r.thread} ${r.tid}: ${Object.entries({ ...r.fns, ...r.within }).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`).join(", ")}`);
}
const text = JSON.stringify(summary, null, 1);
if (OUT) writeFileSync(OUT, text);
for (const [kind, s] of Object.entries(summary)) {
  if (kind === "perThread") continue;
  console.log(`\n== ${kind}: ${s.threads} thread(s), busy ${(s.busyMs / 1000).toFixed(1)} s (GC ${(s.gcMs / 1000).toFixed(1)} s), per thread ${s.perThreadBusyMs.map(v => (v / 1000).toFixed(1)).join(", ")}`);
  console.log("  self:"); for (const r of s.self.slice(0, 20)) console.log(`   ${(r.ms / 1000).toFixed(1).padStart(7)} s  ${r.fn}`);
  console.log("  inclusive:"); for (const r of s.inclusive.slice(0, 25)) console.log(`   ${(r.ms / 1000).toFixed(1).padStart(7)} s  ${r.fn}`);
}
