# Mission planner

The most substantial piece of engineering in the product. It converts treatment zones into a
waypoint sequence a spray drone can actually fly, and refuses to emit a pattern the selected
aircraft cannot physically perform.

Pure logic lives in `src/lib/mission.ts` and `src/lib/geo.ts` and is unit-tested. The UI lives in
the Planner tab of the workspace.

## Inputs

- The **field boundary** — a hard constraint, not a suggestion
- **AI zones plus farmer-drawn polygons**, both filtered so only zones whose centroid lies inside
  the boundary are planned
- A **home point**, defaulting to the boundary centroid and draggable on the map
- Row spacing, transit and spray altitudes, transit and spray speeds, repeat count, tank load
- Wind and temperature from the weather cache

## Sweep generation

The field's **principal axis** is computed from the covariance of its boundary vertices, and
every zone is rotated into that frame. Rows therefore run along the field's long edge, and every
zone's rows are parallel to every other zone's — rather than each patch being swept at its own
arbitrary angle.

Within each zone, parallel sweep lines are intersected with the zone ring and clipped to
`boundary ∩ zone`. Only the segments where the drone actually sprays exist: no full-width rows
across healthy crop, no diagonal jumps.

Adjacent rows alternate direction for tight U-turns. A `repeats` value of 2 interleaves extra
rows **between** the base rows — genuinely halving spacing — rather than redrawing the same lines
twice.

## Mission assembly

Zone fragments are ordered greedily by nearest endpoint to the drone's running position. For each
fragment the planner picks whichever of four orientations (forward/reverse pass order × per-pass
flip) minimises the hop in. The drone enters each patch from the side it is already nearest.

Waypoints are emitted with explicit phase transitions:

```
TAKEOFF
  → ALTITUDE_CHANGE / SPEED_CHANGE / TRANSIT   (high, fast, sprayer off)
  → ALTITUDE_CHANGE / SPEED_CHANGE / SPRAY_ON  (low, slow, sprayer on)
  → SPRAY_WP …
  → SPRAY_OFF
  → TRANSIT …
  → RTH → LAND
```

Invariants the tests enforce: every `SPRAY_ON` is balanced by a `SPRAY_OFF`, the sprayer is never
left on at the end, spray waypoints are always at spray altitude and speed, and transit waypoints
always at transit altitude and speed.

## Physics validation

Three checks run continuously against the selected drone's spec.

| Check | Condition | Meaning |
|---|---|---|
| Physical turn radius | `spacing / 2 ≥ min_turn_radius_m` | The U-turn at the row end must be one the airframe can physically make |
| Bank-limited radius | `spacing / 2 ≥ v² / (g · tan 25°)` | At transit speed with a 25° bank, the turn must still fit between rows or the drone overshoots |
| Climb runway | `(Δalt / climb_rate) · v ≤ spacing · 4` | The climb between spray and transit altitude must be achievable in the horizontal distance available |

### Auto-fix

When a check fails the planner adjusts and reports what it changed:

- Widens spacing to `2 × min_turn_radius_m`
- Caps transit speed at `√(spacing/2 · g · tan 25°)`
- Trims the altitude delta by raising spray altitude

### Recommended spacing

Row spacing auto-snaps to a recommendation until the user moves the slider, bounded by:

- The drone's **spray swath** — never wider than the aircraft actually covers
- The **coverage max** — the widest spacing that still guarantees a sweep line passes through
  every zone, so no anomaly is missed between rows
- A home-distance adjustment: wider spacing when home is far, since fewer passes means fewer long
  returns

## Battery and endurance

```
estimated_flight_min = base_flight_min
                     × wind_factor      // headwind along the pass axis costs
                     × altitude_factor  // 1 + avg_agl × 0.001
                     × payload_factor   // 1 + tank_load × 0.15
                     × temp_factor      // below 15 °C, 1% per °C

battery_percent  = estimated_flight_min / spec.max_flight_min × 100
batteries_needed = ceil(battery_percent / 80)
```

Wind is resolved against the sweep bearing. A boustrophedon spends half its time in each
direction, so head- and tailwind on alternating rows partly cancel; the cross component is
discounted by half.

When more than one battery is required, the planner drops a marker at the point along the path
where the first pack runs out — so the pilot knows where they will be standing when they need to
swap.

## Simulation

The generated mission plays back on the map on a `requestAnimationFrame` timeline with
play/pause, scrub and speed control, showing the drone's position and whether the sprayer is on
at each moment.

## Drone specifications

One shared table in `src/lib/droneSpecs.ts`, keyed by the `drones.model` string, with an alias
map so model names saved under older spellings still resolve.

| Model | Role | Tank | Swath | Flight | Turn r | Climb |
|---|---|---|---|---|---|---|
| DJI Agras T40 | Sprayer | 40 L | 9 m | 18 min | 4 m | 6 m/s |
| DJI Agras T30 | Sprayer | 30 L | 6.5 m | 18 min | 3.5 m | 6 m/s |
| DJI Agras T25 | Sprayer | 20 L | 7 m | 18 min | 3 m | 6 m/s |
| XAG P100 Pro | Sprayer | 50 L | 10 m | 18 min | 4.5 m | 5 m/s |
| XAG V40 | Sprayer | 16 L | 5 m | 18 min | 3.5 m | 5 m/s |
| DJI Mavic 3M | Survey | — | — | 43 min | 1 m | 8 m/s |
| Parrot Anafi USA | Survey | — | — | 32 min | 1 m | 4 m/s |
| Custom | Sprayer | 30 L | 6 m | 20 min | 3 m | 5 m/s |

Both the fleet endurance chart and the planner's battery estimate derive from the same
`max_flight_min`, and the Fleet screen's display strings are formatted from these same numbers —
so the two can never drift apart.

> ⚠️ **Verify before relying on these.** They are conservative real-world figures, not marketing
> maxima, and they have **not** been checked against current manufacturer datasheets. They feed
> battery, tank and maneuverability estimates a pilot depends on. Treat them as defaults to
> confirm per airframe; operators can override everything through the Custom profile.

## Available but unused

`routeInsideBoundary` in `src/lib/geo.ts` is a working breadth-first router that keeps a transit
leg inside the field, including around concave notches (C, L and U-shaped fields that wrap a wood
or a pond). It returns a `fullyInside` flag when no legal route exists.

Nothing calls it yet — `buildMission` currently connects passes with straight lines at transit
altitude. Wiring it up is the natural next step for irregular fields.
