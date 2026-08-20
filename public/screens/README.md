# Landing page screenshots

Real captures of the SwathWise app, used by `src/components/landing/`. These are
product proof, so the rule is: never replace one with stock imagery, a mock-up,
or a render. If a screenshot no longer matches the UI, take a new one — don't
dress up an old one.

| File | Shows | Used by |
|---|---|---|
| `mission-route.jpg` | Spray mission over a stitched orthomosaic, start to end | Why section full-width, and "Flight plans that fly themselves" |
| `treatment-zone.png` | AI treatment zone popup with area and cost | "Real-time intelligence" |
| `mission-summary.png` | Mission summary panel (tall; cropped to top) | "Flight plans that fly themselves" |
| `weather.png` | Weather dashboard with spray windows | "Weather that speaks spray windows" |
| `field-settings.png` | Field settings / per-acre input costs | "Costs on every acre" |
| `flight-planner-tank.png` | *(never captured — the Cockpit section uses video instead, see `public/video/`)* | — |

A missing file does not break the page: `Screenshot` in
`src/components/landing/Shot.tsx` catches the load error and renders the alt
text in the frame instead of a broken-image glyph.

## `mission-route.jpg` does two jobs

It fills both the full-width shot at the top of the Why section and the right
half of the "Flight plans that fly themselves" pair, because it is the only
route capture we have. It is portrait, so in the full-width frame it sits
centred at its own aspect rather than stretched — cropping it to a wide band
would cut off START and END, which is the mission.

A wide capture of the flight planner (map plus the right-hand mission panel)
would be a better fit up top. When one exists, drop it in and point the
full-width `Shot` in `WhySection.tsx` at it; the pair below can keep this one.

## The Cockpit section moved to video

It was going to use a still (`flight-planner-tank.png`). It uses a recorded
simulation instead — `public/video/cockpit-sim.*`, with a frame from that clip
as its poster. A section whose whole claim is "watch the aircraft work" is
better served by the aircraft working. See `public/video/README.md` for the
encode commands and why playback is conditional.
