"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useNotificationsStore, type NotificationRow, notificationsCache } from "@/stores/notifications";

/**
 * Realtime + SWR:
 * - Lee caché local inmediatamente (stale).
 * - Opcionalmente prefetch a /api/notifications para la primera página (fresh).
 * - Después escucha realtime (INSERT/UPDATE).
 */
export function useWireNotificationsRealtime(opts?: {
  initial?: { items: NotificationRow[]; unseen?: number } | null;
  limit?: number;
  prefetchFromApi?: boolean;
}) {
  const hydrate = useNotificationsStore((s) => s.hydrate);
  const upsert = useNotificationsStore((s) => s.upsert);
  const setSelfAuthId = useNotificationsStore((s) => s.setSelfAuthId);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.auth.getUser();
      const uid = data.user?.id ?? null;
      setSelfAuthId(uid);
      if (!uid) return;

      // 1) Stale desde localStorage
      const cached = notificationsCache.load();
      if (cached) hydrate(cached.rows, cached.unseen);

      // 2) Fresh: initial o fetch
      if (opts?.initial) {
        hydrate(opts.initial.items || [], opts.initial.unseen ?? undefined);
      } else if (opts?.prefetchFromApi !== false) {
        try {
          const res = await fetch(`/api/notifications?limit=${opts?.limit ?? 30}`, { cache: "no-store" });
          if (!cancelled && res.ok) {
            const json = await res.json();
            hydrate(json.items || [], json.unseen ?? undefined);
          }
        } catch { 
          console.log("error")
        }
      }

      // 3) Realtime
      const ch = sb.channel(`notifications-${uid}`, { config: { broadcast: { ack: true } } });
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (p: any) => {
          const row = (p.eventType === "DELETE" ? p.old : p.new) as NotificationRow;
          if (!row || row.user_id !== uid) return;
          upsert(row);
        }
      );
      ch.subscribe();

      return () => { supabaseBrowser().removeChannel(ch); };
    })();

    return () => { cancelled = true; };
  }, [opts?.initial, opts?.limit, opts?.prefetchFromApi, hydrate, upsert, setSelfAuthId]);
}
