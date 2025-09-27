// src/lib/net/retryFetch.ts
import { ApiError } from "@/lib/api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => Math.floor(ms * (0.75 + Math.random() * 0.5));

/** fetch JSON con timeout y reintentos con backoff exponencial + jitter. */
export async function fetchJsonRetry<T>(
  input: RequestInfo,
  init: RequestInit = {},
  opts: { retries?: number; baseMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const { retries = 2, baseMs = 600, timeoutMs = 10000 } = opts;

  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(input, { ...init, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok)
        throw new ApiError(
          (await res.text().catch(() => "")) || "Error del servidor",
          res.status,
        );
      return res.json() as Promise<T>;
    } catch (e) {
      clearTimeout(t);
      if (attempt >= retries) throw e;
      const delay = jitter(baseMs * Math.pow(2, attempt));
      await sleep(delay);
    }
  }
}
