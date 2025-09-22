// src/lib/supabase/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function supabaseFromRequest(req: NextRequest): {
  client: SupabaseClient<Database>;
  res: NextResponse;
} {
  // Usamos un response “portador” para setear cookies de sesión/refresh
  const res = new NextResponse(null, { headers: new Headers() });

  const client = createServerClient<Database>(URL, KEY, {
    cookies: {
      getAll() {
        return req.cookies.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set({ name, value, ...options });
        });
      },
    },
  });

  return { client, res };
}
