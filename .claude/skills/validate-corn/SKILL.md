---
name: validate-corn
description: Independent, evidence-based validation of one Swardus corn stage reader (emergence, establishment, mid, late) on the photographs in directtestimagery - runs the reader on every photo, samples observations, cuts crops from the unannotated originals, has Claude judge every crop by eye, scores five completion gates and writes a report. Use when the user types /validate-corn <stage> or asks to validate a corn stage reader. Never changes the readers, never commits.
---

# /validate-corn <stage>

Validate the current corn reader for one stage. Read-only on the readers and on every baseline; write only under
`directtestimagery/validation-<today>/`. Do not commit, push or re-baseline without the user's approval.

## Steps

1. **Meanings.** Read `src/lib/rowCrop/readRowCrop.ts` (and `emergence.ts`, `fineSeedlings.ts`, `seedlingGreen.ts`) and
   the overlay code in `src/pages/app/PhotoScout.tsx`; state what every mark means from the code, not from memory.
2. **Run.** `npx vite-node scripts/rowCrop/validateCorn.ts -- --stage <stage> --out directtestimagery/validation-<today>`
   (per-photo CSV, geometry, a seeded stratified sample with the reader's own state stored apart).
3. **Crops.** `python -I scripts/rowCrop/validate_crops.py <out>/<stage> directtestimagery/<stage folder>` (folders:
   emergence veryearlystage, establishment estabilishmentphase, mid midphase, late verylatestagecorn).
4. **Judge every sheet by eye.** Open each `<out>/<stage>/sheets/*.jpg` with the Read tool and record one code per
   numbered cell in `<out>/<stage>/verdicts.json` (codes in its `_codes`; the first validation's files show the format).
   Judge the original pixels, not the overlay; mark `?` when it cannot be told. Open single crops in `crops/` or a wider
   cut of the original when a cell is too small. Never copy the reader's own answer as the verdict.
5. **Score.** `python -I scripts/rowCrop/validate_report.py <out>/<stage>` (visual-audit.csv, audit-summary.json,
   gallery.jpg). Look at the gallery.
6. **Regression.** Compare `per-photo.csv` with the stage's last recorded bench run (`directtestimagery/<folder>/outputs/`).
7. **Gates.** Score geometry, crop and gap interpretation, critical failures, performance and regression stability
   against the provisional thresholds in `directtestimagery/validation-2026-11-02/VALIDATION-REPORT.md` section 6 (or
   project criteria if they exist by then). PASS only on evidence; INSUFFICIENT EVIDENCE where the sample cannot say.
8. **Report.** Write `<out>/VALIDATION-REPORT.md`: what each mark means, the benchmark, the audit table, geometry,
   failure patterns ranked, the gates, the decision (freeze or the smallest fix for the top failure), and what needs
   field data. Say plainly that visual judgements are provisional labels by Claude, not ground truth.
