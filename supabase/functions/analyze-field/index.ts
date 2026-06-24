// Analyze per-zone NDVI stats with Lovable AI, returning anomalies + spray recommendations.
import { corsHeaders } from "../_shared/cors.ts";

type ZoneStat = {
  zone_id: string;
  crop: string;
  variety?: string;
  area_ha: number;
  ndvi_mean: number;
  ndvi_p10: number;
  ndvi_p90: number;
  stressed_pct: number; // 0..1, fraction of samples below 0.4
};

type AnomalyOut = {
  zone_id: string;
  severity: "low" | "medium" | "high";
  ai_label: string;
  ai_reasoning: string;
  recommendation: {
    chemical: string;
    chemical_class: string;
    dose_l_ha: number;
    rationale: string;
  } | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const zones: ZoneStat[] = body?.zones ?? [];
    if (!Array.isArray(zones) || zones.length === 0) {
      return new Response(JSON.stringify({ error: "zones[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const system = `You are an agronomy assistant analyzing NDVI imagery for spray drone operations.
For each crop zone you receive NDVI statistics (mean, 10th/90th percentile, % stressed).
Classify the most likely cause of stress, severity, and a spray recommendation when applicable.

NDVI guide: >0.7 healthy canopy. 0.5-0.7 moderate. 0.3-0.5 stressed. <0.3 bare/very stressed.

Likely causes by pattern (pick ONE most likely):
- "Drought stress" - low mean, uniform low NDVI, summer crops
- "Nutrient deficiency (N)" - low mean, yellowing pattern, cereals
- "Pest pressure" - patchy (wide p10-p90 gap), holes in canopy
- "Fungal disease" - patchy low areas, humid crops (wheat, barley)
- "Waterlogging" - low NDVI in clusters, after rain
- "Healthy" - mean > 0.65, narrow p10-p90 gap

Spray recommendations (only when severity >= medium):
- Drought stress -> no spray, recommend irrigation
- Nutrient deficiency (N) -> Urea 46% foliar, 0.6 L/ha, class: fertilizer
- Pest pressure -> Lambda-cyhalothrin, 0.8 L/ha, class: insecticide
- Fungal disease -> Tebuconazole 250 EC, 1.2 L/ha, class: fungicide
- Waterlogging -> no spray, recommend drainage

Severity: low (mean>0.6), medium (0.45-0.6), high (<0.45 or stressed_pct>0.3).

Return STRICT JSON: { "anomalies": [ { zone_id, severity, ai_label, ai_reasoning, recommendation: { chemical, chemical_class, dose_l_ha, rationale } | null } ] }
Include one entry per zone. Set recommendation to null for "Healthy" or non-sprayable causes.`;

    const userMsg = `Analyze these crop zones:\n${JSON.stringify(zones, null, 2)}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "AI rate limit exceeded, retry shortly" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted - top up in Settings" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: `AI gateway ${resp.status}: ${text}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { anomalies: AnomalyOut[] };
    try { parsed = JSON.parse(content); }
    catch { parsed = { anomalies: [] }; }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});