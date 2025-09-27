// src/hooks/useSupabaseUserId.ts
"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { toastError } from "@/hooks/useToast";

/**
 * Devuelve el auth.user.id actual (o null si no hay sesión).
 * Lee una sola vez al montar. Si necesitas reaccionar a cambios
 * de sesión, añade aquí onAuthStateChange con setId.
 */
export function useSupabaseUserId() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sb = supabaseBrowser();
        const { data } = await sb.auth.getUser();
        if (alive) setId(data.user?.id ?? null);
      } catch (e) {
        if (alive) setId(null);
        toastError(e, {
          title: "No se pudo obtener la sesión",
          fallback: "Intenta recargar la página.",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return id;
}
