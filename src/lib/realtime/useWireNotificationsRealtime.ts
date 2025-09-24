// src/lib/realtime/useWireNotificationsRealtime.ts
"use client";
import { toastError } from "@/hooks/useToast"
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  useNotificationsStore,
  type NotificationRow,
  notificationsCache,
} from "@/stores/notifications";

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
    let ch: ReturnType<typeof sb.channel> | null = null;
    let subscribed = false;
    let retryMs = 1000;
    const maxMs = 15000;
    let retryTimer: number | null = null;

    const clearRetry = () => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      clearRetry();
      retryTimer = window.setTimeout(() => {
        // re-intenta conexión
        connect().catch(() => scheduleReconnect());
        retryMs = Math.min(maxMs, retryMs * 2);
      }, retryMs) as unknown as number;
    };

    const catchUp = async () => {
      if (cancelled) return;
      const latest = useNotificationsStore.getState().items[0]?.created_at; // más reciente
      if (!latest) return;
      try {
        const url = new URL(`/api/notifications`, window.location.origin);
        url.searchParams.set("after", latest);
        url.searchParams.set("limit", String(opts?.limit ?? 30));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const rows: NotificationRow[] = json.items ?? [];
        // inserta una a una para respetar upsert y contadores unseen
        for (const r of rows) upsert(r);
      } catch (e) {
          toastError(e, { title: "Fallo obteniendo las últimas notificaciones" });
        }
    };

    const connect = async () => {
      subscribed = false;

      // limpiar canales previos del mismo tópico
      for (const c of sb.getChannels()) {
        if (c.topic && c.topic.startsWith("notifications-")) {
          sb.removeChannel(c);
        }
      }

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
          const res = await fetch(
            `/api/notifications?limit=${opts?.limit ?? 30}`,
            { cache: "no-store" }
          );
          if (!cancelled && res.ok) {
            const json = await res.json();
            hydrate(json.items || [], json.unseen ?? undefined);
          }
        } catch (e) {
          toastError(e, { title: "Fallo conectandose a las notificaciones" });
        }
      }

      // 3) Realtime
      const channelName = `notifications-${uid}`;
      ch = sb.channel(channelName);

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (p: any) => {
          if (cancelled) return;
          const row = (p.eventType === "DELETE" ? p.old : p.new) as NotificationRow;
          if (!row || row.user_id !== uid) return;
          upsert(row);
        }
      );

      await ch.subscribe((status) => {
        // estados: 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT'
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          subscribed = true;
          clearRetry();
          retryMs = 1000;
          // al lograr suscripción, hacemos catch-up por si nos perdimos algo
          catchUp();
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          subscribed = false;
          scheduleReconnect();
        }
      });
    };

    // listeners para foco/online
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // si no estuviera suscrito, reconecta; si sí, haz catch-up
        if (!subscribed) connect();
        else catchUp();
      }
    };
    const onOnline = () => {
      if (!subscribed) connect();
      else catchUp();
    };

    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("online", onOnline);

    // arranque
    connect();

    return () => {
      cancelled = true;
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("online", onOnline);
      clearRetry();
      if (ch) supabaseBrowser().removeChannel(ch);
    };
  }, [hydrate, upsert, setSelfAuthId, opts?.initial, opts?.limit, opts?.prefetchFromApi]);
}
