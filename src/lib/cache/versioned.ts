// src/lib/cache/versioned.ts
import { localGet, localSet, localRemove, persistIdle, safeParse } from "@/lib/storage";

/** Caché versionada para una sola clave. */
export function createVersionedCache<T>(namespace: string, version: number) {
  const KEY = `${namespace}:v${version}`;
  type Payload = { v: number; at: number; data: T };

  return {
    load(): T | null {
      if (typeof window === "undefined") return null;
      const payload = safeParse<Payload>(localGet(KEY));
      return payload?.data ?? null;
    },
    save(data: T) {
      if (typeof window === "undefined") return;
      persistIdle(() => localSet(KEY, JSON.stringify({ v: version, at: Date.now(), data }), false));
    },
    clear() {
      if (typeof window === "undefined") return;
      localRemove(KEY);
    },
    key: KEY,
  };
}

/** Caché versionada con sub-keys (útil para threads, imágenes…) */
export function createVersionedCacheNS<T>(namespace: string, version: number) {
  const KEY = (sub?: string) => (sub ? `${namespace}:v${version}:${sub}` : `${namespace}:v${version}`);
  type Payload = { v: number; at: number; data: T };

  return {
    load(subkey: string): T | null {
      if (typeof window === "undefined") return null;
      const payload = safeParse<Payload>(localGet(KEY(subkey)));
      return payload?.data ?? null;
    },
    save(subkey: string, data: T) {
      if (typeof window === "undefined") return;
      persistIdle(() => localSet(KEY(subkey), JSON.stringify({ v: version, at: Date.now(), data }), false));
    },
    clear(subkey: string) {
      if (typeof window === "undefined") return;
      localRemove(KEY(subkey));
    },
    keyOf: KEY,
  };
}
