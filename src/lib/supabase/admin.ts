import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

const SERVICE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function supabaseAdmin(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin() solo en servidor.");
  }
  return createClient<Database>(SERVICE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}
