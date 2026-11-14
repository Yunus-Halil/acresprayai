// New Field Twin: three decisions (a name, the crop, the photographs), a check of the photographs before anything is
// built, then the build with plain progress. The build runs in this tab (lib/fieldTwin/buildSession), saves itself,
// and opens the twin as soon as it is listed.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, ChevronRight, FolderOpen, ImagePlus, Info, Loader2, OctagonX } from "lucide-react";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { usePilotRole } from "@/lib/pilot/access";
import { type CheckCrop, type CheckFinding, type PhotoCheck, assessPhotographs, readForCheck } from "@/lib/fieldTwin/preflight";
import { type BuildSessionState, cancelBuild, clearBuildSession, discardBuildSession, retrySave, sessionBusy, startBuildSession, useBuildSession } from "@/lib/fieldTwin/buildSession";
import { type BuildStage, stagesFor } from "@/lib/fieldTwin/build/types";
import { useAnalysisAllowed } from "@/lib/fieldTwin/analysisAccess";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtArea } from "@/lib/units";
import { track } from "@/lib/pilot/telemetry";
import { weedModelAvailable } from "@/lib/weedVision/flag";
import { FeedbackButton } from "@/components/pilot/FeedbackDialog";

/** The stages in words a grower uses. */
const STAGE_WORDS: Record<BuildStage, string> = {
  photographs: "Reading the photographs",
  cameras: "Placing the photographs on the ground",
  rows: "Finding the rows and the trees",
  corn: "Reading the corn rows, weeds and gaps in every photograph",
  weeds: "Looking for weeds",
  vegetation: "Other green on the ground",
  evidence: "Looking at the field's edges",
  boundary: "Drawing the field boundary",
  bundle: "Putting the twin together",
};

/** What this browser lacks to build a twin, or null. Viewing needs much less. */
export function buildBlocker(): string | null {
  const g = globalThis as Record<string, unknown>;
  const missing = ["Worker", "OffscreenCanvas", "createImageBitmap", "CompressionStream"].filter(k => typeof g[k] === "undefined");
  return missing.length ? "This browser cannot build a Field Twin. Use a recent Chrome or Edge on a desktop or laptop computer. Saved twins can still be opened here." : null;
}

/** A build error in plain words. */
export function plainBuildError(message: string): string {
  if (/updated after this page was opened/i.test(message)) return message;
  if (/out of memory|allocation failed|RangeError|Array buffer allocation/i.test(message)) return "The computer ran out of memory building this flight. Close other tabs and try again, or build a smaller part of the field.";
  if (/no photograph holds a camera|only one photograph/i.test(message)) return "Swardus could not place enough of these photographs on the ground to build a twin. Check that they are from one DJI flight, camera pointing down.";
  if (/worker failed to start/i.test(message)) return "The build could not start in this browser. Reload the page and try again; if it happens again, use a recent Chrome or Edge.";
  return `The build stopped: ${message}`;
}

const fmtMs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${Math.max(1, Math.round(ms / 1000))} s`);

function FindingLine({ f }: { f: CheckFinding }) {
  const [open, setOpen] = useState(false);
  const Icon = f.level === "stop" ? OctagonX : f.level === "warning" ? AlertTriangle : Info;
  const tone = f.level === "stop" ? "text-destructive" : f.level === "warning" ? "text-amber-700" : "text-muted-foreground";
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-label={f.level} />
      <div>
        <span className={f.level === "note" ? "text-muted-foreground" : ""}>{f.text}</span>
        {f.files && f.files.length > 0 && (
          <>
            <button type="button" className="ml-1 inline-flex items-center text-xs text-muted-foreground underline underline-offset-2" onClick={() => setOpen(o => !o)} aria-expanded={open}>
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}which
            </button>
            {open && <ul className="mt-1 font-mono text-xs text-muted-foreground">{f.files.map(n => <li key={n}>{n}</li>)}</ul>}
          </>
        )}
      </div>
    </li>
  );
}

function Progress({ s, founder }: { s: Exclude<BuildSessionState, { status: "idle" }>; founder: boolean }) {
  const nav = useNavigate();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (s.status !== "building" && s.status !== "saving") return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [s.status]);
  const stages = stagesFor(s.crop);
  const current = s.progress?.stage;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl">{s.name}</h1>
        <p className="text-sm text-muted-foreground">{s.crop === "corn" ? "Corn" : "Orchard"} · {s.photographs.toLocaleString()} photographs</p>
      </div>
      {(s.status === "building" || s.status === "saving") && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Keep this tab open until the twin is saved. You can use other parts of Swardus in the meantime.
        </div>
      )}
      <ol className="space-y-2 rounded-lg border bg-card p-4">
        {stages.map(st => {
          const done = s.status !== "building" ? s.status !== "failed" && s.status !== "cancelled" : s.stagesDone.includes(st.id);
          const active = s.status === "building" && current === st.id;
          return (
            <li key={st.id} className={`flex items-start gap-2 text-sm ${done ? "text-muted-foreground" : active ? "" : "text-muted-foreground/60"}`}>
              <span className="mt-0.5 w-4 shrink-0">{done ? <Check className="h-4 w-4 text-emerald-600" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : null}</span>
              <span>
                {STAGE_WORDS[st.id]}
                {active && s.progress && <span className="block text-xs text-muted-foreground">{s.progress.total != null ? `${s.progress.done.toLocaleString()} of ${s.progress.total.toLocaleString()}` : ""}{founder && s.progress.message ? ` · ${s.progress.message}` : ""}</span>}
              </span>
            </li>
          );
        })}
        <li className={`flex items-start gap-2 text-sm ${s.status === "saved" ? "text-muted-foreground" : s.status === "saving" ? "" : "text-muted-foreground/60"}`}>
          <span className="mt-0.5 w-4 shrink-0">{s.status === "saved" ? <Check className="h-4 w-4 text-emerald-600" /> : s.status === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}</span>
          <span>Saving to your account{s.status === "saving" && s.save ? <span className="block text-xs text-muted-foreground">{s.save.done} of {s.save.total} files</span> : null}</span>
        </li>
      </ol>
      <p className="text-xs text-muted-foreground">{s.status === "building" || s.status === "saving" ? `Running for ${fmtMs(now - s.startedAt)}.` : s.buildMs != null ? `Built in ${fmtMs(s.buildMs)}.` : null}</p>

      {s.status === "building" && <Button variant="outline" onClick={cancelBuild}>Cancel the build</Button>}
      {(s.status === "saving" || s.status === "saved") && s.record && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => nav(`/app/twins/${s.record!.id}`)}>Open the Field Twin</Button>
          {s.status === "saved" && <Button variant="outline" onClick={clearBuildSession}>Build another Field Twin</Button>}
        </div>
      )}
      {s.status === "save-failed" && (
        <div role="alert" className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p>The twin was built, but saving it to your account failed: {s.error}. It is still held in this tab.</p>
          <div className="flex flex-wrap gap-2"><Button onClick={retrySave}>Try saving again</Button><FeedbackButton kind="problem" twinId={s.record?.id ?? null} context={{ stage: "save", error: s.error ?? "" }} label="Report this problem" /></div>
          {/* The way out when saving keeps failing: the photographs are still on this device, so nothing is lost but the build's time. */}
          <p className="text-xs text-muted-foreground">If it keeps failing you can <button type="button" className="underline underline-offset-4" onClick={discardBuildSession}>give up on this build</button> and build it again from the photographs. It will be listed as not saved, with Delete.</p>
        </div>
      )}
      {(s.status === "failed" || s.status === "cancelled") && (
        <div role="alert" className="space-y-3 rounded-md border bg-card p-4 text-sm">
          <p>{s.status === "cancelled" ? "The build was cancelled. Nothing was saved." : plainBuildError(s.error ?? "unknown error")}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={clearBuildSession}>Start again</Button>
            {s.status === "failed" && <FeedbackButton kind="problem" context={{ stage: s.progress?.stage ?? "", error: s.error ?? "" }} label="Report this problem" />}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TwinNew() {
  const { user } = useAuth();
  const founder = usePilotRole() === "founder";
  const analysisAllowed = useAnalysisAllowed();
  const units = useUnitSystem();
  const session = useBuildSession();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [crop, setCrop] = useState<CheckCrop | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [checked, setChecked] = useState<{ inputs: Awaited<ReturnType<typeof readForCheck>>["inputs"]; otherFiles: number } | null>(null);
  const [weeds, setWeeds] = useState<"colour" | "none" | "model">("colour");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const blocker = useMemo(buildBlocker, []);
  const autoOpened = useRef<string | null>(null);

  // Open the twin as soon as the save has listed it (the viewer shows the save finishing).
  useEffect(() => {
    if (session.status === "saving" && session.record && autoOpened.current !== session.record.id) {
      autoOpened.current = session.record.id;
      nav(`/app/twins/${session.record.id}`);
    }
  }, [session, nav]);

  const check: PhotoCheck | null = useMemo(() => (checked ? assessPhotographs(checked.inputs, crop, founder ? "founder" : "participant", checked.otherFiles) : null), [checked, crop, founder]);
  useEffect(() => {
    if (!check) return;
    track("twin_check_done", { counts: { files: check.totalFiles, usable: check.usable.length, stops: check.findings.filter(f => f.level === "stop").length, warnings: check.findings.filter(f => f.level === "warning").length }, detail: { crop: crop ?? "", camera: check.camera ?? "" } });
  }, [check, crop]);

  const pick = async (list: FileList | File[] | null) => {
    const picked = list ? [...list] : [];
    if (!picked.length) return;
    setFiles(picked); setChecked(null);
    if (!name) {
      const folder = (picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0];
      if (folder) setName(folder);
    }
    setReading({ done: 0, total: picked.length });
    try {
      const r = await readForCheck(picked, (done, total) => setReading({ done, total }));
      setChecked(r);
    } finally {
      setReading(null);
      if (fileInput.current) fileInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
    }
  };

  const build = () => {
    if (!check || !user || !crop) return;
    const keep = new Set(check.usable);
    const usable = files.filter(f => keep.has(f.name));
    startBuildSession(usable, { name: name.trim() || "Field", crop, weeds: founder ? weeds : "colour", userId: user.id, analysis: analysisAllowed });
  };

  if (session.status !== "idle") {
    return <div className="mx-auto max-w-2xl p-6 sm:p-10"><Seo title="Building a Field Twin, Swardus" noindex /><Progress s={session} founder={founder} /></div>;
  }

  const stops = check?.findings.filter(f => f.level === "stop") ?? [];
  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6 sm:p-10">
      <Seo title="New Field Twin, Swardus" noindex />
      <header>
        <Link to="/app/twins" className="text-sm text-muted-foreground hover:underline">Field Twins</Link>
        <h1 className="font-display text-3xl">New Field Twin</h1>
        <p className="mt-1 text-sm text-muted-foreground">From the photographs of one drone flight. <Link to="/app/help" className="underline underline-offset-4">Which photographs work</Link></p>
      </header>

      {blocker && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{blocker}</div>}

      <section className="space-y-2">
        <Label htmlFor="twin-name" className="text-base">1. Field name</Label>
        <Input id="twin-name" value={name} onChange={e => setName(e.target.value)} placeholder="North block, June flight" maxLength={200} />
      </section>

      <fieldset className="space-y-2">
        <legend className="text-base font-medium">2. Crop</legend>
        {([["corn", "Corn"], ["orchard", "Orchard"]] as const).map(([v, label]) => (
          <label key={v} className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 ${crop === v ? "border-foreground bg-muted/40" : ""}`}>
            <input type="radio" name="crop" checked={crop === v} onChange={() => setCrop(v)} />
            <span className="font-medium">{label}</span>
          </label>
        ))}
        {founder && crop === "orchard" && (
          <label className="block text-sm">Weed pass (founder)
            <select className="ml-2 rounded border px-2 py-1 text-sm" value={weeds} onChange={e => setWeeds(e.target.value as typeof weeds)}>
              <option value="colour">Colour rules</option>
              <option value="none">None</option>
              {weedModelAvailable() && <option value="model">Model (local service)</option>}
            </select>
          </label>
        )}
      </fieldset>

      <section className="space-y-3">
        <div className="text-base font-medium">3. Photographs</div>
        <div
          className={`rounded-lg border-2 border-dashed p-6 text-center text-sm ${dragging ? "border-foreground bg-muted/40" : "border-muted-foreground/30"}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); void pick(e.dataTransfer.files); }}
        >
          <p className="text-muted-foreground">Drop the flight's photographs here, or</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" onClick={() => folderInput.current?.click()} disabled={!!reading}><FolderOpen className="h-4 w-4" />Choose the flight's folder</Button>
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={!!reading}><ImagePlus className="h-4 w-4" />Choose photographs</Button>
          </div>
          <input ref={fileInput} type="file" multiple accept=".jpg,.jpeg,.tif,.tiff,image/jpeg,image/tiff" className="hidden" onChange={e => void pick(e.target.files)} />
          <input ref={folderInput} type="file" className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={e => void pick(e.target.files)} />
          <p className="mt-3 text-xs text-muted-foreground">The photographs stay on this device. Only the finished twin is saved to your account.</p>
        </div>
        {reading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking the photographs: {reading.done.toLocaleString()} of {reading.total.toLocaleString()}</p>}

        {check && !reading && (
          <div className="space-y-3 rounded-lg border bg-card p-4" aria-label="Photograph check">
            <p className="font-medium">
              {check.usable.length.toLocaleString()} of {check.totalFiles.toLocaleString()} file{check.totalFiles === 1 ? "" : "s"} can be used
            </p>
            {check.usable.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {check.camera && <><dt className="text-muted-foreground">Camera</dt><dd>{check.camera}</dd></>}
                {check.gsdCm != null && <><dt className="text-muted-foreground">Detail</dt><dd>about {check.gsdCm.toFixed(1)} cm of ground per pixel</dd></>}
                {check.areaHa != null && <><dt className="text-muted-foreground">Ground covered</dt><dd>about {fmtArea(check.areaHa * 10_000, units).text}</dd></>}
                {check.capturedAt && <><dt className="text-muted-foreground">Flown</dt><dd>{check.capturedAt.replace(/^(\d{4}):(\d{2}):(\d{2}).*/, "$1-$2-$3")}</dd></>}
                <dt className="text-muted-foreground">Position</dt><dd>{check.rtk === "all" ? "RTK (centimetre-level)" : check.rtk === "some" ? "partly RTK" : "GPS (a metre or a few)"}</dd>
              </dl>
            )}
            {check.findings.length > 0 && <ul className="space-y-2">{check.findings.map(f => <FindingLine key={f.text} f={f} />)}</ul>}
          </div>
        )}
      </section>

      <div className="space-y-2">
        <Button size="lg" onClick={build} disabled={!!blocker || !check || !check.canBuild || !crop || !!reading || sessionBusy(session)}>Build the Field Twin</Button>
        <p className="text-xs text-muted-foreground">
          {!crop ? "Choose the crop first." : !check ? "Choose the photographs first." : stops.length ? "This set cannot be built: see above." : `Building takes a few minutes${crop === "corn" ? ", several seconds per photograph for corn" : ""}. Keep this tab open until it says the twin is saved.`}
        </p>
      </div>
    </div>
  );
}
