# Overview

## What the product does

SwathWise is a web application for farmers and agricultural drone operators. The job it does:

1. A farmer flies a drone over their field and gets a folder of overlapping photographs.
2. SwathWise turns those into a single georeferenced aerial image â€” an **orthomosaic**.
3. The farmer draws the exact outline of their land on that image.
4. The operator marks stressed and healthy reference points on the treatment grid, and SwathWise extrapolates matching zones across the rest of the field.
5. SwathWise generates a flyable spray mission that treats **only those patches**.

The end products a user walks away with:

- A zoomable map of their field
- A set of outlined treatment zones with real acreage and cost estimates
- A waypoint file they can load into a spray drone's flight controller
- A one-page PDF mission report

## The unit of work is a scan

Everything hangs off a **field**, and inside a field off a **scan**. A scan is one flight's
worth of images and everything derived from them. Fields accumulate scans over time, which is
what makes before/after comparison possible.

```
Field  "North Vineyard"
 â”œâ”€â”€ boundary        (drawn once, shared by all scans, editable)
 â”œâ”€â”€ settings        (crop, dates, input prices, drone choice, units)
 â””â”€â”€ Scan 2026-04-02 â”€â”€â”¬â”€â”€ orthomosaic (GeoTIFF + pre-baked map tiles)
     Scan 2026-05-18   â”œâ”€â”€ grid assessment (treatment-zone snapshot)
     Scan 2026-06-30   â”œâ”€â”€ manual annotations (farmer-drawn polygons)
                       â”œâ”€â”€ flight log (what was actually flown)
                       â””â”€â”€ PDF report
```

In code, a "scan" is a row in the `odm_tasks` table. The table name is historical; the UI calls
it a scan everywhere.

## Design stance

Three positions are baked into the product. They are deliberate and should be preserved.

### The analysis is conservative by design

SwathWise never diagnoses nutrient
deficiency, disease, or pest pressure from imagery alone, because those cannot be seen in visible light. Zones exist
only where the operator marked ground or accepted a suggested match against their own examples.

A farmer acting on a wrong nitrogen call loses a season they may not be able to absorb. The
refusal to over-claim is what makes the tool safe to depend on.


### Output formats are open

Missions export as QGC WPL 110 with real MAVLink commands, and zones as GeoJSON. That runs on
ArduPilot, Mission Planner and non-DJI sprayers â€” not only expensive first-party hardware. A
farmer's data and flight plans leave the system in formats other tools can read.

### It works on cheap hardware

The product degrades honestly rather than gating. With a multispectral camera you get true NDVI;
with an ordinary RGB drone you get VARI, clearly labelled as the visible-light proxy it is, and
the AI's permissions narrow accordingly. A farmer with a low-cost camera drone still gets
something real.

## What "done" looks like for a scan

A scan is fully processed when its `odm_tasks` row reaches `status = 'completed'` with:

- `output_path` set â€” the full ODM archive is mirrored to storage
- `ortho_path` set â€” the orthophoto GeoTIFF is extractable and renderable
- `tiles_baked = true` â€” every map tile has actually been stored

Only then does the workspace render without further work. Each of those three can fail
independently, and each has its own recovery path â€” see [pipeline/resilience.md](pipeline/resilience.md).
