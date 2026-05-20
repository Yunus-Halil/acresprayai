import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, Upload, Leaf, Bug, Droplets } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

type Detection = { type: string; label: string; severity: string; coverage_pct: number; recommendation: string };
type Analysis = { health_score: number; summary: string; detections: Detection[]; spray_plan: { recommended: boolean; chemical: string; dose_l_ha: number; target_area_pct: number; notes: string } };

export default function Analyzer() {
  const { user } = useAuth();
  const [fields, setFields] = useState<any[]>([]);
  const [fieldId, setFieldId] = useState("");
  const [cropType, setCropType] = useState("Wheat");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("fields").select("id, name, crop").then(({ data }) => setFields(data ?? []));
  }, []);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const analyze = async () => {
    if (!file) return toast.error("Pick an image first");
    setLoading(true);
    setResult(null);
    try {
      const path = `${user!.id}/${Date.now()}-${file.name}`;
      const up = await supabase.storage.from("scans").upload(path, file);
      if (up.error) throw up.error;

      // Encode as base64 data URL so the AI gateway doesn't need to fetch from storage
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
      const a = data as Analysis;
      setResult(a);

      const { data: ins } = await supabase.from("scans").insert({
        user_id: user!.id,
        field_id: fieldId || null,
        image_path: path,
        status: "complete",
        ai_summary: a.summary,
        detections: a.detections as any,
        health_score: a.health_score,
      }).select("id").single();
      setScanId(ins?.id ?? null);
      toast.success("Analysis complete");
    } catch (e: any) {
      toast.error(e.message ?? "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const queueSpray = async () => {
    if (!result || !user) return;
    const { error } = await supabase.from("jobs").insert({
      user_id: user.id,
      field_id: fieldId || null,
      scan_id: scanId,
      type: "spray",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      chemical: result.spray_plan.chemical,
      dose_l_ha: result.spray_plan.dose_l_ha,
    });
    if (error) return toast.error(error.message);
    toast.success("Spray mission queued for tomorrow");
  };

  const sev = (s: string) => s === "high" ? "bg-destructive text-destructive-foreground" : s === "medium" ? "bg-amber-500 text-white" : "bg-muted";
  const icon = (t: string) => t === "pest" ? Bug : t === "weed" ? Leaf : t === "disease" ? Droplets : Sparkles;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="font-display text-3xl">AI Crop Analyzer</h1>
        <p className="text-muted-foreground">Upload aerial or close-up imagery. AgriPulse identifies threats and generates a precision spray plan.</p>
      </header>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-6 space-y-4">
          <div>
            <Label>Field (optional)</Label>
            <Select value={fieldId} onValueChange={setFieldId}>
              <SelectTrigger><SelectValue placeholder="Choose a field" /></SelectTrigger>
              <SelectContent>
                {fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Crop type</Label>
            <Input value={cropType} onChange={e => setCropType(e.target.value)} />
          </div>
          <div>
            <Label>Crop image</Label>
            <div className="border-2 border-dashed rounded p-6 text-center">
              {previewUrl ? (
                <img src={previewUrl} alt="Preview" className="max-h-64 mx-auto rounded" />
              ) : (
                <div className="text-sm text-muted-foreground py-8">
                  <Upload className="h-6 w-6 mx-auto mb-2 opacity-50" />
                  Drop or pick a JPG/PNG of your crop
                </div>
              )}
              <Input type="file" accept="image/*" className="mt-3" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <Button className="w-full" onClick={analyze} disabled={loading || !file}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Analyzing…" : "Run AI analysis"}
          </Button>
        </Card>

        <Card className="p-6">
          {!result && !loading && <div className="text-sm text-muted-foreground text-center py-16">Results will appear here after analysis.</div>}
          {loading && <div className="text-sm text-muted-foreground text-center py-16"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" /> AgriPulse is inspecting your crop…</div>}
          {result && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] flex items-center justify-center font-display text-2xl">{result.health_score}</div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Health score</div>
                  <div className="font-display text-lg">{result.health_score >= 75 ? "Healthy" : result.health_score >= 50 ? "Stressed" : "Critical"}</div>
                </div>
              </div>
              <p className="text-sm leading-relaxed">{result.summary}</p>
              <div>
                <h3 className="font-display mb-2">Detections</h3>
                <ul className="space-y-2">
                  {result.detections.map((d, i) => {
                    const Icon = icon(d.type);
                    return (
                      <li key={i} className="border rounded p-3 text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 font-medium"><Icon className="h-4 w-4" /> {d.label}</div>
                          <Badge className={sev(d.severity)}>{d.severity}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">Coverage: {d.coverage_pct}% · {d.recommendation}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <Card className="p-4 bg-[hsl(var(--field))] text-[hsl(var(--primary-foreground))]">
                <div className="text-xs uppercase tracking-wider opacity-70 mb-1">Recommended spray plan</div>
                {result.spray_plan.recommended ? (
                  <>
                    <div className="font-display text-lg">{result.spray_plan.chemical} @ {result.spray_plan.dose_l_ha} L/ha</div>
                    <div className="text-sm opacity-80 mb-3">Target {result.spray_plan.target_area_pct}% of field. {result.spray_plan.notes}</div>
                    <Button variant="secondary" onClick={queueSpray}>Queue spray for tomorrow</Button>
                  </>
                ) : (
                  <div className="text-sm opacity-80">No spray needed. {result.spray_plan.notes}</div>
                )}
              </Card>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}