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

    const body = await req.json().catch(() => ({}));
    const { task_id, boundary } = body as {
      task_id?: string;
      boundary?: { lat: number; lng: number }[] | { lat: number; lng: number }[][];
    };
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

    // Validate the user-supplied field boundary. May be a single ring (legacy)
    // or an array of rings (fragmented field with multiple parts). The AI must
    // restrict its analysis to the union of these polygons.
    const isRing = (r: unknown): r is { lat: number; lng: number }[] =>
      Array.isArray(r) && r.length >= 3 &&
      r.every((p: any) => typeof p?.lat === "number" && typeof p?.lng === "number");
    let rings: { lat: number; lng: number }[][] = [];
    if (Array.isArray(boundary) && boundary.length > 0) {
      if (isRing(boundary)) rings = [boundary];
      else rings = (boundary as any[]).filter(isRing);
    }
    const hasBoundary = rings.length > 0;
    const ringToWKT = (r: { lat: number; lng: number }[]) =>
      `((${[...r, r[0]].map(p => `${p.lng} ${p.lat}`).join(", ")}))`;
    const boundaryWKT = hasBoundary
      ? (rings.length === 1
          ? `POLYGON${ringToWKT(rings[0])}`
          : `MULTIPOLYGON(${rings.map(ringToWKT).join(", ")})`)
      : null;

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

    const system = `You are a precision-agriculture analyst examining an RGB drone orthomosaic of a farm field.

STRICT RULE: Only flag what you can see with HIGH CONFIDENCE in RGB imagery. Never guess. A farmer trusts you with their livelihood.

What you CAN detect in RGB:
- Bare soil patches (visibly brown/grey with no crop cover)
- Obvious large-scale visible discoloration (yellowing visible to the naked eye)
- Waterlogged areas (dark saturated patches, standing water)
- Crop row gaps or missing establishment (visible breaks in row pattern)
- Field boundary issues (visible erosion, encroachment)

What you CANNOT detect in RGB and MUST NEVER claim:
- Nitrogen, phosphorus, or potassium deficiency (requires multispectral NDVI)
- Disease or pest pressure (requires multispectral or ground truth)
- Early stress before visible symptoms
- Soil nutrient levels of any kind
- Weed species identification

Rules:
- Allowed issue values ONLY: "Bare soil", "Visible discoloration", "Waterlogging", "Row gap", "Boundary issue".
- Allowed confidence ONLY: "HIGH" or "MEDIUM". Never flag LOW confidence zones — omit them entirely.
- "what_you_see" must literally describe pixels (e.g. "Brown soil visible, no crop cover present"). No inference.
- Only include "recommendation" for HIGH confidence zones. For MEDIUM, set recommendation to null.
- If multispectral data would improve diagnosis, add a string to "multispectral_recommendations" (e.g. "Multispectral scan recommended to confirm nutrient deficiency").
- Each distinct patch is its own polygon — do not group.
- Estimate area in acres from coverage_pct of the full image area.
- If the field shows no clearly visible issues, return zones: [].
- health_score: 100 minus the % of field area with visible issues. Do NOT factor in anything you cannot visually confirm.
- Tone: direct, honest, conservative. Never overclaim.

Return STRICT JSON with this exact schema:
{
  "health_score": 0-100,
  "summary": "1-2 sentence honest assessment of what is visually observable",
  "multispectral_recommendations": [ string ],
  "issues": [ { "label": string, "severity": "low"|"medium"|"high", "description": string } ],
  "zones": [
    {
      "name": string,
      "issue": "Bare soil"|"Visible discoloration"|"Waterlogging"|"Row gap"|"Boundary issue",
      "what_you_see": string,
      "confidence": "HIGH"|"MEDIUM",
      "severity": "low"|"medium"|"high",
      "coverage_pct": number,
      "area_acres": number,
      "recommendation": { "action": "spray"|"irrigate"|"reseed"|"fertilize"|"monitor", "product": string, "dose": string, "rationale": string } | null,
      "polygon": [ [lat, lng], [lat, lng], ... ]
    }
  ]
}

GEOREFERENCING (CRITICAL):
The orthomosaic image you are looking at is georeferenced. Its pixel extent maps DIRECTLY onto this WGS84 bounding box:
  north (top edge latitude):  ${north}
  south (bottom edge latitude): ${south}
  west  (left edge longitude):  ${west}
  east  (right edge longitude): ${east}

For every polygon vertex you output:
  - Return REAL WGS84 [latitude, longitude] pairs (decimal degrees).
  - latitude MUST be between ${south} and ${north}.
  - longitude MUST be between ${west} and ${east}.
  - DO NOT return pixel coordinates. DO NOT return normalized 0–1 values. DO NOT swap lat/lng.
  - The TOP of the image is north (higher latitude). The LEFT of the image is west (lower longitude).
  - Use 4–12 vertices per polygon tight to the patch boundary.

${hasBoundary ? `FIELD BOUNDARY (CRITICAL):
The farmer has explicitly outlined their field as ${rings.length} part${rings.length === 1 ? "" : "s"}. ONLY analyze pixels inside the union of these WGS84 polygons.
Ignore EVERYTHING outside (roads, neighbouring fields, buildings, treelines, bare access tracks, woodland, hedgerows).
Every output polygon vertex MUST lie strictly inside one of these parts. Reject any candidate zone whose center is outside.
Boundary (WKT): ${boundaryWKT}
${rings.map((r, ri) => `Part ${ri + 1} vertices (lat, lng):\n${r.map((p, i) => `  ${i + 1}. ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`).join("\n")}`).join("\n")}` : `NO field boundary was provided — analyze the entire image conservatively.`}`;

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
            { type: "text", text: `Analyze this high-resolution orthomosaic. The image covers WGS84 bounds north=${north}, south=${south}, east=${east}, west=${west}. Return every polygon as [lat, lng] pairs strictly inside that box — never pixel or 0–1 values. Mark each distinct bare patch, nutrient deficiency, waterlogging, weed cluster, row gap, and stress zone with its own tight polygon.` },
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

    // 3) Parse polygon vertices. The model is instructed to return [lat, lng] in WGS84
    // already inside the orthomosaic bounds. We accept that, but also defensively detect
    // legacy normalized (0–1) output and convert it as a fallback so a single bad response
    // doesn't anchor zones in the ocean.
    const inBounds = (lat: number, lng: number) =>
      lat >= south - 1e-6 && lat <= north + 1e-6 &&
      lng >= west  - 1e-6 && lng <= east  + 1e-6;

    // Point-in-polygon (ray casting) for clipping zones to the boundary union.
    const pointInRing = (lat: number, lng: number, ring: { lat: number; lng: number }[]) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i].lng, yi = ring[i].lat;
        const xj = ring[j].lng, yj = ring[j].lat;
        const intersect = ((yi > lat) !== (yj > lat)) &&
          (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };
    const insideBoundary = (lat: number, lng: number) =>
      !hasBoundary || rings.some(r => pointInRing(lat, lng, r));

    const parseVertex = (p: any): { lat: number; lng: number } | null => {
      if (!Array.isArray(p) || p.length !== 2) return null;
      const [a, b] = p.map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      // Preferred: [lat, lng] in WGS84
      if (inBounds(a, b)) return { lat: a, lng: b };
      // Tolerate swapped [lng, lat]
      if (inBounds(b, a)) return { lat: b, lng: a };
      // Fallback: normalized 0–1 image coords [x, y]
      if (a >= 0 && a <= 1 && b >= 0 && b <= 1) {
        return {
          lng: west + a * (east - west),
          lat: north - b * (north - south),
        };
      }
      return null;
    };

    const ALLOWED_ISSUES = new Set(["Bare soil", "Visible discoloration", "Waterlogging", "Row gap", "Boundary issue"]);
    const ringCentroid = (r: { lat: number; lng: number }[]) => {
      const n = r.length || 1;
      return {
        lat: r.reduce((s, p) => s + p.lat, 0) / n,
        lng: r.reduce((s, p) => s + p.lng, 0) / n,
      };
    };
    const zones = Array.isArray(parsed.zones) ? parsed.zones.map((z: any, i: number) => {
      const confidence = String(z.confidence ?? "").toUpperCase();
      return {
        id: `ai-${i}`,
        name: z.name ?? `Zone ${i + 1}`,
        issue: ALLOWED_ISSUES.has(z.issue) ? z.issue : "",
        what_you_see: z.what_you_see ?? "",
        confidence,
        severity: z.severity ?? "medium",
        coverage_pct: Number(z.coverage_pct ?? 0),
        area_acres: Number(z.area_acres ?? 0),
        recommendation: confidence === "HIGH" ? (z.recommendation ?? null) : null,
        ring: Array.isArray(z.polygon)
          ? z.polygon.map(parseVertex).filter((v: any): v is { lat: number; lng: number } => !!v)
          : [],
      };
    }).filter((z: any) => {
      if (z.ring.length < 3 || !z.issue) return false;
      if (z.confidence !== "HIGH" && z.confidence !== "MEDIUM") return false;
      // Hard server-side clip: reject any zone whose centroid is outside the
      // user's defined boundary. The AI is told to stay inside but we enforce.
      const c = ringCentroid(z.ring);
      return insideBoundary(c.lat, c.lng);
    }) : [];

    return json({
      health_score: Number(parsed.health_score ?? 0),
      summary: parsed.summary ?? "",
      multispectral_recommendations: Array.isArray(parsed.multispectral_recommendations) ? parsed.multispectral_recommendations : [],
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      zones,
      bounds: { west, south, east, north },
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});