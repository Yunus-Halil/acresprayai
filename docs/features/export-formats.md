# Export formats

Both formats are open and vendor-neutral. A farmer's data and flight plans leave the system in
formats other tools can read — this is deliberate.

## Treatment zones — GeoJSON

Downloads as `flight-plan-{taskId}.geojson`.

A `FeatureCollection` of polygons, one per Tier 1 zone:

```jsonc
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": {
      "name": "Zone 1",
      "issue": "Bare soil",
      "severity": "high",
      "coverage_pct": 2.4,
      "action": "reseed",
      "product": "…",
      "dose": "…"
    },
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[lng, lat], …, [lng, lat]]]   // ring closed
    }
  }]
}
```

Coordinates are GeoJSON order — `[longitude, latitude]` — while the internal representation is
`{lat, lng}`. The export closes the ring by repeating the first vertex.

## Flight mission — QGC WPL 110

Downloads as `mission-{taskId}.waypoints`. Tab-separated Mission Planner format.

Line 1 is the header `QGC WPL 110`. Index 0 is the home row, flagged current. Actions are encoded
with MAVLink-equivalent commands so Mission Planner and DJI converters preserve them rather than
flattening everything to plain waypoints.

| Cmd | MAVLink | Used for |
|---|---|---|
| 22 | `NAV_TAKEOFF` | Launch |
| 16 | `NAV_WAYPOINT` | Transit and spray waypoints |
| 178 | `DO_CHANGE_SPEED` | Speed transitions (param 2 = m/s) |
| 183 | `DO_SET_SERVO` | Sprayer on/off — servo channel 8, PWM 2000 on / 1000 off |
| 20 | `NAV_RETURN_TO_LAUNCH` | Return home |
| 21 | `NAV_LAND` | Landing |

### Row format

```
{idx}\t{current}\t{frame}\t{cmd}\t{p1}\t{p2}\t{p3}\t{p4}\t{lat}\t{lng}\t{alt}\t1
```

- `frame` is 3 (relative altitude) for every row except home, which is 0
- Coordinates are written at **8 decimal places** — roughly 1 mm
- Params are written at 2 decimal places

### Sprayer control

The sprayer is assumed to be on **servo channel 8**. `DO_SET_SERVO` with PWM 2000 opens it and
1000 closes it. If a given airframe wires its pump elsewhere, this is the constant to change —
`SPRAY_SERVO` in `src/lib/mission.ts`.

## Testing

`src/test/mission.test.ts` asserts the serialiser's output directly: header, consecutive
indexing, exactly one takeoff / RTH / land, servo rows carrying channel 8 with valid PWM, speed
rows carrying the configured speed, and the coordinate decimal precision.

If you change the format, those tests are the specification.
