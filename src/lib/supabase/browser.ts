"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

declare global {
  interface Window {
    __supabase_singleton__?: SupabaseClient<Database>;
  }
}

let _client: SupabaseClient<Database> | null = null;

/** Singleton real que sobrevive a HMR y garantiza 1 WebSocket por app */
export function supabaseBrowser(): SupabaseClient<Database> {
  if (_client) return _client;
  if (typeof window !== "undefined" && window.__supabase_singleton__) {
    _client = window.__supabase_singleton__!;
    return _client;
  }
  _client = createBrowserClient<Database>(URL, KEY);
  if (typeof window !== "undefined") window.__supabase_singleton__ = _client;
  return _client;
}
