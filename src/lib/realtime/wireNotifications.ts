"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useNotificationsStore, type NotificationRow, notificationsCache } from "@/stores/notifications";

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

    const sb = supabaseBrowser();
    // ⬇️ referencia al canal para poder limpiarlo en el cleanup REAL del efecto
    let ch: ReturnType<typeof sb.channel> | null = null;

    (async () => {
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
          // noop
        }
      }

      // 3) Realtime
      const channelName = `notifications-${uid}`;

      // (Opcional) evita duplicados si el efecto se re-ejecuta
      for (const c of sb.getChannels()) {
        if (c.topic === channelName) sb.removeChannel(c);
      }

      ch = sb.channel(channelName);
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (p: any) => {
          // si el componente se desmontó, no toques estado
          if (cancelled) return;
          const row = (p.eventType === "DELETE" ? p.old : p.new) as NotificationRow;
          if (!row || row.user_id !== uid) return;
          upsert(row);
        }
      );

      await ch.subscribe();
    })();

    // ✅ cleanup REAL: cierra el canal cuando el efecto se limpia
    return () => {
      cancelled = true;
      if (ch) sb.removeChannel(ch);
    };
  // Nota: estas deps son suficientes y estables con Zustand
  }, [hydrate, upsert, setSelfAuthId, opts?.initial, opts?.limit, opts?.prefetchFromApi]);
}
