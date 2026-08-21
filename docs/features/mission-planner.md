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

## Flight-ready shapes (`src/lib/flightBlocks.ts`)

Raw cell selection produces staircase edges, one-cell notches and lone spurs. A drone cannot
trace a staircase. Before routing, the planner can regularize the marked cells into clean
lattice-aligned rectangles: a morphological **close** fills small notches, a morphological
**open** pulls thin spurs off the main body (the spur survives as its own small block — coverage
is never reduced), and the cleaned region is decomposed into a few aligned rectangles rather than
one wasteful bounding box.

This is the ONE step that changes **what** gets sprayed, so it is bound by four rules:

- **Never reduces coverage.** Every marked cell ends up inside a block.
- **Never fills an explicit skip.** Only `{untreated, source: "default"}` cells are eligible;
  a cell the operator set to skip stays a hole the route flies boom-off over.
- **Never silent.** Added area and added chemical are reported with the same `area × rate`
  arithmetic the Prescription panel uses, and shown in both the planner and the Treatment Grid
  panel before the job is committed. The map draws the painted cells over the blocks, so the
  extra ground is visible rather than described.
- **Reversible.** `flight_plan.overspray_tolerance` is the dial, it defaults to **0 (off)**, and
  zero reproduces the exact cell selection. It is a plan-layer view; the cells are never
  rewritten.

## Zone grouping (`src/lib/zoneGroups.ts`)

Zones used to be planned one at a time: cover a strip, fly away, come back for its neighbour two
metres over. Zones of the **same rate** within `flight_plan.zone_grouping_swaths × swath` of each
other (default 1.5 — a tunable starting value) are now clustered into one **group** and planned as
one unit. Same-rate is part of the definition: a boom lays one rate, so two zones at different
rates can never share a pass however close they sit. Setting the dial to zero turns grouping off
and gives every zone its own pattern — the pre-grouping behaviour, kept as the comparison
baseline.

Grouping changes **how the route traverses** the treatment area, never what is treated. Sweep
lines are still clipped to the member rings one at a time, so unmarked ground between members is
flown boom-off, not sprayed.

## Sweep generation

Each group gets its own rotated frame and one continuous serpentine across the whole cluster.
Sweep lines are intersected with every member ring and clipped to `boundary ∩ member`. Only the
segments where the drone actually sprays exist: no full-width rows across healthy crop, no
diagonal jumps. Overlapping intervals from two members merge, so no ground is dosed twice.

**Heading is chosen by cost, not by geometry alone.** A one-zone group keeps the shipped
`zoneSweepHeadingRad` answer exactly. A multi-zone group tries each member's own preference, the
group's principal axis, the field heading and square to it, and keeps whichever the aircraft can
fly in the least distance — spray plus boom-off hops plus a fixed charge per interruption. The
group's *own* principal axis is a candidate and not an answer on purpose: a cluster of six 60 m
strips stacked 150 m deep is "longest" north-south, and a north-south pass over it is mostly gap.

Lane spacing is exact (one boom less its overlap) and the lane set is centred on the group, so
grouping removes the per-zone rounding-up that used to re-cover ground a neighbour already had.

A sweep line crossing unmarked ground wider than `MAX_SWEEP_HOP_SWATHS × spacing` is cut there,
and the two sides become separate fragments for the travel-order optimiser to route around
instead of shuttling across the same empty ground once per lane.

Adjacent rows alternate direction for tight U-turns. A `repeats` value of 2 interleaves extra
rows **between** the base rows — genuinely halving spacing — rather than redrawing the same lines
twice.

## Mission assembly

Fragments are ordered nearest-neighbour from home, then improved by **2-opt** until no reversal
shortens the tour. For a given order, each fragment's entry/exit is chosen by dynamic programming
over its four orientations (forward/reverse pass order × per-pass flip) — exact for that order,
rather than a greedy choice that can leave the aircraft at the wrong end of a long group. The
closing leg back to home is part of the objective, so the route does not finish at the far fence.

Refill and battery-swap points take part in the ordering. Chemical demand is `area × rate`, so
the fractions of sprayed distance at which each load runs dry are known **before** the route is;
the planner passes them in, and the optimiser charges the round trip to the nearest pad at each
one. That steers the order only — the legs themselves are not emitted, because when the tank
actually empties is a fact about the plan the operator confirms.

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
