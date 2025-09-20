// src/lib/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

const PUBLIC_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLIC_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_URL = process.env.SUPABASE_URL!; // normalmente igual a PUBLIC_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ───────────────────────────────────────────────────────────────────────────────
// Singleton BROWSER (usar en componentes/hooks de cliente)
// ───────────────────────────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __sb_browser__: SupabaseClient<Database> | undefined;
}

export function supabaseBrowser(): SupabaseClient<Database> {
  // Nota: no marcamos este archivo con "use client" para no romper el admin.
  if (!globalThis.__sb_browser__) {
    globalThis.__sb_browser__ = createClient<Database>(PUBLIC_URL, PUBLIC_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "app-auth", // fija un storageKey para evitar colisiones
      },
      global: { headers: { "cache-control": "no-cache" } },
      realtime: { params: { eventsPerSecond: 20 } }, // opcional
    });
  }
  return globalThis.__sb_browser__!;
}

// ───────────────────────────────────────────────────────────────────────────────
// Singleton ADMIN (usar SOLO en servidor: actions, API routes, RSC, cron)
// ───────────────────────────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __sb_admin__: SupabaseClient<Database> | undefined;
}

export function supabaseAdmin(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin() no debe usarse en el navegador.");
  }
  if (!globalThis.__sb_admin__) {
    globalThis.__sb_admin__ = createClient<Database>(SERVICE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
      global: { headers: { "cache-control": "no-cache" } },
    });
  }
  return globalThis.__sb_admin__!;
}
