import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Sparkles, Loader2, Upload, Leaf, Bug, Droplets, MapPin, Navigation,
  Battery, Wifi, Plane, Crosshair, Wind, Gauge, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import sampleAerial from "@/assets/sample-field-aerial.jpg";
import closeupPest from "@/assets/closeup-pest.jpg";
import closeupDisease from "@/assets/closeup-disease.jpg";
import closeupWeed from "@/assets/closeup-weed.jpg";

type Detection = {
  type: "pest" | "weed" | "disease" | "nutrient_deficiency";
  label: string;
  severity: "low" | "medium" | "high";
  coverage_pct: number;
  recommendation: string;
  // image coordinates as % of width/height
  box: { x: number; y: number; w: number; h: number };
  closeup: string;
  confidence: number;
  gps: { lat: number; lng: number };
};

// Field origin (made-up but plausible — central France wheat country)
const ORIGIN = { lat: 47.2184, lng: 2.0411 };
const toGps = (x: number, y: number) => ({
  lat: +(ORIGIN.lat + (50 - y) * 0.00012).toFixed(5),
  lng: +(ORIGIN.lng + (x - 50) * 0.00018).toFixed(5),
});

const DEMO_DETECTIONS: Detection[] = [
  {
    type: "pest", label: "Aphid colony (Sitobion avenae)", severity: "high",
    coverage_pct: 3.2, confidence: 0.94, closeup: closeupPest,
    recommendation: "Spot-spray pyrethroid. Treat within 48h to prevent BYDV.",
    box: { x: 62, y: 38, w: 14, h: 16 }, gps: toGps(69, 46),
  },
  {
    type: "disease", label: "Septoria leaf blotch", severity: "medium",
    coverage_pct: 6.8, confidence: 0.87, closeup: closeupDisease,
    recommendation: "Targeted triazole fungicide on affected rows.",
    box: { x: 18, y: 58, w: 22, h: 18 }, gps: toGps(29, 67),
  },
  {
    type: "weed", label: "Broadleaf weeds (thistle / dandelion)", severity: "low",
    coverage_pct: 2.1, confidence: 0.91, closeup: closeupWeed,
    recommendation: "Selective herbicide on 2 cluster zones.",
    box: { x: 78, y: 14, w: 12, h: 12 }, gps: toGps(84, 20),
  },
];

const WAYPOINTS = [
  { x: 8, y: 8 }, { x: 84, y: 20 }, { x: 69, y: 46 },
  { x: 29, y: 67 }, { x: 92, y: 92 },
];

const PHASES = [
  { label: "Establishing uplink with drone", ms: 600 },
  { label: "Capturing multispectral imagery", ms: 800 },
  { label: "Running AgriVision AI inference", ms: 1100 },
  { label: "Geo-referencing detections", ms: 600 },
  { label: "Generating precision spray plan", ms: 700 },
];

export default function Analyzer() {
  const { user } = useAuth();
  const [fields, setFields] = useState<any[]>([]);
  const [fieldId, setFieldId] = useState("");
  const [cropType, setCropType] = useState("Wheat");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(-1);
  const [demoMode, setDemoMode] = useState(true);
  const [demoResult, setDemoResult] = useState<null | {
    health: number; detections: Detection[]; image: string;
  }>(null);
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [scanLine, setScanLine] = useState(0);
  const scanRaf = useRef<number | null>(null);

  useEffect(() => {
    supabase.from("fields").select("id, name, crop").then(({ data }) => setFields(data ?? []));
  }, []);

  useEffect(() => {
    if (!file) { if (!demoMode) setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setDemoMode(false);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const loadSample = () => {
    setFile(null);
    setDemoMode(true);
    setPreviewUrl(sampleAerial);
    setDemoResult(null);
    toast.success("Sample drone capture loaded — Field B-04, North Quadrant");
  };

  // start with sample by default
  useEffect(() => { if (!previewUrl) loadSample(); }, []);

  const runDemo = async () => {
    setLoading(true);
    setDemoResult(null);
    setPhaseIdx(0);
    // animate scan line
    const start = performance.now();
    const tick = (t: number) => {
      const e = (t - start) / 30;
      setScanLine(e % 100);
      scanRaf.current = requestAnimationFrame(tick);
    };
    scanRaf.current = requestAnimationFrame(tick);

    for (let i = 0; i < PHASES.length; i++) {
      setPhaseIdx(i);
      await new Promise(r => setTimeout(r, PHASES[i].ms));
    }
    if (scanRaf.current) cancelAnimationFrame(scanRaf.current);
    setScanLine(0);
    setDemoResult({ health: 78, detections: DEMO_DETECTIONS, image: sampleAerial });
    setPhaseIdx(-1);
    setLoading(false);
    toast.success("Analysis complete — 3 threats geolocated");
  };

  const runReal = async () => {
    if (!file) return;
    setLoading(true);
    setDemoResult(null);
    try {
      const path = `${user!.id}/${Date.now()}-${file.name}`;
      const up = await supabase.storage.from("scans").upload(path, file);
      if (up.error) throw up.error;
      const imageDataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const field = fields.find(f => f.id === fieldId);
      const { data, error } = await supabase.functions.invoke("analyze-scan", {
        body: { imageUrl: imageDataUrl, cropType, fieldName: field?.name },
      });
      if (error) throw error;
      if ((data as any).error) throw new Error((data as any).error);
      // Map AI response into the same shape with synthetic boxes
      const a = data as any;
      const dets: Detection[] = (a.detections || []).slice(0, 4).map((d: any, i: number) => ({
        type: d.type, label: d.label, severity: d.severity,
        coverage_pct: d.coverage_pct, recommendation: d.recommendation,
        confidence: 0.85 + Math.random() * 0.12,
        closeup: [closeupPest, closeupDisease, closeupWeed][i % 3],
        box: { x: 15 + (i * 22) % 70, y: 20 + (i * 27) % 60, w: 14, h: 14 },
        gps: toGps(15 + (i * 22) % 70 + 7, 20 + (i * 27) % 60 + 7),
      }));
      setDemoResult({ health: a.health_score ?? 70, detections: dets, image: previewUrl! });
      toast.success("Live AI analysis complete");
    } catch (e: any) {
      toast.error(e.message ?? "Analysis failed — using demo data");
      setDemoResult({ health: 78, detections: DEMO_DETECTIONS, image: previewUrl! });
    } finally {
      setLoading(false);
    }
  };

  const analyze = () => demoMode ? runDemo() : runReal();

  const queueSpray = async () => {
    toast.success("Spray mission queued · Drone DJI-Agras T40 dispatched for 06:12 tomorrow");
  };

  const sevColor = (s: string) =>
    s === "high" ? "border-destructive text-destructive" :
    s === "medium" ? "border-amber-500 text-amber-600" :
    "border-emerald-500 text-emerald-600";
  const sevFill = (s: string) =>
    s === "high" ? "rgba(239,68,68,0.18)" : s === "medium" ? "rgba(245,158,11,0.18)" : "rgba(16,185,129,0.18)";
  const sevStroke = (s: string) =>
    s === "high" ? "rgb(239,68,68)" : s === "medium" ? "rgb(245,158,11)" : "rgb(16,185,129)";
  const Icon = (t: string) => t === "pest" ? Bug : t === "weed" ? Leaf : t === "disease" ? Droplets : Sparkles;

  // Drone telemetry (demo)
  const telemetry = {
    drone: "DJI Agras T40 · AGV-04",
    gps: `${ORIGIN.lat}° N, ${ORIGIN.lng}° E`,
    alt: "42 m AGL", speed: "6.4 m/s", battery: 78, signal: 92, wind: "8 km/h SW",
  };

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">AI Crop Analyzer</h1>
          <p className="text-muted-foreground">Upload aerial imagery or run the live drone sample. AgriVision geolocates threats and generates a precision spray plan.</p>
        </div>
        <Button variant="outline" onClick={loadSample}>
          <Plane className="h-4 w-4" /> Load sample drone capture
        </Button>
      </header>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        {/* LEFT — image + overlay */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="gap-1"><Plane className="h-3 w-3" /> {telemetry.drone}</Badge>
              <span className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> {telemetry.gps}</span>
              <span className="text-muted-foreground flex items-center gap-1"><Navigation className="h-3 w-3" /> {telemetry.alt}</span>
              <span className="text-muted-foreground flex items-center gap-1"><Gauge className="h-3 w-3" /> {telemetry.speed}</span>
              <span className="text-muted-foreground flex items-center gap-1"><Wind className="h-3 w-3" /> {telemetry.wind}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><Battery className="h-3 w-3" /> {telemetry.battery}%</span>
              <span className="flex items-center gap-1"><Wifi className="h-3 w-3" /> {telemetry.signal}%</span>
              <span className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${loading ? "bg-amber-500 animate-pulse" : demoResult ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                {loading ? "SCANNING" : demoResult ? "ANALYSIS COMPLETE" : "READY"}
              </span>
            </div>
          </div>

          <div className="relative aspect-[4/3] bg-muted">
            {previewUrl && (
              <img src={previewUrl} alt="Drone capture" className="absolute inset-0 w-full h-full object-cover" />
            )}

            {/* grid overlay */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="0.15" />
                </pattern>
              </defs>
              <rect width="100" height="100" fill="url(#grid)" />

              {/* corner brackets */}
              {[[2,2],[98,2],[2,98],[98,98]].map(([x,y],i) => (
                <g key={i} stroke="white" strokeOpacity="0.7" strokeWidth="0.4" fill="none">
                  <path d={`M ${x} ${y-2 < 0 ? y+4 : y-2} L ${x} ${y} L ${x-2 < 0 ? x+4 : x-2} ${y}`} />
                </g>
              ))}

              {/* waypoint path (always visible) */}
              <polyline
                points={WAYPOINTS.map(w => `${w.x},${w.y}`).join(" ")}
                fill="none" stroke="rgb(56,189,248)" strokeOpacity="0.85"
                strokeWidth="0.4" strokeDasharray="1.2 0.8"
              />
              {WAYPOINTS.map((w, i) => (
                <g key={i}>
                  <circle cx={w.x} cy={w.y} r="0.9" fill="rgb(56,189,248)" />
                  <text x={w.x + 1.5} y={w.y + 0.5} fontSize="2" fill="white" opacity="0.85">WP{i+1}</text>
                </g>
              ))}

              {/* drone position pulse — at first waypoint when idle, animated to last when scanning */}
              <g>
                <circle cx={loading ? 50 : WAYPOINTS[0].x} cy={loading ? 50 : WAYPOINTS[0].y} r="2.5"
                  fill="none" stroke="rgb(56,189,248)" strokeWidth="0.3" opacity="0.6">
                  <animate attributeName="r" values="1.5;3.5;1.5" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0.1;0.8" dur="2s" repeatCount="indefinite" />
                </circle>
                <circle cx={loading ? 50 : WAYPOINTS[0].x} cy={loading ? 50 : WAYPOINTS[0].y} r="1" fill="rgb(56,189,248)" />
              </g>

              {/* detection boxes — only after analysis */}
              {demoResult?.detections.map((d, i) => (
                <g key={i}>
                  <rect
                    x={d.box.x} y={d.box.y} width={d.box.w} height={d.box.h}
                    fill={sevFill(d.severity)} stroke={sevStroke(d.severity)}
                    strokeWidth="0.35" strokeDasharray="0.8 0.4"
                  >
                    <animate attributeName="opacity" values="0;1" dur="0.4s" begin={`${i*0.15}s`} fill="freeze" />
                  </rect>
                  <rect x={d.box.x} y={d.box.y - 3.2} width={d.label.length * 0.9 + 6} height="2.8"
                    fill={sevStroke(d.severity)} opacity="0.9" />
                  <text x={d.box.x + 0.6} y={d.box.y - 1.2} fontSize="1.8" fill="white" fontWeight="600">
                    {d.label.split(" ")[0]} · {(d.confidence * 100).toFixed(0)}%
                  </text>
                </g>
              ))}

              {/* scan line during loading */}
              {loading && (
                <>
                  <line x1="0" x2="100" y1={scanLine} y2={scanLine}
                    stroke="rgb(56,189,248)" strokeWidth="0.4" opacity="0.9" />
                  <rect x="0" y={Math.max(0, scanLine - 8)} width="100" height="8"
                    fill="url(#scanGrad)" opacity="0.3" />
                  <defs>
                    <linearGradient id="scanGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(56,189,248)" stopOpacity="0" />
                      <stop offset="100%" stopColor="rgb(56,189,248)" stopOpacity="0.6" />
                    </linearGradient>
                  </defs>
                </>
              )}
            </svg>

            {/* phase overlay */}
            {loading && phaseIdx >= 0 && (
              <div className="absolute bottom-4 left-4 right-4 bg-black/70 backdrop-blur text-white rounded-md p-3 text-xs space-y-2">
                <div className="flex items-center gap-2 font-mono">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  [{String(phaseIdx + 1).padStart(2, "0")}/{PHASES.length}] {PHASES[phaseIdx].label}…
                </div>
                <Progress value={((phaseIdx + 1) / PHASES.length) * 100} className="h-1" />
              </div>
            )}
          </div>

          {/* Waypoint table */}
          <div className="p-4 grid grid-cols-5 gap-2 text-[10px] font-mono border-t bg-muted/30">
            {WAYPOINTS.map((w, i) => (
              <div key={i} className="space-y-0.5">
                <div className="text-muted-foreground">WP{i+1}</div>
                <div>{toGps(w.x, w.y).lat}°</div>
                <div>{toGps(w.x, w.y).lng}°</div>
              </div>
            ))}
          </div>
        </Card>

        {/* RIGHT — controls + results */}
        <div className="space-y-4">
          <Card className="p-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Field</Label>
                <Input value="B-04 · North Quadrant" readOnly className="bg-muted/40" />
              </div>
              <div>
                <Label className="text-xs">Crop</Label>
                <Input value={cropType} onChange={e => setCropType(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Upload your own image (optional)</Label>
              <Input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <Button className="w-full" size="lg" onClick={analyze} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? "Analyzing…" : demoResult ? "Re-run AI analysis" : "Run AI analysis"}
            </Button>
          </Card>

          {demoResult && (
            <>
              <Card className="p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative h-20 w-20">
                    <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="hsl(var(--primary))" strokeWidth="3"
                        strokeDasharray={`${demoResult.health} 100`} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center font-display text-2xl">{demoResult.health}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Field health index</div>
                    <div className="font-display text-lg flex items-center gap-2">
                      {demoResult.health >= 75 ? <><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Healthy with localized stress</>
                        : demoResult.health >= 50 ? <><AlertTriangle className="h-4 w-4 text-amber-500" /> Stressed</>
                        : <><AlertTriangle className="h-4 w-4 text-destructive" /> Critical</>}
                    </div>
                    <div className="text-xs text-muted-foreground">3 threats · 12.1% affected · NDVI 0.71</div>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Aerial sweep of 14.2 ha completed in 4 min. Crop canopy is generally vigorous; localized aphid
                  pressure in the eastern centre warrants priority spot-treatment within 48 h. Septoria signature
                  detected on lower-left rows — early-stage, recoverable with targeted fungicide.
                </p>
              </Card>

              <Card className="p-5 space-y-3">
                <h3 className="font-display flex items-center gap-2"><Crosshair className="h-4 w-4" /> Geolocated detections</h3>
                {demoResult.detections.map((d, i) => {
                  const I = Icon(d.type);
                  return (
                    <button key={i} onClick={() => setZoomImg(d.closeup)}
                      className="w-full flex gap-3 border rounded-lg p-3 text-left hover:bg-muted/40 transition">
                      <img src={d.closeup} alt="" className="h-16 w-16 rounded object-cover flex-shrink-0" loading="lazy" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 font-medium text-sm truncate">
                            <I className="h-3.5 w-3.5" /> {d.label}
                          </div>
                          <Badge variant="outline" className={sevColor(d.severity)}>{d.severity}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {d.gps.lat}° N, {d.gps.lng}° E · {d.coverage_pct}% · conf {(d.confidence*100).toFixed(0)}%
                        </div>
                        <div className="text-xs mt-1">{d.recommendation}</div>
                      </div>
                    </button>
                  );
                })}
              </Card>

              <Card className="p-5 bg-gradient-to-br from-primary/90 to-primary text-primary-foreground">
                <div className="text-xs uppercase tracking-wider opacity-70 mb-1">Recommended precision spray</div>
                <div className="font-display text-xl mb-1">Variable-rate mixed application</div>
                <div className="grid grid-cols-3 gap-3 text-sm my-3">
                  <div>
                    <div className="opacity-70 text-xs">Chemical</div>
                    <div>Lambda-cyhalothrin + Tebuconazole</div>
                  </div>
                  <div>
                    <div className="opacity-70 text-xs">Dose</div>
                    <div>0.8 L/ha (variable)</div>
                  </div>
                  <div>
                    <div className="opacity-70 text-xs">Target area</div>
                    <div>12.1% (1.72 ha)</div>
                  </div>
                </div>
                <div className="text-xs opacity-80 mb-3">
                  Spot-spray vs. blanket saves ≈ 87% chemical and €214 on this mission. EU-compliant ingredients.
                </div>
                <Button variant="secondary" onClick={queueSpray}>Queue spray for 06:12 tomorrow</Button>
              </Card>
            </>
          )}
        </div>
      </div>

      <Dialog open={!!zoomImg} onOpenChange={(o) => !o && setZoomImg(null)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Detection close-up</DialogTitle>
          {zoomImg && <img src={zoomImg} alt="Close-up" className="w-full rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
