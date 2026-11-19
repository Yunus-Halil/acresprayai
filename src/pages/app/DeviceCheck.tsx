// The founder's device check (/app/device-check): before and after a big build on an iPad or a laptop, what this
// browser can do for a Field Twin, and whether the last build on this device was stopped by the browser. Everything
// runs and stays on this device; "Copy the report" puts it on the clipboard to paste wherever it is wanted.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { CANVAS_SIZES, type CanvasProbe, type DeviceFacts, type PhotoProbe, askWorker, deviceFacts, probeCanvas } from "@/lib/fieldTwin/deviceCheck";
import { type BuildTrace, forgetTrace, stoppedBuildText, unfinishedTrace } from "@/lib/fieldTwin/buildTrace";
import { sessionBusy, useBuildSession } from "@/lib/fieldTwin/buildSession";
import { buildConcurrency, deviceHints } from "@/lib/fieldTwin/build/concurrency";

const s = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return <div className="flex justify-between gap-4 border-b border-border/60 py-1 text-sm"><span className="text-muted-foreground">{k}</span><span className={bad ? "font-medium text-red-600" : "text-foreground"}>{v}</span></div>;
}

export default function DeviceCheck() {
  const session = useBuildSession();
  const [facts, setFacts] = useState<DeviceFacts | null>(null);
  const [page, setPage] = useState<CanvasProbe[] | null>(null);
  const [inWorker, setInWorker] = useState<CanvasProbe[] | string | null>(null);
  const [photo, setPhoto] = useState<PhotoProbe | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<BuildTrace | null>(() => unfinishedTrace(sessionBusy()));
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { void deviceFacts().then(setFacts); }, []);
  useEffect(() => { setTrace(unfinishedTrace(sessionBusy(session))); }, [session]);

  const runCanvas = async () => {
    setBusy(true);
    setPage(CANVAS_SIZES.map(([w, h]) => probeCanvas(w, h)));
    const a = await askWorker({ kind: "canvas", sizes: CANVAS_SIZES });
    setInWorker(a.kind === "canvas" ? a.probes : a.kind === "error" ? a.message : "unexpected answer");
    setBusy(false);
  };
  useEffect(() => { void runCanvas(); }, []);

  const runPhoto = async (f: File) => {
    setBusy(true); setPhoto(null);
    const a = await askWorker({ kind: "photo", file: f }, 120_000);
    setPhoto(a.kind === "photo" ? a.probe : a.kind === "error" ? a.message : "unexpected answer");
    setBusy(false);
  };

  // How a build would run here (concurrency.ts): the same reading of the device the build makes.
  const plan = buildConcurrency(deviceHints());
  const report = () => JSON.stringify({ at: new Date().toISOString(), facts, plan, canvas: { page, worker: inWorker }, photo, stoppedBuild: trace }, null, 1);
  const copy = async () => { try { await navigator.clipboard.writeText(report()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };

  const probes = (list: CanvasProbe[]) => list.map(p => <Row key={`${p.w}x${p.h}`} k={`${p.w} x ${p.h} (${p.mp} MP)`} v={p.ok ? `draws (${p.ms} ms)` : `refused: ${p.why ?? "no reason given"}`} bad={!p.ok} />);

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6 sm:p-10">
      <Seo title="Device check, Swardus" noindex />
      <header>
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Founder tools</div>
        <h1 className="font-display text-3xl">Device check</h1>
        <p className="mt-2 text-sm text-muted-foreground">What this browser can do for a Field Twin build. It all runs on this device and nothing is sent.</p>
      </header>

      <section className="space-y-2">
        <h2 className="font-display text-xl">The last build on this device</h2>
        {trace
          ? <><p className="text-sm text-red-700">{stoppedBuildText(trace)}</p>
            <p className="text-xs text-muted-foreground">Stages reached: {Object.entries(trace.stages).map(([k, v]) => `${k} at ${s(v ?? 0)}`).join(", ") || "none"}.</p>
            <Button variant="outline" size="sm" onClick={() => { forgetTrace(); setTrace(null); }}>Forget it</Button></>
          : <p className="text-sm text-muted-foreground">{sessionBusy(session) ? "A build is running in this tab now." : "No build was stopped part way on this device."}</p>}
      </section>

      <section>
        <h2 className="mb-2 font-display text-xl">This device</h2>
        {facts ? <>
          <Row k="Seen as an iPad" v={facts.ipad ? "yes" : "no"} />
          <Row k="Processor cores the browser offers" v={facts.cores != null ? String(facts.cores) : "not said"} />
          <Row k="Memory the browser states" v={facts.memoryGB != null ? `${facts.memoryGB} GB or more` : "not said (Safari never says)"} />
          <Row k="Screen" v={facts.screen} />
          <Row k="A build here runs" v={`${plan.helpers > 1 ? `${plan.helpers} helper workers` : "no helper workers"}, ${plan.cornParallel} corn read${plan.cornParallel > 1 ? "s" : ""} at once (${plan.reason})`} />
          <Row k="Storage this site may use" v={facts.storage.quotaMB != null ? `${facts.storage.quotaMB.toLocaleString()} MB (${facts.storage.usageMB ?? 0} MB used)` : "not said"} />
          {Object.entries(facts.features).map(([k, v]) => <Row key={k} k={k} v={v ? "yes" : "no"} bad={!v} />)}
          <p className="mt-2 break-all text-[11px] text-muted-foreground">{facts.userAgent}</p>
        </> : <p className="text-sm text-muted-foreground">Reading…</p>}
      </section>

      <section>
        <h2 className="mb-1 font-display text-xl">The largest canvas</h2>
        <p className="mb-2 text-sm text-muted-foreground">A build reads each photograph at its full size on one canvas. A browser that refuses a canvas the size of the drone's photographs cannot read them for corn.</p>
        <h3 className="mt-3 text-sm font-semibold">In the page</h3>
        {page ? probes(page) : <p className="text-sm text-muted-foreground">Trying…</p>}
        <h3 className="mt-3 text-sm font-semibold">In a worker (where the build reads them)</h3>
        {inWorker == null ? <p className="text-sm text-muted-foreground">Trying…</p> : typeof inWorker === "string" ? <p className="text-sm text-red-700">{inWorker}</p> : probes(inWorker)}
        <Button className="mt-2" variant="outline" size="sm" disabled={busy} onClick={() => void runCanvas()}>Try again</Button>
      </section>

      <section>
        <h2 className="mb-1 font-display text-xl">One of the flight's photographs</h2>
        <p className="mb-2 text-sm text-muted-foreground">Read exactly as a build reads it: the camera's own preview, then the whole photograph at its full size.</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Reading…" : "Choose one photograph"}</Button>
        <input ref={input} type="file" accept=".jpg,.jpeg,.JPG,.JPEG" className="hidden" aria-label="One of the flight's photographs" onChange={e => { const f = e.target.files?.[0]; if (f) void runPhoto(f); e.target.value = ""; }} />
        {typeof photo === "string" && <p className="mt-2 text-sm text-red-700">{photo}</p>}
        {photo && typeof photo !== "string" && <div className="mt-2">
          <Row k="File" v={`${photo.name}, ${(photo.bytes / 1e6).toFixed(1)} MB`} />
          <Row k="Camera preview" v={photo.preview.ok ? `${photo.preview.w} x ${photo.preview.h} in ${photo.preview.ms} ms` : `not read: ${photo.preview.why}`} bad={!photo.preview.ok} />
          <Row k="Full size" v={photo.full.ok ? `${photo.full.w} x ${photo.full.h} in ${photo.full.ms} ms` : `not read: ${photo.full.why}`} bad={!photo.full.ok} />
        </div>}
      </section>

      <section className="space-y-2">
        <Button onClick={() => void copy()} disabled={!facts}>{copied ? "Copied" : "Copy the report"}</Button>
        <p className="text-xs text-muted-foreground">Then build a twin as a participant would, from <Link className="underline" to="/app/twins/new">New Field Twin</Link>, and come back here afterwards: a build the browser stopped is shown at the top.</p>
      </section>
    </div>
  );
}
