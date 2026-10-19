// An in-memory localStorage for app modules run under Node (the Supabase client reads it when it loads).
// Imported first by benchmark scripts that load app code; never by the app.
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
}
export {};
