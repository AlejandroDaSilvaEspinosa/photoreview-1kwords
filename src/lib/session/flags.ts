// src/lib/session/flags.ts
import { sessionGet, sessionSet } from "@/lib/storage";

/** Flags de sesión deduplicados por pestaña: has()/mark() */
export function makeSessionFlag(prefix: string) {
  const key = (id: string | number) => `${prefix}:${id}`;
  return {
    has(id: string | number) {
      if (typeof sessionStorage === "undefined") return false;
      return sessionGet(key(id)) != null;
    },
    mark(id: string | number, value: string = String(Date.now())) {
      if (typeof sessionStorage === "undefined") return;
      sessionSet(key(id), value);
    },
  };
}
