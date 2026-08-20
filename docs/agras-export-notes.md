# DJI Agras export — what is confirmed, what is not

Two different outputs go to DJI agricultural aircraft, and they are not
alternatives — they answer different questions.

| Output | What it is | Status here |
| --- | --- | --- |
| **Rx package** (`DJI/Shapefile/` + `DJI/Rx/`) | Field boundary plus a variable-rate prescription raster | **The shipping path.** `src/lib/djiAgras.ts` |
| **WPML route** (`.kmz` of `wpmz/`) | An ordered flight path with payload actions | **Experimental, deliberately parked.** `src/lib/wpml.ts` |

The framing that matters: **an Agras is handed a FIELD and plans its own flight
lines on the aircraft.** It is not handed a route. Enterprise airframes
(M30/M300/M350/Mavic 3E) take routes via WPML; Agras does not. That is why DJI's
WPML specification contains no spray vocabulary at all — see [Open question
3](#3-whether-agras-spray-missions-need-a-route-kmz).

Our planner's flight lines are a **simulation for estimating** time, battery and
tank swaps. They are not the deliverable and must never be presented as the path
the aircraft will fly.

---

## Confirmed

Everything in this section is verbatim from DJI's own documentation repository
or corroborated by an independent vendor whose exports are known to import on
real hardware. Sources are linked at the bottom.

### WPML route files

**Namespaces.** `http://www.opengis.net/kml/2.2` and
`http://www.dji.com/wpmz/1.0.2`. Note `www.` on both, and the `/1.0.2` version
path on the WPML one. The bare `http://opengis.net` / `http://dji.com` forms
circulate in third-party blog posts and are wrong. Declared once in
`src/lib/wpml.ts` (`KML_NS`, `WPML_NS`) and asserted by test.

**Element names.** `wpml:missionConfig`, `flyToWaylineMode`, `exitOnRCLost`,
`globalTransitionalSpeed` — not `MissionConfig`, `flyToMode`, `exitOnGpsLost`,
`executeRtkSpeed`.

**Archive layout.** A `.kmz` is a zip whose root contains `wpmz/`:

```
route.kmz
└── wpmz/
    ├── template.kml      user-editable business parameters
    ├── waylines.wpml     what the aircraft actually executes
    └── res/              optional auxiliary files
```

Rules encoded in the exporter:

- **Both files are required.** Never emit an archive with only one.
- **The route's display name is the `.kmz` filename.** `new_waypoints.kmz`
  becomes the route `new_waypoints`. We therefore write **no** route-name
  element inside the archive — there is nothing that can drift out of step with
  the filename, which is the failure this rule exists to prevent.
- **`template.kml` and `waylines.wpml` are not the same data written twice.**
  The template holds the business parameters a user edits; the waylines are
  derived from it, the way DJI Pilot 2 and FlightHub 2 do it.

### Rx package

**Folder layout**, corroborated by PIX4Dfields' own documentation:

```
DJI/
├── Shapefile/   field_boundary.shp .shx .dbf .prj    ← boundary geometry ONLY
└── Rx/          spot_treatment.tiff .tfw             ← the rates
```

**The rate lives in the raster, not in the shapefile.** PIX4D: *"It will contain
a .tiff file with different rates following each operation (zone)."* Any design
that puts rate values into DBF attributes — the `ID` / `VRA_Rate` / `Type`
schema that circulates online — is not what real Agras import tooling expects.
We do not write one, and a test asserts no rate-shaped column appears.

**`.tiff`, not `.tif`.** Two independent sources agree: PIX4D's documentation
writes `.tiff`, and DJI's folder specification does too. The generic GIS
world-file rule (first + last + `w`) argues for `.tif`, and that reasoning is
sound in the abstract — but vendor importers routinely match a literal basename
rather than implementing the derivation rule, so the specific pathway wins over
the general convention. Configurable via `rxExtension`, defaulting to `.tiff`.
See [Open question 4](#4-tiff-vs-tif-defaulted-not-settled).

### Units — safety-relevant

At import on the controller, the operator selects the source unit and a
resampling mode. **The raster does not describe its own unit.** The prescription
is per-hectare and we write **L/ha** (`RX_RATE_UNIT`).

> A unit mismatch at import silently mis-doses the field. There is no warning,
> and nothing in the file can catch it.

Every export states the unit it wrote. Do not remove that from the UI, the CLI
output or the package manifest.

---

## Unconfirmed

**Never let these read as settled** — in code, in comments, or here.

### 1. Raster bit depth / data type

We write **single-band float32**. Single-band *numeric* is a strong inference:
the controller asks for a **unit** and offers **Average** resampling, both of
which are meaningful over numbers and meaningless over a legend-mapped RGB
image. But float32 versus scaled integer is a guess.

Change point: `writeGeoTiffFloat32` in `src/lib/geotiff.ts`, used by
`src/lib/djiAgras.ts`.

### 2. DBF attribute schema

No published DJI source lists the expected field list. Ours is deliberately
minimal (`ID`, `TYPE`, `AREA_HA`) and carries no rate. The reader is
schema-agnostic by construction — it returns whatever columns the header
declares — so a package carrying somebody else's schema reads back cleanly.
Field names come back **uppercased**, per the dBase convention; anything
matching by name must fold case.

### 3. Whether Agras spray missions need a route `.kmz`

Both of DJI's published WPML examples are camera/survey missions — gimbal
rotation and `takePhoto` on an M30-class airframe. Neither page documents a
single agriculture actuator: no pump rate, no spray on/off, no spreader.

**Do not invent `wpml:` spray tags.** A made-up `wpml:sprayRate` produces a file
that looks right and does nothing. That vocabulary must come from a real
Agras-generated `.kmz` or an agriculture-specific section of DJI's docs, neither
of which we have. A test asserts no spray-shaped tag appears in our output.

This is consistent with the Rx package: on Agras the rate travels in the raster.

### 4. `.tiff` vs `.tif` — defaulted, not settled

Defaulted to `.tiff` on two agreeing sources, but no captured package has been
diffed. `rxExtension` flips it in one argument. Do not treat as closed.

### 5. Consumer `.kmz` import

WPML is documented as a DJI Pilot 2 / **enterprise** pathway. Whether
Mini/Air/non-enterprise Mavic ingest `.kmz` at all is unconfirmed, and the
`droneInfo`/`payloadInfo` enums for those airframes are unknown — we emit them
only when supplied, because a wrong enum is worse than an absent one. DJI Fly
ships no import function, and sideload workarounds die on Android 11+ scoped
storage. This is why the WPML exporter is `status: "experimental"` and never
reaches the export menu.

---

## Open follow-up: capture a real package

**Everything in the Unconfirmed section closes with one real export.** The goal
is a byte-for-byte diff against ours on five things: **extension, band count,
raster data type, CRS declaration, DBF field list.**

Ranked by effort:

1. **PIX4Dfields trial — lowest effort, highest value.** It exports exactly the
   `DJI/Shapefile` + `DJI/Rx` package described above. One export from any field
   settles 1, 2 and 4 at once, from a vendor whose output is known to import.
2. **DJI SmartFarm Web.** Build a prescription there and inspect what it emits.
3. **A dealer or operator who has flown a variable-rate job.** Ask for the
   package they actually flew.

Further searching will not close these. Every documentary source has been
exhausted; what is missing is a binary.

---

## Sources

- [DJI Cloud API — WPML overview](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/00.dji-wpml/10.overview.md)
- [DJI Cloud API — `template.kml` reference](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/00.dji-wpml/20.template-kml.md)
- [DJI Cloud API — `waylines.wpml` reference](https://github.com/dji-sdk/Cloud-API-Doc/blob/master/docs/en/60.api-reference/00.dji-wpml/30.waylines-wpml.md)
- [PIX4Dfields — spot spraying / variable rate for DJI Agras T-series](https://support.pix4d.com/hc/en-us/articles/360019956578)
- [DJI SmartFarm Web user guide](https://support.dji.com/help/content?customId=01700009100&spaceId=17&re=US&lang=en&documentType=&paperDocType=ARTICLE)
