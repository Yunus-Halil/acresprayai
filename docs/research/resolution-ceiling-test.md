# Resolution ceiling test: how small a weed Swardus can pick up

The question: how much detail each stage keeps once nothing in the software holds the flight back. Since 2026-10-25 nothing does:

- ODM is asked for 0.1 cm, which it caps at the photographs' own pixel.
- Tiles are baked to the orthophoto's own pixel, up to zoom 26 (0.19 cm at 38° N).
- The weed hotspots read the finest pixel the map has, within 250 million pixels.

What's left is the flight. This test measures it.

## Flights

Fly **one patch** of about 30 × 30 m. Pick a weedy, early-stage row crop with weeds of mixed sizes, including some at
cotyledon to 2-leaf. Fly it **three times on the same day**, each as its own scan, from the flight planner:

| Flight | Height | GSD, 1/2.3" 12 MP (FC300X) | GSD, 1" 20 MP | Photographs (75/75 overlap) |
|---|---|---|---|---|
| A | 10 m | ~0.43 cm | ~0.27 cm | ~150–250 |
| B | 20 m | ~0.86 cm | ~0.55 cm | ~50–80 |
| C | 40 m | ~1.7 cm | ~1.1 cm | ~20–30 |

The flight planner shows the GSD for your drone and height before you fly.

- **Shutter:** keep motion under one pixel. Speed × exposure must be less than the GSD; at 10 m with a 1/2.3" camera
  that is 2 m/s at 1/500 s or faster.
- **Light:** same light for all three, so fly within an hour.
- **Ground truth:** put a coloured marker or a tape measure in the patch, so the same spot is easy to find in all three.

## In the app, for each scan

1. Wait for the map, then open the scan panel. If **Bake finer map tiles** shows, click it and wait for the bake. The
   message names the map's own pixel.
2. Set the crop and planting date. Read and confirm the crop rows.
3. **Find weed hotspots.** The summary says which pixel it read at.
4. **Grade the field.**
5. Zoom right in on the marker and on the smallest weeds you can find by eye in the original photographs. Note which
   ones each flight shows as a hotspot.

## Measurements

```
npm run audit:resolution -- --scan <odm_tasks.id>
```

This needs `SUPABASE_SERVICE_ROLE_KEY` set, as for `bench:frames`, and only reads. It prints the orthophoto's real pixel
and format, then the edge width of the same ground in the orthophoto and in the two deepest tile zooms. Comparing A, B
and C shows what each stage keeps.

## What it answers

- **The orthophoto's real pixel at each height.** Does ODM keep up with the photographs?
- **The smallest weed a hotspot catches at each height:** your eye on the map, against the photographs.
- **The cost:** bake time, tile count and hotspot read time at each height. These decide which height is worth flying
  for which job: very fine for scouting small weeds on a few hectares, coarser for whole-field pressure.
