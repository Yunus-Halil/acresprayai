import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: ud } = await supabase.auth.getUser();
    if (!ud.user) return json({ error: "Unauthorized" }, 401);

    const { task_id } = await req.json().catch(() => ({}));
    if (!task_id) return json({ error: "Missing task_id" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: task } = await admin.from("odm_tasks")
      .select("id, user_id, ortho_path").eq("id", task_id).maybeSingle();
    if (!task || task.user_id !== ud.user.id) return json({ error: "Not found" }, 404);
    if (!task.ortho_path) return json({ error: "Orthomosaic not ready" }, 409);

    const { data: signed, error: sErr } = await admin.storage.from("orthos")
      .createSignedUrl(task.ortho_path, 60 * 15);
    if (sErr || !signed?.signedUrl) return json({ error: "sign failed" }, 500);

    // 1) Get a high-res PNG preview + bounds from TiTiler.
    const previewUrl = `https://titiler.xyz/cog/preview.png?url=${encodeURIComponent(signed.signedUrl)}&max_size=2048`;
    const tjUrl = `https://titiler.xyz/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(signed.signedUrl)}&tilesize=256`;

    const [imgRes, tjRes] = await Promise.all([fetch(previewUrl), fetch(tjUrl)]);
    if (!imgRes.ok) return json({ error: `Preview fetch failed (${imgRes.status})` }, 500);
    const tj = tjRes.ok ? await tjRes.json() : null;
    const b = tj?.bounds as number[] | undefined;
    if (!b || b.length !== 4) return json({ error: "Missing bounds" }, 500);
    const [west, south, east, north] = b;

    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    // base64 encode without blowing the call stack
    let bin = "";
    for (let i = 0; i < imgBytes.length; i += 0x8000) {
      bin += String.fromCharCode(...imgBytes.subarray(i, i + 0x8000));
    }
    const dataUrl = `data:image/png;base64,${btoa(bin)}`;

    // 2) Ask Gemini vision for a structured agronomy report.
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const system = `You are a precision-agriculture analyst examining a high-resolution drone orthomosaic of a farm field.

Identify and mark with PRECISE polygon coordinates every distinct issue you can see:
- Bare soil patches (brown/grey areas with no crop cover)
- Nutrient deficiency zones (yellowing, pale green areas)
- Waterlogging (dark patches, standing water, saturated soil)
- Weed pressure (irregular texture different from crop rows)
- Crop row gaps or poor establishment
- Pest/disease damage (discolored or wilted patches)
- Drought stress (uniform fading/curling)

Rules:
- Be precise. Do NOT group multiple distinct patches into one zone — each separate patch gets its own polygon.
- Use the EXACT issue type, not a broad category (e.g. "Nitrogen deficiency" not "stress").
- Recommend a specific treatment with product type and application rate.
- Estimate affected area in acres assuming the entire visible field is roughly \`field_acres\` acres (use coverage_pct of the full image area).
- If the field is genuinely healthy and uniform, return zones: [].

Return STRICT JSON with this exact schema:
{
  "health_score": 0-100,
  "summary": "1-2 sentence overall assessment",
  "issues": [ { "label": string, "severity": "low"|"medium"|"high", "description": string } ],
  "zones": [
    {
      "name": string,
      "issue": string,
      "severity": "low"|"medium"|"high",
      "coverage_pct": number,
      "area_acres": number,
      "recommendation": { "action": "spray"|"irrigate"|"reseed"|"fertilize"|"monitor", "product": string, "dose": string, "rationale": string },
      "polygon": [ [x, y], [x, y], ... ]
    }
  ]
}
Polygon coordinates MUST be normalized to the image: x ∈ [0,1] from LEFT edge, y ∈ [0,1] from TOP edge. Use 4-12 vertices per polygon tight to the patch boundary.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: [
            { type: "text", text: "Analyze this high-resolution orthomosaic. Mark every distinct bare patch, nutrient deficiency, waterlogging, weed cluster, row gap, and stress zone with its own tight polygon. Be specific about issue type and treatment." },
            { type: "image_url", image_url: { url: dataUrl } },
          ]},
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!aiRes.ok) {
      const t = await aiRes.text();
      if (aiRes.status === 429) return json({ error: "AI rate limit, retry shortly" }, 429);
      if (aiRes.status === 402) return json({ error: "AI credits exhausted" }, 402);
      return json({ error: `AI gateway ${aiRes.status}: ${t.slice(0, 300)}` }, 500);
    }
    const aiData = await aiRes.json();
    const content = aiData?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { parsed = { health_score: 0, issues: [], zones: [] }; }

    // 3) Convert normalized polygons to lat/lng using bounds.
    const toLatLng = (x: number, y: number) => {
      const cx = Math.max(0, Math.min(1, x));
      const cy = Math.max(0, Math.min(1, y));
      return {
        lng: west + cx * (east - west),
        lat: north - cy * (north - south),
      };
    };

    const zones = Array.isArray(parsed.zones) ? parsed.zones.map((z: any, i: number) => ({
      id: `ai-${i}`,
      name: z.name ?? `Zone ${i + 1}`,
      issue: z.issue ?? "",
      severity: z.severity ?? "medium",
      coverage_pct: Number(z.coverage_pct ?? 0),
      recommendation: z.recommendation ?? null,
      ring: Array.isArray(z.polygon)
        ? z.polygon
            .filter((p: any) => Array.isArray(p) && p.length === 2)
            .map(([x, y]: number[]) => toLatLng(x, y))
        : [],
    })).filter((z: any) => z.ring.length >= 3) : [];

    return json({
      health_score: Number(parsed.health_score ?? 0),
      summary: parsed.summary ?? "",
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      zones,
      bounds: { west, south, east, north },
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});