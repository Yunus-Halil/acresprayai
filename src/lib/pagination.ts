// Cursor-free "load more" pagination for the list screens.
//
// Every list query used to be `select("*")` with no range. Fine at a handful of
// fields and scans, but the scan list grows one row per flight forever, and a
// farmer on a slow connection pays for every row in the response.
//
// Offset pagination (rather than keyset) is deliberate: these lists are ordered
// by `created_at desc` and appended to at human speed, so the classic
// offset-skips-a-row race needs a new row to be inserted between two page loads
// of the same list — rare, and harmless here (a duplicate is deduped by id).

export const PAGE_SIZE = 24;

export type Page<T> = {
  rows: T[];
  /** True when the server returned a full page, so another may exist. */
  hasMore: boolean;
};

/** Supabase range bounds for a zero-based page index. */
export function pageRange(page: number, size = PAGE_SIZE): [number, number] {
  const from = page * size;
  return [from, from + size - 1];
}

/**
 * Merge a freshly loaded page into the rows already on screen, keyed by id so a
 * row that shifted between requests appears once rather than twice.
 */
export function appendPage<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map(r => r.id));
  return [...existing, ...incoming.filter(r => !seen.has(r.id))];
}

/** A page is "full" when it came back at the requested size. */
export function hasMore(rows: unknown[], size = PAGE_SIZE): boolean {
  return rows.length === size;
}
