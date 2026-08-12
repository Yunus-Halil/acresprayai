# AI analysis — the exact contract

One function, `analyze-ortho`. One model: `google/gemini-2.5-flash` through the Lovable AI
gateway.

A field boundary is **required** — the UI refuses to run without one, so the model never analyses
a neighbour's land.

## What the model is given

1. A **2048 px PNG preview** of the orthomosaic rendered by TiTiler.
2. The **WGS84 bounding box** (north, south, east, west), with explicit instructions that polygon
   vertices must be real lat/lng inside that box — not pixel coordinates, not normalised 0–1
   values.
3. The **band count**, which determines what it is allowed to conclude.
4. If 4+ bands: **real NDVI statistics** sampled by TiTiler over a 3×3 grid of the field bbox —
   mean, min, max per cell, each labelled with a verdict band.
5. The **field boundary** as WKT plus an explicit vertex list, with instructions to ignore roads,
   neighbouring fields, buildings, treelines and hedgerows.
6. The **farmer's context**: crop, planting and harvest dates, derived growth stage, and
   critically the list of inputs they do and do not have.

### NDVI verdict bands

| Mean NDVI | Verdict |
|---|---|
| < 0.1 | bare soil / no vegetation |
| < 0.3 | severely stressed |
| 0.3 – 0.5 | moderately stressed |
| 0.5 – 0.7 | moderate health |
| > 0.7 | healthy canopy |

## What the model is forbidden from claiming

> On RGB-only imagery the model **may not** diagnose nitrogen, phosphorus or potassium
> deficiency, disease, pest pressure, early pre-visible stress, soil nutrient levels, or weed
> species.

It may only report from this closed set:

- Bare soil
- Visible discoloration
- Waterlogging
- Row gap
- Boundary issue

It may **never** recommend an input the farmer has marked unavailable. If the only correct
treatment is unavailable it must return a null recommendation and explain what input would be
needed.

With 4+ bands the permissions widen: it may cross-reference NDVI, label findings
"NDVI confirmed", quote NDVI values, and name probable nutrient stress when NDVI < 0.4 **and**
there is visible discoloration.

## Tiering — the noise filter

| Tier | Meaning | Geometry | Fate |
|---|---|---|---|
| **1** | Act now. Distinct, treatable, ≥ 0.05 ac | 4–12 vertex polygon required | Drawn on the map, included in the flight plan |
| **2** | Monitor. Small, ambiguous or scattered | None | Text-only watch list |
| **3** | Normal variation — tractor tracks, wheel lines, cloud shadows, turning rows, minor soil texture | — | **Never emitted at all** |

Scattered small patches collapse into a single field-level Tier 2 observation rather than dozens
of markers. The actionability gate is explicit in the prompt: *"Can a farmer actually fix this
with a specific treatment?"*

## Server-side enforcement

The function does not trust the model's output. Before anything is returned:

- Issue labels are checked against the whitelist; anything else is dropped
- Confidence must be `HIGH` or `MEDIUM`; anything else is dropped
- Recommendations are stripped from anything not `HIGH` confidence
- Vertices are parsed defensively — correct `[lat,lng]` first, then swapped `[lng,lat]`, then
  normalised 0–1 image coordinates as a last resort
- Each zone's centroid is tested with ray-casting point-in-polygon against the farmer's boundary;
  outside ⇒ discarded
- Tier 1 zones without at least 3 valid vertices are dropped

This matters because a plausible-looking hallucinated polygon in the wrong place would send a
drone to spray the wrong ground.

## Response shape

```jsonc
{
  "health_score": 0,                  // 0-100
  "summary": "string",
  "multispectral_recommendations": ["string"],
  "issues": [{ "label": "", "severity": "", "description": "" }],
  "zones": [{                         // Tier 1 only
    "id": "ai-0",
    "name": "string",
    "issue": "Bare soil",             // from the whitelist
    "what_you_see": "string",
    "confidence": "HIGH",             // HIGH | MEDIUM
    "severity": "medium",             // low | medium | high
    "tier": 1,
    "coverage_pct": 0,
    "area_acres": 0,
    "recommendation": {               // null unless confidence is HIGH
      "action": "spray",              // spray | irrigate | reseed | fertilize | monitor
      "product": "string",
      "dose": "string",
      "rationale": "string"
    },
    "ring": [{ "lat": 0, "lng": 0 }]  // NOT "polygon" - see the data model doc
  }],
  "watch_list": [],                   // Tier 2, no geometry
  "bounds": { "west": 0, "south": 0, "east": 0, "north": 0 },
  "data_source": "RGB",               // "NDVI+RGB" | "RGB"
  "band_count": 3,
  "ndvi_cells": [{ "label": "NW", "mean": 0, "min": 0, "max": 0, "verdict": "" }],
  "disclaimer": "string"
}
```

> **`ring`, not `polygon`.** The model returns `polygon`; the server normalises it to `ring`
> before persisting. Anything reading zones back must use `ring`.

The result is persisted to `odm_tasks.ai_analysis` so zones survive a reload, and edits (moving a
vertex, deleting a zone) are written straight back.

## Error responses

| Status | Meaning |
|---|---|
| 429 | AI rate limit — retry shortly |
| 402 | AI credits exhausted |
| 409 | Orthomosaic not ready |
| 404 | Scan not found or not yours |

## Why the conservatism is load-bearing

This is the part of the product a farmer's season depends on. The refusal to diagnose from
insufficient data is not timidity — it is what makes the tool safe to act on. Any future change
that loosens these constraints should be weighed against the cost of a wrong recommendation to
someone who cannot absorb a lost harvest.
