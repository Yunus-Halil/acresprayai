// Stand-in for `https://esm.sh/@supabase/supabase-js@2.45.0`, wired up by the
// alias in vitest.config.ts. Edge functions call `createClient` at module scope,
// so this must exist before their first import.
//
// The registered client lives on globalThis rather than in module scope: the
// harness calls `vi.resetModules()` before importing a function (so its own
// module-level singletons and caches reset), which would otherwise hand the
// function a fresh, empty copy of this module.
const KEY = "__swathwise_mock_supabase_client__";

export function __setMockClient(client: unknown) {
  (globalThis as Record<string, unknown>)[KEY] = client;
}

export function createClient(_url?: string, _key?: string, _opts?: unknown) {
  const client = (globalThis as Record<string, unknown>)[KEY];
  if (!client) {
    throw new Error("edge test harness: call __setMockClient() before importing the function");
  }
  return client;
}

export default { createClient };
