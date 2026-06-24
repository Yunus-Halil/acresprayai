import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Upload, Pencil, Loader2, Sparkles, FileDown, ArrowLeft, Trash2,
  CheckCircle2, AlertTriangle, FlaskConical, Save, X,
} from "lucide-react";
import PolygonMap, { type AnomalyShape, type ZoneShape } from "@/components/app/PolygonMap";
import {
  type Bounds, type LatLng, loadImageBitmap, parseGeoTiff, sampleZoneStats,
} from "@/lib/ndvi";
import jsPDF from "jspdf";

type Field = { id: string; name: string; crop: string; area_hectares: number; location: string | null };
type Ortho = {
  id: string; kind: string; storage_path: string;
  west: number; east: number; north: number; south: number;
  gsd_m_per_px: number | null; captured_at: string | null;
  signed_url?: string;
};
type ZoneRow = {
  id: string; name: string; crop: string; variety: string | null;
  area_ha: number; geojson: any;
};
type AnomalyRow = {
  id: string; zone_id: string; severity: "low"|"medium"|"high";
  ai_label: string | null; ai_reasoning: string | null;
  ndvi_mean: number | null; status: string; geojson: any; area_ha: number;
};
type SprayRec = {
  id: string; anomaly_id: string; chemical: string; chemical_class: string | null;
  dose_l_ha: number; total_l: number | null; rationale: string | null; status: string;
};

function ringFromGeoJSON(gj: any): LatLng[] {
  if (!gj || gj.type !== "Polygon") return [];
  const ring = gj.coordinates?.[0] ?? [];
  return ring.map((c: number[]) => ({ lng: c[0], lat: c[1] }));
}

function centroid(ring: LatLng[]): LatLng {
  const c = ring.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: c.lat / ring.length, lng: c.lng / ring.length };
}

export default function FieldMap() {
  const { id: fieldId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [field, setField] = useState<Field | null>(null);
  const [orthos, setOrthos] = useState<Ortho[]>([]);
  const [activeOrthoId, setActiveOrthoId] = useState<string | null>(null);
  const [activeNdviId, setActiveNdviId] = useState<string | null>(null);
  const [ndviOpacity, setNdviOpacity] = useState(0.6);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([]);
  const [recs, setRecs] = useState<SprayRec[]>([]);

  // Drawing state
  const [drawing, setDrawing] = useState(false);
  const [draftRing, setDraftRing] = useState<LatLng[]>([]);
  const [zoneForm, setZoneForm] = useState({ name: "", crop: "Corn", variety: "" });

  // Selection / edit state
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [pendingRing, setPendingRing] = useState<LatLng[] | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadKind, setUploadKind] = useState<"rgb" | "ndvi">("rgb");
  const [manualBounds, setManualBounds] = useState<Bounds | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [needsBounds, setNeedsBounds] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);

  // --- Loaders ---
  const loadField = async () => {
    if (!fieldId) return;
    const { data } = await supabase.from("fields").select("*").eq("id", fieldId).maybeSingle();
    setField(data as Field | null);
  };

  const loadOrthos = async () => {
    if (!fieldId) return;
    const { data } = await supabase
      .from("orthomosaics_geo")
      .select("*")
      .eq("field_id", fieldId)
      .eq("status", "ready")
      .order("created_at", { ascending: false });
    if (!data) { setOrthos([]); return; }
    const enriched: Ortho[] = await Promise.all((data as any[]).map(async (r) => {
      const { data: signed } = await supabase.storage
        .from("orthomosaics").createSignedUrl(r.storage_path, 3600);
      return {
        id: r.id, kind: r.kind, storage_path: r.storage_path,
        gsd_m_per_px: r.gsd_m_per_px, captured_at: r.captured_at,
        west: Number(r.west) || 0, east: Number(r.east) || 0,
        north: Number(r.north) || 0, south: Number(r.south) || 0,
        signed_url: signed?.signedUrl,
      };
    }));
    setOrthos(enriched);
    if (enriched.length > 0 && !activeOrthoId) {
      const rgb = enriched.find(o => o.kind === "rgb") ?? enriched[0];
      setActiveOrthoId(rgb.id);
      const ndvi = enriched.find(o => o.kind === "ndvi");
      if (ndvi) setActiveNdviId(ndvi.id);
    }
  };

  const loadZones = async () => {
    if (!fieldId) return;
    const { data } = await supabase
      .from("crop_zones_geo")
      .select("*")
      .eq("field_id", fieldId)
      .order("created_at", { ascending: false });
    setZones((data as ZoneRow[]) ?? []);
  };

  const loadAnomalies = async () => {
    if (zones.length === 0) { setAnomalies([]); return; }
    const zids = zones.map(z => z.id);
    const { data } = await supabase
      .from("anomalies_geo")
      .select("*")
      .in("zone_id", zids)
      .order("created_at", { ascending: false });
    setAnomalies((data as AnomalyRow[]) ?? []);
  };

  const loadRecs = async () => {
    if (anomalies.length === 0) { setRecs([]); return; }
    const aids = anomalies.map(a => a.id);
    const { data } = await supabase
      .from("spray_recommendations")
      .select("*")
      .in("anomaly_id", aids)
      .order("created_at", { ascending: false });
    setRecs((data as SprayRec[]) ?? []);
  };

  useEffect(() => { loadField(); loadOrthos(); loadZones(); /* eslint-disable-next-line */ }, [fieldId]);
  useEffect(() => { loadAnomalies(); /* eslint-disable-next-line */ }, [zones]);
  useEffect(() => { loadRecs(); /* eslint-disable-next-line */ }, [anomalies]);

  // --- Upload ortho ---
  const onFileSelected = async (file: File) => {
    setPendingFile(file);
    setManualBounds(null);
    setNeedsBounds(false);
    if (file.name.toLowerCase().endsWith(".tif") || file.name.toLowerCase().endsWith(".tiff")) {
      const parsed = await parseGeoTiff(file);
      if (parsed) {
        setManualBounds(parsed.bounds);
        toast.success(`GeoTIFF parsed · GSD ${parsed.gsd_m_per_px} m/px`);
      } else {
        toast.error("Could not read GeoTIFF — enter bounds manually");
        setNeedsBounds(true);
      }
    } else {
      setNeedsBounds(true);
    }
  };

  const finalizeUpload = async () => {
    if (!pendingFile || !user || !fieldId) return;
    if (!manualBounds) { toast.error("Bounds required"); return; }
    setUploading(true);
    try {
      const ext = pendingFile.name.split(".").pop() ?? "bin";
      const path = `${user.id}/${fieldId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("orthomosaics")
        .upload(path, pendingFile, { contentType: pendingFile.type || "application/octet-stream" });
      if (upErr) throw upErr;

      const wkt = `SRID=4326;POLYGON((${manualBounds.west} ${manualBounds.south}, ${manualBounds.east} ${manualBounds.south}, ${manualBounds.east} ${manualBounds.north}, ${manualBounds.west} ${manualBounds.north}, ${manualBounds.west} ${manualBounds.south}))`;

      const { error: insErr } = await supabase.from("orthomosaics").insert({
        user_id: user.id, field_id: fieldId, kind: uploadKind,
        storage_path: path, bounds: wkt, status: "ready",
        captured_at: new Date().toISOString(),
      });
      if (insErr) throw insErr;
      toast.success("Orthomosaic uploaded");
      setPendingFile(null); setManualBounds(null); setNeedsBounds(false);
      await loadOrthos();
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // --- Drawing ---
  const onDraftComplete = (ring: LatLng[]) => {
    setDraftRing(ring);
    setDrawing(false); // exit draw mode; show name/crop form
    toast.success(`Polygon drawn · ${ring.length} vertices. Name it and save.`);
  };
  const cancelDraw = () => { setDrawing(false); setDraftRing([]); };

  // Geometry change while editing — buffer until user clicks Save
  const onZoneEdit = (_id: string, ring: LatLng[]) => setPendingRing(ring);

  const startEdit = (id: string) => {
    setSelectedZoneId(id);
    setEditingZoneId(id);
    setPendingRing(null);
  };
  const cancelEdit = () => { setEditingZoneId(null); setPendingRing(null); };
  const saveEdit = async () => {
    if (!editingZoneId) return;
    if (!pendingRing) { setEditingZoneId(null); return; }
    const poly = pendingRing.map(p => [p.lng, p.lat]);
    const { error } = await supabase.rpc("update_crop_zone", { p_id: editingZoneId, p_polygon: poly });
    if (error) { toast.error(error.message); return; }
    toast.success("Zone updated");
    setEditingZoneId(null);
    setPendingRing(null);
    await loadZones();
  };

  const onZoneClick = (id: string) => {
    if (editingZoneId === id) return;
    if (editingZoneId && editingZoneId !== id) {
      // switch edit target — discard unsaved
      setPendingRing(null);
    }
    setSelectedZoneId(id);
    setEditingZoneId(id);
  };

  const finishZone = async () => {
    if (draftRing.length < 3) { toast.error("Need at least 3 points"); return; }
    if (!zoneForm.name || !zoneForm.crop) { toast.error("Name and crop required"); return; }
    const poly = draftRing.map(p => [p.lng, p.lat]);
    const { data, error } = await supabase.rpc("create_crop_zone", {
      p_field_id: fieldId,
      p_name: zoneForm.name,
      p_crop: zoneForm.crop,
      p_variety: zoneForm.variety || null,
      p_polygon: poly,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Crop zone saved");
    setDrawing(false); setDraftRing([]);
    setZoneForm({ name: "", crop: "Corn", variety: "" });
    await loadZones();
  };

  const deleteZone = async (id: string) => {
    await supabase.from("crop_zones").delete().eq("id", id);
    await loadZones();
  };

  // --- Analyze NDVI ---
  const runAnalysis = async () => {
    const active = orthos.find(o => o.id === (activeNdviId ?? activeOrthoId));
    if (!active?.signed_url) { toast.error("Upload an orthomosaic first"); return; }
    if (zones.length === 0) { toast.error("Draw at least one crop zone first"); return; }
    setAnalyzing(true);
    try {
      toast.message("Sampling pixels…");
      const img = await loadImageBitmap(active.signed_url);
      const bounds: Bounds = { north: active.north, south: active.south, east: active.east, west: active.west };
      const stats = zones.map(z => {
        const ring = ringFromGeoJSON(z.geojson);
        const s = sampleZoneStats(img, bounds, ring);
        return {
          zone_id: z.id, crop: z.crop, variety: z.variety ?? undefined,
          area_ha: Number(z.area_ha),
          ndvi_mean: s.ndvi_mean, ndvi_p10: s.ndvi_p10, ndvi_p90: s.ndvi_p90,
          stressed_pct: s.stressed_pct,
        };
      });

      toast.message("Running AI analysis…");
      const { data, error } = await supabase.functions.invoke("analyze-field", {
        body: { zones: stats },
      });
      if (error) throw error;
      const anomalies = (data?.anomalies ?? []) as any[];

      // Create anomaly + recommendation rows
      for (const a of anomalies) {
        const zone = zones.find(z => z.id === a.zone_id);
        if (!zone) continue;
        // Use the zone polygon as the anomaly polygon for v1
        const ring = ringFromGeoJSON(zone.geojson);
        const poly = ring.map(p => [p.lng, p.lat]);
        const stat = stats.find(s => s.zone_id === a.zone_id)!;
        const { data: anomId, error: aErr } = await supabase.rpc("create_anomaly", {
          p_zone_id: a.zone_id,
          p_orthomosaic_id: active.id,
          p_polygon: poly,
          p_ndvi_mean: stat.ndvi_mean,
          p_ndvi_p10: stat.ndvi_p10,
          p_ndvi_p90: stat.ndvi_p90,
          p_severity: a.severity ?? "medium",
          p_ai_label: a.ai_label ?? "Unknown",
          p_ai_reasoning: a.ai_reasoning ?? null,
          p_source: "ai",
        });
        if (aErr) { console.error(aErr); continue; }
        if (a.recommendation && anomId) {
          const total = +(a.recommendation.dose_l_ha * Number(zone.area_ha)).toFixed(2);
          await supabase.rpc("create_spray_recommendation", {
            p_anomaly_id: anomId,
            p_chemical: a.recommendation.chemical,
            p_chemical_class: a.recommendation.chemical_class,
            p_dose_l_ha: a.recommendation.dose_l_ha,
            p_total_l: total,
            p_rationale: a.recommendation.rationale,
          });
        }
      }
      toast.success(`Analyzed ${anomalies.length} zones`);
      await loadAnomalies();
    } catch (e: any) {
      toast.error(e.message ?? "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  // --- Approve recommendation -> create job ---
  const approveRec = async (rec: SprayRec) => {
    const anom = anomalies.find(a => a.id === rec.anomaly_id);
    const zone = zones.find(z => z.id === anom?.zone_id);
    if (!user || !zone || !anom) return;
    const { data: job, error } = await supabase.from("jobs").insert({
      user_id: user.id, field_id: fieldId, type: "spray",
      status: "scheduled", chemical: rec.chemical,
      dose_l_ha: rec.dose_l_ha, area_ha: anom.area_ha,
      notes: `${anom.ai_label ?? ""} — ${rec.rationale ?? ""}`.slice(0, 500),
    }).select().single();
    if (error) { toast.error(error.message); return; }
    await supabase.from("spray_recommendations").update({ status: "approved", job_id: job.id }).eq("id", rec.id);
    toast.success("Spray scheduled in Mission Planner");
    await loadRecs();
  };

  // --- Export PDF ---
  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("AcreSpray AI — Field Spray Record", 14, 18);
    doc.setFontSize(10);
    doc.text(`Field: ${field?.name ?? ""}  |  ${field?.crop ?? ""}  |  ${field?.area_hectares ?? 0} ha`, 14, 26);
    doc.text(`Operator: ${user?.email ?? ""}`, 14, 32);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 38);
    let y = 50;
    doc.setFontSize(12); doc.text("Crop zones", 14, y); y += 6;
    doc.setFontSize(9);
    zones.forEach(z => {
      doc.text(`• ${z.name} — ${z.crop}${z.variety ? ` (${z.variety})` : ""} — ${Number(z.area_ha).toFixed(2)} ha`, 16, y);
      y += 5;
    });
    y += 4;
    doc.setFontSize(12); doc.text("Anomalies & spray plan", 14, y); y += 6;
    doc.setFontSize(9);
    anomalies.forEach(a => {
      const z = zones.find(zz => zz.id === a.zone_id);
      const r = recs.find(rr => rr.anomaly_id === a.id);
      doc.text(`• ${z?.name ?? "?"} — ${a.severity.toUpperCase()} — ${a.ai_label ?? ""}`, 16, y); y += 5;
      doc.text(`  NDVI ${a.ndvi_mean ?? "?"}  Area ${Number(a.area_ha).toFixed(2)} ha`, 18, y); y += 5;
      if (r) {
        doc.text(`  Spray: ${r.chemical} @ ${r.dose_l_ha} L/ha  (total ${r.total_l ?? "?"} L)  [${r.status}]`, 18, y); y += 5;
      }
      if (y > 270) { doc.addPage(); y = 20; }
    });
    doc.save(`spray-record-${field?.name?.replace(/\s+/g, "_") ?? "field"}.pdf`);
  };

  // --- Render data ---
  const activeOrtho = orthos.find(o => o.id === activeOrthoId);
  const activeNdvi = orthos.find(o => o.id === activeNdviId);
  const overlay = activeOrtho?.signed_url
    ? { url: activeOrtho.signed_url, bounds: { north: activeOrtho.north, south: activeOrtho.south, east: activeOrtho.east, west: activeOrtho.west } }
    : null;
  const ndviOverlay = activeNdvi?.signed_url && activeNdvi.id !== activeOrthoId
    ? { url: activeNdvi.signed_url, bounds: { north: activeNdvi.north, south: activeNdvi.south, east: activeNdvi.east, west: activeNdvi.west }, opacity: ndviOpacity }
    : null;

  const mapCenter: LatLng = overlay
    ? { lat: (overlay.bounds.north + overlay.bounds.south) / 2, lng: (overlay.bounds.east + overlay.bounds.west) / 2 }
    : { lat: 37.5, lng: -78.6 }; // Virginia default

  const zoneShapes: ZoneShape[] = zones.map(z => ({
    id: z.id, name: z.name, crop: z.crop, ring: ringFromGeoJSON(z.geojson),
  }));
  const anomalyShapes: AnomalyShape[] = anomalies.map(a => ({
    id: a.id, ring: ringFromGeoJSON(a.geojson),
    severity: a.severity, label: `${a.ai_label ?? ""} (${a.severity})`,
  }));

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/app/fields")}>
            <ArrowLeft className="h-4 w-4" /> Fields
          </Button>
          <div>
            <h1 className="font-display text-2xl">{field?.name ?? "Field map"}</h1>
            <p className="text-xs text-muted-foreground">
              {field?.crop} · {field?.area_hectares} ha · {field?.location ?? ""}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportPdf}>
          <FileDown className="h-4 w-4" /> Export spray record
        </Button>
      </header>

      <div className="grid lg:grid-cols-[1fr_380px] gap-4">
        {/* Map */}
        <div className="space-y-2">
          <PolygonMap
            height={640}
            center={mapCenter}
            overlay={overlay}
            ndviOverlay={ndviOverlay}
            zones={zoneShapes}
            anomalies={anomalyShapes}
            drawing={drawing}
            draftRing={draftRing}
            selectedZoneId={selectedZoneId}
            editingZoneId={editingZoneId}
            onDraftComplete={onDraftComplete}
            onZoneClick={onZoneClick}
            onZoneEdit={onZoneEdit}
          />
          {editingZoneId && (
            <Card className="p-3 flex items-center gap-3 border-primary/40 bg-primary/5">
              <Pencil className="h-4 w-4 text-primary" />
              <div className="flex-1 text-xs text-muted-foreground">
                Editing <strong className="text-foreground">{zones.find(z => z.id === editingZoneId)?.name}</strong> — drag vertices or the whole shape. Snapping is on.
                {pendingRing && <span className="ml-2 text-primary">unsaved changes</span>}
              </div>
              <Button size="sm" variant="destructive" onClick={() => {
                const z = zones.find(zz => zz.id === editingZoneId);
                if (z && confirm(`Delete zone "${z.name}"? This removes its anomalies too.`)) {
                  deleteZone(z.id);
                  setEditingZoneId(null);
                  setSelectedZoneId(null);
                  setPendingRing(null);
                }
              }}><Trash2 className="h-4 w-4" /> Delete</Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit}><X className="h-4 w-4" /> Cancel</Button>
              <Button size="sm" onClick={saveEdit} disabled={!pendingRing}><Save className="h-4 w-4" /> Save</Button>
            </Card>
          )}
          {drawing && (
            <Card className="p-3 text-xs text-muted-foreground flex items-center gap-3">
              <Pencil className="h-4 w-4 text-primary" />
              <div className="flex-1">
                Click on the map to drop vertices. They <strong>snap</strong> to existing zones and the orthomosaic edge. <strong>Double-click</strong> the last point to finish, or press <kbd className="px-1 rounded bg-muted">Esc</kbd>.
              </div>
              <Button size="sm" variant="ghost" onClick={cancelDraw}>Cancel</Button>
            </Card>
          )}
          <Dialog
            open={!drawing && draftRing.length >= 3}
            onOpenChange={(open) => { if (!open) setDraftRing([]); }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Name this crop zone</DialogTitle>
                <DialogDescription>
                  {draftRing.length} vertices captured. Give the polygon a label so it shows up on the map and in your analysis.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Zone name *</Label>
                  <Input autoFocus placeholder="e.g. North block" value={zoneForm.name}
                    onChange={e => setZoneForm({ ...zoneForm, name: e.target.value })}
                    onKeyDown={e => { if (e.key === "Enter" && zoneForm.name && zoneForm.crop) finishZone(); }} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Crop *</Label>
                    <Input placeholder="Corn" value={zoneForm.crop}
                      onChange={e => setZoneForm({ ...zoneForm, crop: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Variety</Label>
                    <Input placeholder="optional" value={zoneForm.variety}
                      onChange={e => setZoneForm({ ...zoneForm, variety: e.target.value })} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDraftRing([])}>Discard</Button>
                <Button onClick={finishZone} disabled={!zoneForm.name || !zoneForm.crop}>
                  Save zone
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Side panel */}
        <div className="space-y-3">
          {/* Step 1: Orthomosaic */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Upload className="h-4 w-4" /> 1. Orthomosaic
              </div>
              <Badge variant="outline" className="text-[10px]">{orthos.length} uploaded</Badge>
            </div>
            <div className="flex gap-2">
              <Select value={uploadKind} onValueChange={(v: any) => setUploadKind(v)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rgb">RGB</SelectItem>
                  <SelectItem value="ndvi">NDVI</SelectItem>
                </SelectContent>
              </Select>
              <Input type="file" accept=".tif,.tiff,.jpg,.jpeg,.png"
                onChange={e => e.target.files?.[0] && onFileSelected(e.target.files[0])} />
            </div>
            {needsBounds && pendingFile && (
              <div className="space-y-2 p-2 rounded bg-muted/40">
                <div className="text-[10px] text-muted-foreground">Non-GeoTIFF — enter geographic bounds:</div>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" step="any" placeholder="North lat" onChange={e =>
                    setManualBounds(b => ({ ...(b ?? { north: 0, south: 0, east: 0, west: 0 }), north: +e.target.value }))} />
                  <Input type="number" step="any" placeholder="South lat" onChange={e =>
                    setManualBounds(b => ({ ...(b ?? { north: 0, south: 0, east: 0, west: 0 }), south: +e.target.value }))} />
                  <Input type="number" step="any" placeholder="East lng" onChange={e =>
                    setManualBounds(b => ({ ...(b ?? { north: 0, south: 0, east: 0, west: 0 }), east: +e.target.value }))} />
                  <Input type="number" step="any" placeholder="West lng" onChange={e =>
                    setManualBounds(b => ({ ...(b ?? { north: 0, south: 0, east: 0, west: 0 }), west: +e.target.value }))} />
                </div>
              </div>
            )}
            {pendingFile && (
              <Button size="sm" className="w-full" onClick={finalizeUpload} disabled={uploading || !manualBounds}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload {pendingFile.name.slice(0, 22)}
              </Button>
            )}
            {orthos.length > 0 && <Separator />}
            <div className="space-y-1.5 max-h-44 overflow-auto">
              {orthos.map(o => (
                <div key={o.id} className="text-xs flex items-center gap-2 p-2 rounded hover:bg-muted/40">
                  <Badge variant={o.kind === "ndvi" ? "default" : "outline"} className="text-[9px]">{o.kind}</Badge>
                  <button className={`flex-1 text-left ${activeOrthoId === o.id ? "font-semibold" : ""}`}
                    onClick={() => o.kind === "ndvi" ? setActiveNdviId(o.id) : setActiveOrthoId(o.id)}>
                    {o.gsd_m_per_px ? `${o.gsd_m_per_px} m/px` : ""} · {o.captured_at ? new Date(o.captured_at).toLocaleDateString() : ""}
                  </button>
                  {activeOrthoId === o.id && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                  {activeNdviId === o.id && <Sparkles className="h-3 w-3 text-primary" />}
                </div>
              ))}
            </div>
            {activeNdvi && (
              <div>
                <Label className="text-[10px]">NDVI opacity {Math.round(ndviOpacity * 100)}%</Label>
                <Slider value={[ndviOpacity * 100]} max={100} step={5}
                  onValueChange={v => setNdviOpacity(v[0] / 100)} />
              </div>
            )}
          </Card>

          {/* Step 2: Zones */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Pencil className="h-4 w-4" /> 2. Crop zones
              </div>
              <Badge variant="outline" className="text-[10px]">{zones.length}</Badge>
            </div>
            <Button size="sm" variant={drawing ? "secondary" : "default"} className="w-full"
              onClick={() => { setDrawing(d => !d); setDraftRing([]); }}>
              <Pencil className="h-4 w-4" /> {drawing ? "Drawing… click map" : "Draw new zone"}
            </Button>
            <div className="space-y-1.5 max-h-44 overflow-auto">
              {zones.map(z => (
                <div key={z.id}
                  className={`text-xs flex items-center gap-1 p-2 rounded cursor-pointer ${selectedZoneId === z.id ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/40"}`}
                  onClick={() => setSelectedZoneId(z.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{z.name}</div>
                    <div className="text-muted-foreground">{z.crop} · {Number(z.area_ha).toFixed(2)} ha</div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6"
                    onClick={(e) => { e.stopPropagation(); startEdit(z.id); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete zone "${z.name}"?`)) {
                        deleteZone(z.id);
                        if (selectedZoneId === z.id) setSelectedZoneId(null);
                      }
                    }}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
              {zones.length === 0 && <div className="text-xs text-muted-foreground italic">No zones drawn yet</div>}
            </div>
          </Card>

          {/* Step 3: Analyze */}
          <Card className="p-4 space-y-3">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> 3. AI analysis
            </div>
            <Button size="sm" className="w-full" disabled={analyzing || zones.length === 0 || orthos.length === 0}
              onClick={runAnalysis}>
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Analyze NDVI & flag anomalies
            </Button>
            <div className="space-y-1.5 max-h-44 overflow-auto">
              {anomalies.map(a => {
                const z = zones.find(zz => zz.id === a.zone_id);
                const color = a.severity === "high" ? "destructive" : a.severity === "medium" ? "default" : "secondary";
                return (
                  <div key={a.id} className="text-xs p-2 rounded border space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={color as any} className="text-[9px]">{a.severity}</Badge>
                      <span className="font-semibold">{z?.name}</span>
                      <span className="ml-auto text-muted-foreground">NDVI {a.ndvi_mean ?? "?"}</span>
                    </div>
                    <div className="font-medium">{a.ai_label}</div>
                    {a.ai_reasoning && <div className="text-[10px] text-muted-foreground">{a.ai_reasoning}</div>}
                  </div>
                );
              })}
              {anomalies.length === 0 && <div className="text-xs text-muted-foreground italic">No anomalies yet — run analysis</div>}
            </div>
          </Card>

          {/* Step 4: Spray plan */}
          <Card className="p-4 space-y-3">
            <div className="text-sm font-semibold flex items-center gap-2">
              <FlaskConical className="h-4 w-4" /> 4. Spray recommendations
            </div>
            <div className="space-y-1.5 max-h-56 overflow-auto">
              {recs.map(r => {
                const anom = anomalies.find(a => a.id === r.anomaly_id);
                const zone = zones.find(z => z.id === anom?.zone_id);
                return (
                  <div key={r.id} className="text-xs p-2 rounded border space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{zone?.name}</span>
                      <Badge variant="outline" className="text-[9px]">{r.chemical_class}</Badge>
                      <Badge variant={r.status === "approved" ? "default" : "secondary"} className="text-[9px] ml-auto">{r.status}</Badge>
                    </div>
                    <div>{r.chemical} · {r.dose_l_ha} L/ha · total {r.total_l ?? "?"} L</div>
                    {r.rationale && <div className="text-[10px] text-muted-foreground">{r.rationale}</div>}
                    {r.status === "pending" && (
                      <Button size="sm" className="w-full mt-1" onClick={() => approveRec(r)}>
                        Approve → Mission Planner
                      </Button>
                    )}
                  </div>
                );
              })}
              {recs.length === 0 && (
                <div className="text-xs text-muted-foreground italic">No recommendations yet</div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}