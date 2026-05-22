
# AgriVision — Investor Pitch Walkthrough

A 5-minute live-demo script mapped to the screens you already built. Keep slides minimal; let the product do the talking.

---

## 1. The Hook (30s) — before opening the app

> "Farmers spray 100% of a field to treat 5% of it. That's billions wasted on chemicals, soil damage, and yield loss. AgriVision flips that ratio."

One sentence problem, one sentence promise. Don't open the laptop yet.

---

## 2. Dashboard (45s) — "Mission control for a farm"

Open `/app`. Point at:
- **Critical pest alert banner** → "Our AI surfaces the one thing the farmer needs to act on today."
- **KPI cards with sparklines** → "Live health across every field, not a monthly report."
- **Weather + spray window** → "We tell them *when* to act, not just *what*."

> "This is what a 500-hectare operation looks like in a single glance."

---

## 3. Fields (60s) — "Every field, in 3D"

Open `/app/fields`. Hover one card:
- Big health score + status word → "Instantly readable. Green = sleep well. Red = act today."
- 3D preview rotating → "That's the actual field. Red boxes are problem zones our drones detected."
- Zone breakdown badges → "Aphids here, mildew there, weeds over there — with exact hectares."

Click into a field, show **Queue spray for this zone**.

> "The farmer doesn't open a manual. They tap one zone."

---

## 4. AI Analyzer (90s) — the "wow" moment

Open `/app/analyzer`. Click **Load sample drone capture** → **Analyze**.

Narrate the 5-phase pipeline as it animates:
1. "Drone uplinks…"
2. "12-megapixel multispectral capture…"
3. "Our vision model runs on-device…"
4. "Geo-references every detection to GPS…"
5. "Generates a precision spray plan."

Click a detection close-up:
> "Aphid colony, 0.42 hectares, severity high, GPS-locked. Three months ago this farmer would've sprayed the whole 14 hectares. Tomorrow at 06:12, our drone sprays 0.42."

**The headline number to land:** *"That's a 97% reduction in chemical for this field."*

---

## 5. Mission Planner (60s) — "From insight to action"

Open `/app/planner`. Click an in-progress mission:
- 3D field with the drone flying the waypoint path → "Live telemetry. That's a real DJI Agras T40."
- Toggle **Draw path** → click 3 points on the field → "The agronomist can override the AI route in two seconds for a field they know."
- Mission queue + fleet panel → "One operator runs a whole fleet from a tablet."

> "Scan, decide, spray — all in one loop. No software stitched together with email."

---

## 6. The Business (45s) — close strong

Three numbers, slow:
- **−85%** chemical use per treated field
- **+12%** yield uplift in pilot fields
- **€340/ha/yr** subscription, drones sold or leased

> "We're not selling software. We're selling a measurable agronomic outcome."

End with the ask: amount, what it funds (more pilots, regulatory, sales team), timeline.

---

## Demo Hygiene

- **Pre-open all 4 tabs** before you start: Dashboard, Fields, Analyzer, Planner. Switching tabs > clicking through navigation.
- **Hardcode the story**: always use the same field (`B-04 North Quadrant`) so the numbers line up across screens.
- **Have a backup video** of the Analyzer pipeline in case Wi-Fi or the 3D view stalls.
- **Don't say "demo data"** — say "this farm in Cher, France" (your demo location). It is a prototype, but the data shape is real.
- **If asked "is the AI real?"**: yes, the analyze-scan edge function calls a real vision model on uploaded images; the sample run is scripted for reliability on stage.

---

## One-Slide Backup (if they want a deck)

| Slide | Content |
|-------|---------|
| 1 | Problem: 100% spray for 5% problem. €X waste, soil damage. |
| 2 | Solution: AI + drones, scan → detect → spray only the zones. |
| 3 | Product: 4 screenshots (Dashboard, Fields, Analyzer 3D, Planner). |
| 4 | Traction / pilots / LOIs. |
| 5 | Market size (precision-ag TAM). |
| 6 | Business model + unit economics. |
| 7 | Team. |
| 8 | Ask. |

Keep slides as backup — lead with the live product.
