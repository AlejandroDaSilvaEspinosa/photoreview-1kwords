// src/lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function supabaseServer(): SupabaseClient<Database> {
  const store = cookies();
  return createServerClient<Database>(URL, KEY, {
    cookies: {
      // API nueva: devolver TODAS las cookies
      getAll() {
        return store.getAll().map(({ name, value }) => ({ name, value }));
      },
      // En RSC no debemos mutar cookies; dejamos un no-op por compatibilidad
      setAll() {},
    },
  });
}
