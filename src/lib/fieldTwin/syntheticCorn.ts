// A synthetic corn Field Twin of any number of plants, for benchmarks only: the same bundle format as a real corn
// twin (plants on rows 0.76 m apart, a share of them off the rows, a row stretch per row, overlapping photo footprints,
// a soil and corn colour per photograph that drift across the field, a few weeds). Nothing here is a measurement; it
// exists so the viewer's three corn views can be timed at 30,000 to 1,000,000 plants. Never used for a real field.
import { seeded } from "./synthetic";
import { FIELD_TWIN_FORMAT, type LatLngPair, type TwinBundle, type TwinCorn, type TwinCornRow, type TwinCornWeed } from "./types";

export function syntheticCornTwin(opts: { plants: number; seed?: number; offRowShare?: number }): TwinBundle {
  const n = Math.max(100, Math.floor(opts.plants)), rnd = seeded(opts.seed ?? 11), offShare = opts.offRowShare ?? 0.08;
  const LAT = 38.9, LNG = -76.9, mLat = 111_320, mLng = 111_320 * Math.cos((LAT * Math.PI) / 180);
  const at = (e: number, no: number): LatLngPair => [+(LAT + no / mLat).toFixed(8), +(LNG + e / mLng).toFixed(8)];
  const rowSpacing = 0.76, seed = 0.16;
  // A square field holding the plants at that spacing.
  const onRow = Math.round(n * (1 - offShare)), side = Math.sqrt(onRow * rowSpacing * seed);
  const nRows = Math.max(2, Math.round(side / rowSpacing)), perRow = Math.max(2, Math.round(onRow / nRows)), length = perRow * seed, width = nRows * rowSpacing;
  const points: LatLngPair[] = [], certainty: number[] = [], photos: number[] = [], rows: TwinCornRow[] = [], fieldRows: NonNullable<TwinCorn["fieldRows"]> = [];
  for (let r = 0; r < nRows; r++) {
    const across = (r + 0.5) * rowSpacing;
    let certain = 0;
    for (let i = 0; i < perRow; i++) {
      points.push(at((i + 0.5) * seed + (rnd() - 0.5) * 0.04, across + (rnd() - 0.5) * 0.03));
      const c = rnd() < 0.7 ? 0 : rnd() < 0.8 ? 1 : 4;
      if (c === 0) certain++;
      certainty.push(c); photos.push(2 + Math.floor(rnd() * 6));
    }
    rows.push({ id: r + 1, status: "corn", line: [at(0, across), at(length, across)], lengthM: +length.toFixed(2), seenBy: 0, cornBy: 0, coveredBy: 0, why: `Plants seen along it (row ${r + 1}: ${perRow} plants, ${certain} seen by most photographs over them, ${(1 / seed).toFixed(1)} a metre).`, row: r + 1, plants: perRow });
    fieldRows.push({ id: r + 1, plants: perRow, certain, perM: +(1 / seed).toFixed(2), kind: "certain" });
  }
  // Off the rows: a headland strip beyond the last row, and a scatter between the rows.
  const off = n - points.length;
  for (let k = 0; k < off; k++) {
    const head = rnd() < 0.6;
    points.push(head ? at(rnd() * length, width + 0.5 + rnd() * 6) : at(rnd() * length, (Math.floor(rnd() * (nRows - 1)) + 1) * rowSpacing + (rnd() - 0.5) * 0.1));
    certainty.push(head ? 2 : 3); photos.push(2);
  }
  // Photographs on a grid, each seeing 40 x 30 m, 15 m apart; their colours drift across the field.
  const footprints: TwinBundle["footprints"] = [], samples: NonNullable<TwinCorn["look"]>["samples"] = [];
  const fw = 40, fh = 30, step = 15;
  for (let y = 0; y <= width + 8; y += step) for (let x = 0; x <= length; x += step) {
    footprints.push({ photo: `S${footprints.length}.JPG`, ring: [at(x - fw / 2, y - fh / 2), at(x + fw / 2, y - fh / 2), at(x + fw / 2, y + fh / 2), at(x - fw / 2, y + fh / 2)] });
    const t = x / Math.max(1, length), u = y / Math.max(1, width), j = () => Math.round((rnd() - 0.5) * 10);
    const [lat, lng] = at(x, y);
    samples.push({ lat, lng, soil: [Math.round(128 + 30 * t - 14 * u) + j(), Math.round(104 + 22 * t - 12 * u) + j(), Math.round(80 + 14 * t - 10 * u) + j()], corn: [Math.round(74 + 26 * t) + j(), Math.round(128 + 34 * t) + j(), Math.round(52 + 16 * t) + j()] });
  }
  const weeds: TwinCornWeed[] = Array.from({ length: Math.max(3, Math.round(n / 4000)) }, (_, i) => {
    const [lat, lng] = at(rnd() * length, (Math.floor(rnd() * (nRows - 1)) + 1) * rowSpacing);
    return { id: i + 1, status: "confirmed" as const, lat, lng, areaM2: +(0.01 + rnd() * 0.05).toFixed(4), votes: { weed: 3, crop: 0, unknown: 0 }, seenBy: 3, coveredBy: 4, photos: ["S0.JPG", "S1.JPG", "S2.JPG"], why: "synthetic", evidence: [] };
  });
  const count = (c: number) => certainty.reduce((t, v) => t + (v === c ? 1 : 0), 0);
  const corn: TwinCorn = {
    version: 1, engine: "synthetic benchmark field", enteredCrop: "corn", rowSpacingM: rowSpacing, rowDirectionDeg: 0, rowAgreementM: 0.02,
    photographs: { read: footprints.length, withRows: footprints.length, failed: [] },
    rows, weeds, gaps: [], fieldRows,
    plants: { points, certainty, photos, note: "Synthetic plants: not a field.", summary: { plants: points.length, certain: count(0), probable: count(1), onNoRow: count(2), betweenRows: count(3), confirmedM: +(nRows * length).toFixed(1), notConfirmedM: 0, alongRowsTwo: count(4), alongRowsOne: 0 } },
    look: { version: 1, samples, soil: [136, 110, 82], corn: [86, 144, 60], plantSizeM: 0.1, note: "synthetic" },
    summary: { cornRows: nRows, unconfirmedRows: 0, cornRowLengthM: +(nRows * length).toFixed(1), offLatticeDropped: 0, weeds: { confirmed: weeds.length, unconfirmed: 0, contested: 0 }, gaps: { confirmed: 0, withheld: 0, confirmedLengthM: 0 }, perPhoto: { weedCandidates: 0, standGaps: 0, rows: 0 } },
    notes: ["Synthetic corn field for the viewer's benchmark.", "Review-only."],
  };
  return {
    format: FIELD_TWIN_FORMAT, id: `synthetic-corn-${n}`, name: `Synthetic corn, ${n.toLocaleString("en-US")} plants`, builtAt: "synthetic",
    source: { photographs: footprints.length, camera: "none (synthetic)", capturedAt: null, groundPixelCm: 0.6, method: "synthetic benchmark field", weedModel: "none", treeModel: "none" },
    origin: { lat: LAT, lng: LNG }, bounds: [at(-10, -10), at(length + 10, width + 16)], field: { rowDirectionDeg: 0, rowSpacingM: rowSpacing, plantSpacingM: seed },
    footprints, rows: [], trees: [], inferredTrees: [], weeds: [], vegetation: [], atlases: [], stats: { synthetic: true, weedTier: "none" }, corn,
  };
}
