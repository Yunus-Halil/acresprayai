// Shared by the boundary scripts: the twin and the sampled ground measurements (boundaryEvidence.ts writes them).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceMeasures } from "../../src/lib/fieldTwin/boundaryEvidence";
import type { TwinBundle } from "../../src/lib/fieldTwin/types";
import { OUT } from "./common";

export const BOUNDARY_DIR = join(OUT, "boundary");

export type MeasuresHeader = { twin: string; cellM: number; along0: number; across0: number; width: number; height: number; layout: [string, "Uint8" | "Float32" | "Int16", number][]; sampledMs: number; photos: string[] };

export function twinPathOf(id: string): string { return join(OUT, "..", "twin", id, "twin.json"); }

export function loadTwin(id: string): TwinBundle {
  const p = twinPathOf(id);
  if (!existsSync(p)) throw new Error(`no twin at ${p}: run buildTwin.ts first`);
  return JSON.parse(readFileSync(p, "utf8")) as TwinBundle;
}

/** The measurements as typed arrays, and the EvidenceMeasures the classifier reads. */
export function loadMeasures(dir = BOUNDARY_DIR): { header: MeasuresHeader; arrays: Record<string, Uint8Array | Float32Array | Int16Array>; measures: EvidenceMeasures } {
  const header = JSON.parse(readFileSync(join(dir, "measures.json"), "utf8")) as MeasuresHeader;
  const raw = readFileSync(join(dir, "measures.bin"));
  const N = header.width * header.height;
  const arrays: Record<string, Uint8Array | Float32Array | Int16Array> = {};
  let off = 0;
  for (const [name, typ, k] of header.layout) {
    const bytes = N * k * (typ === "Uint8" ? 1 : typ === "Int16" ? 2 : 4);
    const buf = raw.buffer.slice(raw.byteOffset + off, raw.byteOffset + off + bytes);
    arrays[name] = typ === "Uint8" ? new Uint8Array(buf) : typ === "Int16" ? new Int16Array(buf) : new Float32Array(buf);
    off += bytes;
  }
  const photoOf = arrays.photoOf as Int16Array;
  const seen = new Uint8Array(N);
  for (let c = 0; c < N; c++) seen[c] = photoOf[c] >= 0 ? 1 : 0;
  const measures: EvidenceMeasures = { cellM: header.cellM, along0: header.along0, across0: header.across0, width: header.width, height: header.height, seen, cover: arrays.cover as Float32Array, luma: arrays.luma as Float32Array, sat: arrays.sat as Float32Array };
  return { header, arrays, measures };
}

/** A copy of the measurements (so an experiment can paint on them without touching the originals). */
export function cloneMeasures(m: EvidenceMeasures): EvidenceMeasures {
  return { ...m, seen: new Uint8Array(m.seen), cover: new Float32Array(m.cover), luma: new Float32Array(m.luma), sat: new Float32Array(m.sat) };
}
