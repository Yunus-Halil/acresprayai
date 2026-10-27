# Website pictures (2026-10-27 redesign)

Everything here is the product's own output over a real flight. Nothing is a mock-up, a render made for the
page, or stock (rule 10 in `src/components/landing/copy.ts`).

| Folder | What it is | Made by | Used by |
|---|---|---|---|
| `twin/desktop/f-00..39.webp`, `sel.webp` | 40 frames of one continuous zoom of the apricot Field Twin, from the whole field to weed 1678, then the same view with the weed selected. 1600 x 1000. | `scripts/site/captureTwin.mjs`, then `encodeFrames.py` | "Beyond the map", scrubbed by scroll (`BeyondTheMap.tsx`) |
| `twin/mobile/...` | The same zoom at 720 x 1120 for tall screens | same | same, when the screen is taller than it is wide |
| `plant/plant-wide.webp`, `plant-tall.webp` | Weed 1678 selected, closer in | `captureTwin.mjs` | "Down to the individual plant" |
| `plant/photo-1..4.jpg` | 320 px crops of four of the 12 original photographs that saw weed 1678, native resolution, untouched | `scripts/site/plantPhotos.py` | both sections; outlines from `specimen.ts` are drawn over them as SVG |

## Location privacy

The Field Twin captures switch the surroundings layer off and hide every panel, the coordinates, the scale bar
and the mini-map. What is left is the field's own geometry. Keep it that way when recapturing: the twin's
surroundings would name the roads beside the field.

## Recapturing

```
npx vite --port 8081
node scripts/site/captureTwin.mjs --out <scratch dir>
python -I scripts/site/encodeFrames.py <scratch dir>
python -I scripts/site/plantPhotos.py        # prints the outlines for src/components/landing/specimen.ts
node scripts/site/siteShots.mjs              # four screen sizes into data/site-shots (add --reduced)
```

The twin bundle (`data/direct-georef/twin/apricot-2021-04-27`), the reconciliation output
(`data/direct-georef/apricot/m1`) and the photographs (`directtestimagery/`) are local only and stay out of git.

## Not precached

The service worker precaches only `js, css, html, ico, png, svg` and skips `screens/`, so none of this is
downloaded by visitors who never scroll to it. The zoom frames load when the section is about a screen away.
