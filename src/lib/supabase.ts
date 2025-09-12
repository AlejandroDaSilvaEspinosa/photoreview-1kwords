import { createClient } from "@supabase/supabase-js";

// Cliente para el navegador (solo lectura y realtime)
export const supabaseBrowser = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

// Cliente admin (solo servidor) para inserts/updates
export const supabaseAdmin = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // ¡NO expongas en cliente!
    { auth: { persistSession: false } }
  );
