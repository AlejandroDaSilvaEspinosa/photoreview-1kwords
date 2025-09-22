"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useNotificationsStore, type NotificationRow } from "@/stores/notifications";

/**
 * Realtime de notificaciones del usuario autenticado.
 * Opcionalmente puedes pasar "prefetch" para hidratar desde tu API.
 */
export function useWireNotificationsRealtime(opts?: {
  /** Si pasas initial, hidrata de inmediato. */
  initial?: { items: NotificationRow[]; unseen?: number } | null;
  /** Límite de elementos en hidrato remoto si haces fetch desde aquí. (No requerido) */
  limit?: number;
  /** Si true, hace fetch /api/notifications al montar (si no hay initial) */
  prefetchFromApi?: boolean;
}) {
  const hydrate = useNotificationsStore((s) => s.hydrate);
  const upsert = useNotificationsStore((s) => s.upsert);
  const setSelfAuthId = useNotificationsStore((s) => s.setSelfAuthId);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const sb = supabaseBrowser();

      // UID del usuario
      const { data } = await sb.auth.getUser();
      const uid = data.user?.id ?? null;
      setSelfAuthId(uid);
      if (!uid) return; // no suscribimos si no hay auth

      // Hidratación inicial (prioriza "initial")
      if (opts?.initial) {
        hydrate(opts.initial.items || [], opts.initial.unseen ?? undefined);
      } else if (opts?.prefetchFromApi) {
        try {
          const res = await fetch(`/api/notifications?limit=${opts.limit ?? 30}`, { cache: "no-store" });
          if (cancelled) return;
          if (res.ok) {
            const json = await res.json();
            hydrate(json.items || [], json.unseen ?? undefined);
          }
        } catch {
          /* noop */
        }
      }

      // Canal realtime filtrado por user_id
      const ch = sb.channel(`notifications-${uid}`, { config: { broadcast: { ack: true } } });

      ch.on(
        "postgres_changes",
        {
          event: "*", // INSERT/UPDATE por si cambian viewed en otros clientes
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${uid}`,
        },
        (p: any) => {
          const row = (p.eventType === "DELETE" ? p.old : p.new) as NotificationRow;
          if (!row) return;
          if (row.user_id !== uid) return;
          upsert(row);
        }
      );

      ch.subscribe();

      return () => {
        supabaseBrowser().removeChannel(ch);
      };
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [opts?.initial, opts?.limit, opts?.prefetchFromApi, hydrate, upsert, setSelfAuthId]);
}
