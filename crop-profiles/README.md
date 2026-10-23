# Crop Intelligence Profiles

What Swardus knows about a crop before it looks at a field, kept apart from what a field shows, and wired into the one
engine every crop shares. Corn is the reference implementation.

Two rules run through all of it:

- **The profile is a prior, never ground truth.** A spacing, stage or cover that the imagery measures reliably
  outranks the profile. A disagreement is reported, never corrected toward the profile.
- **One universal engine, crop-specific configuration.** A crop with no profile runs exactly as it always did.

## What lives where

```text
crop-profiles/
├── README.md                 this file
├── schema/                   JSON Schemas, GENERATED from src/lib/cropProfiles/schema.ts (do not edit)
├── shared/                   vocabularies every crop uses
│   ├── units.json
│   ├── growth-stage-systems.json
│   ├── planting-pattern-types.json
│   ├── morphology-vocabulary.json
│   ├── image-quality-standards.json
│   ├── uncertainty-codes.json      the codes every finding carries (UNKNOWN_RESOLUTION, CANOPY_CLOSED, ...)
│   └── weed-taxonomy/species.json  one entry per weed species, referenced by id from every crop
└── corn/
    ├── manifest.json         id, version, schema version, status (draft | experimental | validated), file list
    ├── identity.json         names, aliases (what the field's crop setting may say), crop group, regions
    ├── 01_planting/          row spacings by region with shares, in-row spacing, populations, singulation, geometry, tillage
    ├── 02_growth/            the staging system, every stage with GDD and day windows, closure, critical period
    ├── 03_morphology/        plant form, leaf dimensions, size by stage, what resolves at which pixel size
    ├── 04_visual-characteristics/  colour variants, indices, illumination, backgrounds, artefacts, failure conditions
    ├── 05_weed-ecology/      weeds by region with survey ranks and emergence windows, patterns, disambiguation rules
    ├── 06_field-conditions/  soils, residue, shadows, irrigation, cover crops, calendar
    ├── 07_imagery/           pixel size needed per analysis, flight guidance, ortho versus frames, quality checks
    ├── 08_algorithms/        THE RUN-TIME CONTRACT: every parameter the engine reads, and each capability's status
    ├── 09_uncertainty/       principles, and the policy (note, review, disable) and message for each code
    ├── 10_validation/        benchmarks (planned or run, with acceptance criteria), results/, failure-case registry
    ├── 11_references/        every source, with URL or DOI, type and geography
    ├── runtime/corn.runtime.json   GENERATED: the small form the app bundles (npm run profiles:build)
    ├── README.md
    └── CHANGELOG.md
```

The research narratives behind the corn files are in `docs/research/crops/corn/` (planting systems, growth and
morphology, visual appearance, weed ecology, imaging requirements, datasets) and `docs/research/crops/corn.md`.

### Four kinds of knowledge, never mixed

| Kind | Where | Read by the engine? |
|---|---|---|
| Reference knowledge: what research establishes | 01 to 07, with evidence on every consequential number | No: it justifies the configuration |
| Algorithm configuration: how Swardus uses it | 08_algorithms, 09_uncertainty | Yes, through the run-time file |
| Validation evidence: what testing showed | 10_validation | Its status is shown; it gates "validated" |
| Field observations: what this field shows | Never in a profile. Field settings, layouts and scans hold them | They outrank the profile |

Every consequential number carries `evidence`: source ids, a strength (`strong`, `moderate`, `weak`, `snippet`,
`estimate`, `none`), geography, stages, and any disagreement between sources. Our own arithmetic is `estimate`. A value
we looked for and did not find is `none`, or it is listed under the document's `gaps`; it is never filled in to look
complete.

## How the engine uses a profile

```text
field settings crop_type ──► cropProfileFor()  (src/lib/cropProfiles/registry.ts: aliases, Turkish i, whole words)
                               │
                               ├─► patternPriorFor()  ──► photoScout/pattern.ts analysePhoto: the planted spacings searched
                               │      (engine.ts)          beside the crop-neutral ones; an ExGR gate on the green mask;
                               │                           a pitch must be measured, never a candidate's; a fit just under
                               │                           the confidence bar stands only if its pitch is planted and its
                               │                           green is in step; brightness rows re-placed on the green.
                               │                           Used by the scan's map pattern pass, the photo pass, per-photo
                               │                           rows for model runs, the closer look and Photo Scout.
                               ├─► grade.ts cropGroupOf / schemeFor: crop group and cover classes (corn: provisional)
                               ├─► pressureStore.pressureRefusal: the crop's own reason; refused past the stage window
                               ├─► farmerSettings.growthStage: the estimated stage range from the planting date
                               ├─► weedCatalog/region.cropContextFor: the catalogue's crop context, by any alias
                               └─► checks.ts assessCapabilities ──► CropProfileCard (Weed Scout): expectations, the
                                   observations, each analysis on, for review or off, with its code and sentence
```

Each analysis asks the four questions in `src/lib/cropProfiles/checks.ts`:

1. **What should I expect?** The estimated stage (a range, from the planting date), the planted spacings, and the
   expected cover at the stage.
2. **What does the imagery show?** The caller's observations: pixel size, measured pitch, row coherence, green cover
   and the automatic split.
3. **Are they consistent?** `checkRowSpacing`, `checkRows`, `checkVegetationSplit` and `checkCoverVsStage`.
4. **What can safely be concluded?** `assessCapabilities` sets every analysis to enabled, review or disabled, and
   gives a code from `shared/uncertainty-codes.json` with the profile's own sentence for it.

The detailed profile never enters the image pipeline. `compileRuntime()` distils it into `runtime/<crop>.runtime.json`
(about 40 KB for corn), and only those files are bundled. The bundle uses `import.meta.glob`, so Vite, Vitest and
vite-node all see them; Deno edge functions do not import this code.

## Status, versions, migration

- **Profile status** (manifest): `draft` (incomplete), `experimental` (complete and wired, benchmarks not all passing),
  or `validated`. The validator refuses `validated` unless `validation.status` is `validated` and every supported or
  experimental capability has a run benchmark that met all of its acceptance criteria. Corn is `experimental`.
- **Capability status** (08_algorithms): `supported`, `experimental` or `unsupported`, with a reason, the pixel size
  and the stage window. An unsupported capability is refused in the app with that reason.
- **Profile version** (semver, with CHANGELOG.md): saved photo reads are keyed with the crop id and the version, so
  a changed profile reads photos again instead of serving stale reads.
- **Schema version**: profiles carry the schema version they were written against. A different major version is
  refused by the validator. To migrate, edit `schema.ts`, bump `PROFILE_SCHEMA_VERSION`, update every profile, and run
  `npm run profiles:build` (the JSON Schemas regenerate).

## Commands

```text
npm run profiles:build             validate every profile, write runtime files and JSON Schemas
npm run profiles:check             the same, failing if a generated file is stale (for CI)
npm run bench:crop-profile -- --suite synthetic|photos|weedsgalore|stage|all [--set development] [--pictures]
npm run profiles:record            write the benchmark results into 10_validation/validation.json
npx vitest run src/test/cropProfiles.test.ts src/test/cropProfilesEngine.test.ts
```

`npm run bench:crop-profile -- --suite weedsgalore` needs the WeedsGalore dataset (CC BY 4.0, 321 MB, kept outside
git) prepared once with:

```text
python -I scripts/cropProfiles/prep_weedsgalore.py --src <extracted>/weedsgalore-dataset --out D:/swardus-research/datasets/weedsgalore/rgb
```

## Adding the next crop (soybean, step by step)

1. **Research first.** Write the narratives under `docs/research/crops/soybean/`, one file per domain (planting, growth
   and morphology, visual, weeds, imaging, datasets). Each ends with a parameter table (value or range, units,
   geography, source, evidence strength) and a gaps list. `docs/research/crops/soybean.md` is a start.
2. **Copy the shape, not the numbers.** Create `crop-profiles/soybean/` with a `manifest.json` (status `draft`) and the
   twelve documents. Use the corn files as the template for structure only: every soybean value comes from the soybean
   research or is left out and listed under `gaps`.
3. **Shared vocabularies.** Add new weed species to `shared/weed-taxonomy/species.json` (one entry, used by every
   crop). Use the existing staging system id (`soybean-fehr-caviness`). Add units, terms or codes only when no existing
   one fits.
4. **The run-time contract** (`08_algorithms/algorithms.json`):
   - `rowReader.candidatesM`: soybean's planted spacings (7.5, 15, 20 and 30 in).
   - `vegetation.exgrGate`: decide from evidence; soybean stubble differs from corn stover.
   - `pressure.scheme`: mark it `provisional` if no soybean source acts on cover.
   - Capabilities: anything the engine cannot do for soybean yet is `unsupported`, with the reason. Drilled 7.5 in rows
     resolve only at fine pixels and before closure.
   - If the geometry needs a different method (drilled soybean, like wheat, is not separate rows of plants), set
     `rowReader.strategy` and add the strategy to the engine behind the same contract. Never fork the corn code.
5. **Uncertainty.** Copy the policy list, rewrite each message for soybean, and add a policy only for a new code.
6. **Build and test.** Run `npm run profiles:build` until it reports `valid`, then run the vitest files above. The tests
   pick up every crop folder automatically: schema, references, runtime freshness and registry.
7. **Benchmarks.** Add planned benchmarks with acceptance criteria to `10_validation/validation.json` BEFORE running
   them. Add a soybean suite to `scripts/cropProfiles/bench.ts` (scenes at soybean spacings, a public soybean dataset
   split by field), run it, then run `npm run profiles:record`. Register every failure you find as a failure case with a
   regression test.
8. **Status.** Move to `experimental` when the profile is complete and wired. Move to `validated` only when the
   validator allows it.
