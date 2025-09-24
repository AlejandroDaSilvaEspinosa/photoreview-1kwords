"use client";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  useNotificationsStore,
  type NotificationRow,
  notificationsCache,
} from "@/stores/notifications";
import { presentNotification } from "@/lib/notifications/presenter";
import { useToast } from "@/hooks/useToast";
import { format } from "timeago.js";

export function useWireNotificationsRealtime(opts?: {
  initial?: { items: NotificationRow[]; unseen?: number } | null;
  limit?: number;
  prefetchFromApi?: boolean;
}) {
  const hydrate = useNotificationsStore((s) => s.hydrate);
  const upsert  = useNotificationsStore((s) => s.upsert);
  const setSelfAuthId = useNotificationsStore((s) => s.setSelfAuthId);
  const { push } = useToast();

  useEffect(() => {
    let cancelled = false;

    const sb = supabaseBrowser();
    let ch: ReturnType<typeof sb.channel> | null = null;
    let subscribed = false;
    let retryMs = 1000;
    const maxMs = 15000;
    let retryTimer: number | null = null;

    const clearRetry = () => { if (retryTimer != null) { clearTimeout(retryTimer); retryTimer = null; } };
    const scheduleReconnect = () => {
      if (cancelled) return;
      clearRetry();
      retryTimer = window.setTimeout(() => {
        connect().catch(() => scheduleReconnect());
        retryMs = Math.min(maxMs, retryMs * 2);
      }, retryMs) as unknown as number;
    };

    const catchUp = async () => {
      if (cancelled) return;
      const latest = useNotificationsStore.getState().items[0]?.created_at;
      if (!latest) return;
      try {
        const url = new URL(`/api/notifications`, window.location.origin);
        url.searchParams.set("after", latest);
        url.searchParams.set("limit", String(opts?.limit ?? 30));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const rows: NotificationRow[] = json.items ?? [];
        for (const r of rows) upsert(r); // no toastees el catch-up
      } catch { /* noop */ }
    };

    const connect = async () => {
      subscribed = false;

      // Limpia duplicados
      for (const c of sb.getChannels()) {       
        if (c.topic && String(c.topic).startsWith("notifications-")) sb.removeChannel(c);
      }

      const { data } = await sb.auth.getUser();
      const uid = data.user?.id ?? null;
      setSelfAuthId(uid);
      if (!uid) return;

      // 1) Stale
      const cached = notificationsCache.load();
      if (cached) hydrate(cached.rows, cached.unseen);

      // 2) Fresh
      if (opts?.initial) {
        hydrate(opts.initial.items || [], opts.initial.unseen ?? undefined);
      } else if (opts?.prefetchFromApi !== false) {
        try {
          const res = await fetch(`/api/notifications?limit=${opts?.limit ?? 30}`, { cache: "no-store" });
          if (!cancelled && res.ok) {
            const json = await res.json();
            hydrate(json.items || [], json.unseen ?? undefined);
          }
        } catch { /* noop */ }
      }

      // 3) Realtime (UN SOLO CANAL)
      const channelName = `notifications-${uid}`;
      ch = sb.channel(channelName);

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (p: any) => {
          if (cancelled) return;

          const evt = p.eventType as "INSERT" | "UPDATE" | "DELETE";
          const row = (evt === "DELETE" ? p.old : p.new) as NotificationRow;
          if (!row || row.user_id !== uid) return;

          // Actualiza store siempre
          upsert(row);

          // Toast SOLO en INSERT realtime
          if (evt === "INSERT") {
            const pres = presentNotification(row);
            const createdAt = row.created_at ? new Date(row.created_at) : new Date();
            const timeAgo = format(createdAt, "es")

            push({
              title: pres.title,
              timeAgo: timeAgo,               // ⬅️ ver Toaster + useToast
              description: pres.description,
              variant: pres.variant,
              actionLabel: pres.actionLabel,
              onAction: () => {
                if (!pres.deeplink) return;
                const url = new URL(window.location.href);
                const [base] = url.href.split("?"); // limpia qs actual
                window.history.pushState({}, "", `${base}${pres.deeplink}`);
                // Opcional: emitir un evento si necesitas que algo reaccione
              },
            });
          }
        }
      );

      await ch.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          subscribed = true;
          clearRetry();
          retryMs = 1000;
          catchUp();
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          subscribed = false;
          scheduleReconnect();
        }
      });
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!subscribed) connect(); else catchUp();
    };
    const onOnline = () => { if (!subscribed) connect(); else catchUp(); };

    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("online", onOnline);

    connect();

    return () => {
      cancelled = true;
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("online", onOnline);
      if (ch) supabaseBrowser().removeChannel(ch);
    };
  }, [hydrate, upsert, setSelfAuthId, opts?.initial, opts?.limit, opts?.prefetchFromApi]);
}
