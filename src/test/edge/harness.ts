// Test harness for the Supabase edge functions.
//
// The functions are Deno modules: they import from `https://esm.sh/...`, read
// `Deno.env` at module scope, and register their handler with `Deno.serve`.
// None of that resolves under vitest, which is why they were untested.
//
// This harness makes them loadable and callable:
//   - `vitest.config.ts` aliases the esm.sh URLs to local mocks
//   - `installDenoGlobal()` stubs `Deno.env` and captures the `Deno.serve` handler
//   - `makeSupabase()` is an in-memory Supabase client good enough to exercise
//     real behaviour, not just assert on stub calls
//
// The database mock implements the small slice of PostgREST these functions
// actually use — including the `.or()` filter string that the mirror lease
// depends on. That matters: the lease IS the filter, so a mock that ignored it
// would test nothing.
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Deno global
// ---------------------------------------------------------------------------

export type EdgeHandler = (req: Request) => Promise<Response> | Response;

let capturedHandler: EdgeHandler | null = null;

export function installDenoGlobal(env: Record<string, string> = {}) {
  const vars: Record<string, string> = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    ODM_BASE_URL: "https://odm.test",
    ODM_AUTH_TOKEN: "odm-token",
    ...env,
  };
  capturedHandler = null;
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => vars[k] },
    serve: (h: EdgeHandler) => { capturedHandler = h; return { finished: Promise.resolve() }; },
  };
  // Supabase provides this for background work; run it inline so tests can await it.
  (globalThis as Record<string, unknown>).EdgeRuntime = {
    waitUntil: (p: Promise<unknown>) => { pendingBackground.push(Promise.resolve(p)); },
  };
}

const pendingBackground: Promise<unknown>[] = [];

/** Await any work the handler handed to EdgeRuntime.waitUntil. */
export async function flushBackground() {
  while (pendingBackground.length) {
    const batch = pendingBackground.splice(0, pendingBackground.length);
    await Promise.allSettled(batch);
  }
}

export function getHandler(): EdgeHandler {
  if (!capturedHandler) throw new Error("No handler registered — did the module import Deno.serve?");
  return capturedHandler;
}

/** Import an edge function fresh, so its module-scope singletons reset. */
export async function loadFunction(path: string): Promise<EdgeHandler> {
  vi.resetModules();
  await import(/* @vite-ignore */ path);
  return getHandler();
}

// ---------------------------------------------------------------------------
// PostgREST filter subset
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** `status.in.(a,b)` / `status.eq.x` / `mirror_started_at.lt.<iso>` */
function evalLeaf(row: Row, leaf: string): boolean {
  const inMatch = leaf.match(/^(\w+)\.in\.\(([^)]*)\)$/);
  if (inMatch) {
    const [, col, list] = inMatch;
    return list.split(",").map(s => s.trim()).includes(String(row[col]));
  }
  const opMatch = leaf.match(/^(\w+)\.(eq|lt|gt|lte|gte|neq)\.(.*)$/);
  if (!opMatch) throw new Error(`harness: unsupported filter leaf "${leaf}"`);
  const [, col, op, rawVal] = opMatch;
  const actual = row[col];
  switch (op) {
    case "eq": return String(actual) === rawVal;
    case "neq": return String(actual) !== rawVal;
    case "lt": case "gt": case "lte": case "gte": {
      // These are only ever used on timestamps here.
      if (actual == null) return false;
      const a = Date.parse(String(actual));
      const b = Date.parse(rawVal);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (op === "lt") return a < b;
      if (op === "gt") return a > b;
      if (op === "lte") return a <= b;
      return a >= b;
    }
    default: return false;
  }
}

/** Split a comma-separated PostgREST list, respecting nested parentheses. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0, current = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(current); current = ""; continue; }
    current += ch;
  }
  if (current) out.push(current);
  return out.map(x => x.trim());
}

/** Evaluate one `.or(...)` argument against a row. */
export function evalOrFilter(row: Row, filter: string): boolean {
  return splitTopLevel(filter).some(term => {
    const andMatch = term.match(/^and\((.*)\)$/);
    if (andMatch) return splitTopLevel(andMatch[1]).every(leaf => evalLeaf(row, leaf));
    return evalLeaf(row, term);
  });
}

// ---------------------------------------------------------------------------
// Supabase client mock
// ---------------------------------------------------------------------------

export type StorageCall = { bucket: string; op: string; path: string };

export type SupabaseMock = {
  client: unknown;
  tables: Record<string, Row[]>;
  storage: {
    objects: Map<string, unknown>;
    calls: StorageCall[];
    /** Paths that should fail on upload, to simulate a storage blip. */
    failUploads: Set<string>;
  };
  /**
   * Set the user `auth.getUser()` resolves to. null = unauthenticated.
   * The email matters for endpoints that authorise on an allowlist rather than
   * row ownership, such as `pilot-applications`.
   */
  setUser: (id: string | null, email?: string) => void;
  /** auth.users as the admin API sees it (listUsers / generateLink). */
  authUsers: { id: string; email: string; created_at?: string; last_sign_in_at?: string | null }[];
  /** Every link auth.admin.generateLink was asked for. */
  links: { type: string; email: string; redirectTo?: string }[];
};

export function makeSupabase(seed: Record<string, Row[]> = {}, o: { /** Tables whose new rows the database dates itself (created_at DEFAULT now()). */ dated?: string[] } = {}): SupabaseMock {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  // The default caller ("user-1") is the pilot's founder unless a test seeds pilot_members itself: most functions
  // under test are founder-only (supabase/functions/_shared/access.ts), and their own behaviour is what those tests
  // are about. The access tests seed members explicitly.
  if (!("pilot_members" in tables)) tables.pilot_members = [{ user_id: "user-1", role: "founder", status: "active" }];
  const objects = new Map<string, unknown>();
  const calls: StorageCall[] = [];
  const failUploads = new Set<string>();
  let userId: string | null = "user-1";
  let userEmail: string | undefined;
  const authUsers: SupabaseMock["authUsers"] = [];
  const links: SupabaseMock["links"] = [];

  const matchRow = (row: Row, eqs: [string, unknown][], orFilter: string | null) => {
    for (const [k, v] of eqs) if (row[k] !== v) return false;
    if (orFilter && !evalOrFilter(row, orFilter)) return false;
    return true;
  };

  function queryBuilder(table: string) {
    const eqs: [string, unknown][] = [];
    let orFilter: string | null = null;
    let mode: "select" | "update" | "insert" = "select";
    let payload: Row | null = null;
    let inserted: Row[] = [];
    const orders: [string, boolean][] = [];
    const ranges: [string, "gte" | "lte" | "gt" | "lt", unknown][] = [];
    let limitTo: number | null = null;

    const rows = () => (tables[table] ??= []);

    const apply = () => {
      if (mode === "insert") return inserted;
      const within = (r: Row) => ranges.every(([k, op, v]) => { const x = r[k] as never, y = v as never; return x != null && (op === "gte" ? x >= y : op === "lte" ? x <= y : op === "gt" ? x > y : x < y); });
      let hits = rows().filter(r => matchRow(r, eqs, orFilter) && within(r));
      if (mode === "update" && payload) for (const r of hits) Object.assign(r, payload);
      // A read is ordered and cut as it was asked to be (rows without the column keep their place).
      if (mode === "select" && orders.length) {
        hits = [...hits].sort((a, b) => {
          for (const [col, asc] of orders) {
            const x = a[col], y = b[col];
            if (x == null || y == null || x === y) continue;
            return (x < y ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
      }
      if (mode === "select" && limitTo != null) hits = hits.slice(0, limitTo);
      return hits;
    };

    const builder: Record<string, unknown> = {
      select() { if (mode === "select") mode = "select"; return builder; },
      eq(k: string, v: unknown) { eqs.push([k, v]); return builder; },
      in(k: string, list: unknown[]) { eqs.push([k, list[0]]); return builder; },
      or(f: string) { orFilter = f; return builder; },
      gte(k: string, v: unknown) { ranges.push([k, "gte", v]); return builder; },
      lte(k: string, v: unknown) { ranges.push([k, "lte", v]); return builder; },
      gt(k: string, v: unknown) { ranges.push([k, "gt", v]); return builder; },
      lt(k: string, v: unknown) { ranges.push([k, "lt", v]); return builder; },
      order(col: string, o?: { ascending?: boolean }) { orders.push([col, o?.ascending !== false]); return builder; },
      limit(n: number) { limitTo = n; return builder; },
      range() { return builder; },
      update(p: Row) { mode = "update"; payload = p; return builder; },
      insert(p: Row | Row[]) {
        mode = "insert";
        const list = Array.isArray(p) ? p : [p];
        inserted = list.map((r, k) => ({ id: `row-${rows().length + 1 + k}`, ...(o.dated?.includes(table) ? { created_at: new Date().toISOString() } : {}), ...r }));
        rows().push(...inserted);
        return builder;
      },
      delete() {
        mode = "update";
        payload = null;
        const hits = rows().filter(r => matchRow(r, eqs, orFilter));
        tables[table] = rows().filter(r => !hits.includes(r));
        return Promise.resolve({ data: hits, error: null });
      },
      maybeSingle() { const h = apply(); return Promise.resolve({ data: h[0] ?? null, error: null }); },
      single() { const h = apply(); return Promise.resolve({ data: h[0] ?? null, error: h[0] ? null : { message: "no rows" } }); },
      then(res: (v: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: apply(), error: null }).then(res); },
    };
    return builder;
  }

  const client = {
    from: (t: string) => queryBuilder(t),
    auth: {
      getUser: () => Promise.resolve({
        data: { user: userId ? { id: userId, email: userEmail } : null },
        error: null,
      }),
      admin: {
        listUsers: ({ page, perPage }: { page: number; perPage: number }) =>
          Promise.resolve({ data: { users: authUsers.slice((page - 1) * perPage, page * perPage) }, error: null }),
        generateLink: ({ type, email, options }: { type: string; email: string; options?: { redirectTo?: string } }) => {
          links.push({ type, email, redirectTo: options?.redirectTo });
          let user = authUsers.find(u => u.email === email);
          if (!user && type === "invite") { user = { id: `invited-${authUsers.length + 1}`, email }; authUsers.push(user); }
          if (!user) return Promise.resolve({ data: null, error: { message: "User not found" } });
          return Promise.resolve({ data: { user, properties: { action_link: `https://test.supabase.co/auth/v1/verify?type=${type}&token=t-${links.length}` } }, error: null });
        },
      },
    },
    storage: {
      from(bucket: string) {
        return {
          download(path: string) {
            calls.push({ bucket, op: "download", path });
            const key = `${bucket}/${path}`;
            if (!objects.has(key)) return Promise.resolve({ data: null, error: { message: "not found" } });
            const body = objects.get(key);
            return Promise.resolve({
              data: { stream: () => new ReadableStream({ start(c) { c.enqueue(body); c.close(); } }) },
              error: null,
            });
          },
          upload(path: string, body: unknown) {
            calls.push({ bucket, op: "upload", path });
            if (failUploads.has(path)) return Promise.resolve({ data: null, error: { message: "storage blip" } });
            objects.set(`${bucket}/${path}`, body);
            return Promise.resolve({ data: { path }, error: null });
          },
          createSignedUrl(path: string) {
            calls.push({ bucket, op: "sign", path });
            return Promise.resolve({ data: { signedUrl: `https://signed.test/${bucket}/${path}` }, error: null });
          },
          createSignedUploadUrl(path: string) {
            calls.push({ bucket, op: "signUpload", path });
            return Promise.resolve({ data: { path, token: "upload-token" }, error: null });
          },
          list(prefix: string) {
            calls.push({ bucket, op: "list", path: prefix });
            const names = [...objects.keys()]
              .filter(k => k.startsWith(`${bucket}/${prefix}`))
              .map(k => ({ name: k.split("/").pop() }));
            return Promise.resolve({ data: names, error: null });
          },
        };
      },
    },
  };

  return {
    client,
    tables,
    storage: { objects, calls, failUploads },
    setUser: (id, email) => { userId = id; userEmail = email; },
    authUsers,
    links,
  };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

export const AUTH = { Authorization: "Bearer test-jwt" };

export function postJson(url: string, body: unknown, headers: Record<string, string> = AUTH) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export function get(url: string, headers: Record<string, string> = AUTH) {
  return new Request(url, { method: "GET", headers });
}

/**
 * Route outbound fetches by URL substring. Anything unmatched throws loudly.
 *
 * `respond` receives the request URL. Prefer branching on that over a call
 * counter: `fetchResilient` retries transient statuses, so a counter-based
 * responder silently lets the second attempt succeed and tests the retry path
 * rather than the failure path you meant to exercise.
 */
export function mockFetch(
  routes: { match: string | RegExp; respond: (url: string) => Response | Promise<Response> }[],
) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    for (const r of routes) {
      const hit = typeof r.match === "string" ? url.includes(r.match) : r.match.test(url);
      if (hit) return await r.respond(url);
    }
    throw new Error(`harness: unmocked fetch to ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const binaryResponse = (bytes: Uint8Array, status = 200) =>
  new Response(bytes, { status, headers: { "Content-Type": "application/octet-stream" } });
