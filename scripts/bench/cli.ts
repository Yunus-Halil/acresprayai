// Command-line parsing for the benchmark, apart from the entry point so a
// test can import it without running anything.

export type Args = Record<string, string | boolean | string[]>;

/** `--key value` pairs, bare `--flag`s, and `--point` repeated into a list. */
export function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    let value: string | boolean = true;
    if (next !== undefined && !next.startsWith("--")) { value = next; i++; }
    if (key === "point") {
      const list = Array.isArray(out.point) ? out.point : [];
      list.push(String(value));
      out.point = list;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function parsePoint(s: string): { lat: number; lng: number; spanM?: number } {
  const parts = s.split(",").map(x => Number(x.trim()));
  if (parts.length < 2 || parts.slice(0, 2).some(n => !Number.isFinite(n))) throw new Error(`--point wants lat,lng[,spanM], got "${s}"`);
  return { lat: parts[0], lng: parts[1], spanM: Number.isFinite(parts[2]) ? parts[2] : undefined };
}
