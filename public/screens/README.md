# Landing page screenshots

Real captures of the SwathWise app, used by `src/components/landing/`. These are
product proof, so the rule is: never replace one with stock imagery, a mock-up,
or a render. If a screenshot no longer matches the UI, take a new one — don't
dress up an old one.

| File | Shows | Used by |
|---|---|---|
| `flight-planner.png` | Flight planner over a stitched orthomosaic (wide) | Why section, full-width |
| `treatment-zone.png` | AI treatment zone popup with area and cost | "Real-time intelligence" |
| `mission-summary.png` | Mission summary panel (tall; cropped to top) | "Flight plans that fly themselves" |
| `ortho-route.png` | Orthomosaic with planned route (portrait) | "Flight plans that fly themselves" |
| `weather.png` | Weather dashboard with spray windows | "Weather that speaks spray windows" |
| `field-settings.png` | Field settings / per-acre input costs | "Costs on every acre" |

A missing file does not break the page: `Screenshot` in
`src/components/landing/Shot.tsx` catches the load error and renders the alt
text in the frame instead of a broken-image glyph.

## Missing: `flight-planner.png` and `ortho-route.png`

These two live in the Claude Design project *Swathwise farmer design concept*
as `uploads/screenshots-1786986728923-9xnk.png` and
`uploads/screenshots-1786986728870-yswk.png`. The design MCP caps file reads at
256 KiB and both are larger, so they have to be downloaded from
<https://claude.ai/design/p/38770692-6de5-43c1-bc0d-752a3a550a1a> by hand and
dropped in here under the names in the table above.
