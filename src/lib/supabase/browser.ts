// src/lib/supabase/browser.ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let _client: SupabaseClient<Database> | null = null;
export function supabaseBrowser(): SupabaseClient<Database> {
  if (!_client) _client = createBrowserClient<Database>(URL, KEY);
  return _client;
}
