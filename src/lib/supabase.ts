import { createClient } from "@supabase/supabase-js";
import type { Database } from '@/types/supabase';
// Cliente para el navegador (solo lectura y realtime)
export const supabaseBrowser = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { 
      auth: { persistSession: false },
      global: { headers: { 'cache-control': 'no-cache' }  }
    },
    
  );

// Cliente admin (solo servidor) para inserts/updates
export const supabaseAdmin = () =>
  createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // ¡NO expongas en cliente!
    { auth: { persistSession: false },
      global: { headers: { 'cache-control': 'no-cache' }  }}
  );


  