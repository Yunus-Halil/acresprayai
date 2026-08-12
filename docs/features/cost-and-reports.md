# Cost model and reporting

## Per-field settings

Stored as JSON in `fields.settings`, typed as `FarmerSettings` in `src/lib/farmerSettings.ts`.
Because it lives on the field, it applies to every scan of that field.

```ts
{
  crop_type: string,              // "wheat" | "corn" | ...
  planting_date: string,          // YYYY-MM-DD or ""
  harvest_date: string,
  area_acres_override: number | null,
  unit_system: "metric" | "imperial",   // litres vs US gallons
  input_costs: { nitrogen_fertilizer, phosphorus_fertilizer, potassium_fertilizer,
                 herbicide, fungicide, insecticide, reseeding },   // $ per acre
  available_inputs: { ...same keys... },                            // booleans
  custom_inputs: [{ name, cost }],                                  // max 3
  flight_plan: { drone_id, tank_load_pct, custom_specs },
  last_flown_mission: { ... } | null
}
```

`mergeFarmerSettings()` fills in every nested key from the defaults, so rows saved before a field
was added still load. Never spread a persisted blob directly.

## How a zone becomes a number

Each zone's free-text issue and recommended action are matched by keyword onto a canonical issue
key, and each key maps to one of the farmer's priced inputs.

| Issue key | Input charged | Default $/ac |
|---|---|---|
| `bare_soil` | Reseeding / seed | 35 |
| `nitrogen_deficiency` | Nitrogen fertilizer | 45 |
| `phosphorus_deficiency` | Phosphorus fertilizer | 35 |
| `potassium_deficiency` | Potassium fertilizer | 30 |
| `weed_pressure` | Herbicide | 25 |
| `disease` | Fungicide | 30 |
| `pest_damage` | Insecticide | 20 |
| `waterlogging` | **None** — no chemical fix exists | — |

`issueToCostKey()` returns `null` rather than guessing when nothing matches, so an unclassifiable
zone shows no cost instead of a fabricated one.

Cost is the farmer's own per-acre price × the **true geodesic acreage of the polygon as currently
drawn on the map** — not the model's estimate. Move a vertex and the cost updates.

## Growth stage

`growthStage(crop, plantingDate)` derives a coarse stage hint for the AI prompt: cereal stages
(tillering / stem extension / heading / grain fill) and corn V-numbers, falling back to a neutral
week count for other crops. The clock is injectable so it is testable.

## The mission report

Generated client-side with jsPDF plus an `html2canvas` screenshot of the map. The workspace
briefly switches to Field view to capture the image, then restores.

Contents: field, crop, drone, pilot name, mission date, zone table with per-zone acreage and
product, chemical volume, battery start/end, tank refills, zones flown versus planned, and pilot
notes.

### Two modes

| Mode | Trigger | Headline |
|---|---|---|
| Pre-flight | No flight log yet | Targeted acres |
| Post-flight | A `flight_logs` row exists | Savings versus whole-field treatment |

### Persistence

The PDF downloads immediately **and** is uploaded to the `field-reports` bucket with an index row
in `field_reports`, so the archive survives. Previously generated reports are listed and reopen
through a short-lived signed URL.

Volumes render in litres or US gallons per the field's `unit_system`.

### Auto-generation

When a freshly logged mission lands on the Reports tab and the pilot name and mission date are
already filled, a report generates once automatically. A module-level `Set` keyed on
`flight_log_id` prevents re-triggering during the Field-view screenshot flip.

## Currency

`FarmerSettings.currency` is an ISO 4217 code, defaulting to `USD`. All money is formatted through
`Intl.NumberFormat` (`formatMoney` / `currencySymbol` in `src/lib/farmerSettings.ts`), which
handles symbol placement — several supported currencies put the symbol after the number, and some
have no minor unit.

The code is also sent to `analyze-ortho` and interpolated into the prompt, so the model states
costs in the farmer's own currency. It is validated against `/^[A-Z]{3}$/` server-side, because
that string reaches the prompt.

**Switching currency relabels; it never converts.** The farmer types their own local per-acre
prices, so a stored `45` means 45 of whatever they selected. Converting on switch would silently
rewrite their pricing.

Reports render savings as a percentage and a volume, not a monetary figure, so the PDF is
currency-independent.
