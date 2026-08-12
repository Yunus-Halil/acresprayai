// Network resilience helpers for talking to the processing node and TiTiler.
//
// Every external call in this pipeline used a bare `fetch` with no timeout and
// no retry. A hung socket therefore held an edge invocation until the platform
// killed it, and a single transient 502 was indistinguishable from a permanent
// failure — which is how one bad second turned a completed scan into a
// permanently "failed" one.

/** HTTP statuses worth trying again. Anything else is the server's real answer. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

export class HttpError extends Error {
  constructor(readonly status: number, readonly body: string, readonly retryable: boolean) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

/** True for failures that are worth retrying rather than reporting to the user. */
export function isTransient(e: unknown): boolean {
  if (e instanceof HttpError) return e.retryable;
  // Aborts, DNS failures, connection resets, TLS hiccups: all worth another go.
  return e instanceof Error;
}

export type FetchOpts = RequestInit & {
  /** Per-attempt timeout. The overall call can take up to this × attempts. */
  timeoutMs?: number;
  /** Total attempts including the first. 1 disables retrying. */
  attempts?: number;
  /** Base backoff; doubles per attempt with jitter. */
  backoffMs?: number;
  /** Label used in logs so a stuck stage is identifiable from the dashboard. */
  label?: string;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * fetch with a hard per-attempt timeout and exponential backoff on transient
 * failures. Resolves with the Response for any non-retryable status (including
 * 404) so callers can branch on it; throws only when every attempt failed.
 */
export async function fetchResilient(url: string, opts: FetchOpts = {}): Promise<Response> {
  const {
    timeoutMs = 30_000,
    attempts = 3,
    backoffMs = 500,
    label = "fetch",
    ...init
  } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (RETRYABLE_STATUS.has(res.status) && attempt < attempts) {
        // Drain so the connection can be reused rather than left dangling.
        await res.body?.cancel().catch(() => {});
        lastError = new HttpError(res.status, "", true);
        console.warn(`[${label}] attempt ${attempt}/${attempts} -> ${res.status}, retrying`);
      } else {
        return res;
      }
    } catch (e) {
      lastError = e;
      const reason = (e as Error)?.name === "TimeoutError" ? `timeout after ${timeoutMs}ms` : String((e as Error)?.message ?? e);
      console.warn(`[${label}] attempt ${attempt}/${attempts} failed: ${reason}`);
      if (attempt >= attempts) break;
    }
    // Full jitter, so a fleet of pollers doesn't retry in lockstep.
    const backoff = backoffMs * 2 ** (attempt - 1);
    await sleep(Math.random() * backoff);
  }
  throw lastError ?? new Error(`${label}: exhausted ${attempts} attempts`);
}

/**
 * Parse a response as JSON without throwing. Upstream proxies return HTML error
 * pages on 502/504; an unguarded `res.json()` on one of those threw and left the
 * caller unable to tell "bad gateway" from "bad data".
 */
export async function jsonSafe<T = unknown>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** A single streaming attempt — never retried, since the body can only be read once. */
export function fetchStream(url: string, timeoutMs = 120_000, label = "stream"): Promise<Response> {
  return fetchResilient(url, { timeoutMs, attempts: 1, label });
}
