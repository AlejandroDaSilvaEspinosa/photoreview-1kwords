// lib/realtime/useWireNotificationsRealtime.ts
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
import { deliveryAck } from "@/lib/realtime/deliveryAck";

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

    const catchUp = async (uid: string | null) => {
      if (cancelled || !uid) return;
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
        for (const r of rows) {
          upsert(r); // no toasts en catch-up
          if (r.type === "new_message") deliveryAck.enqueueFromNotification(r.message_id);
        }
        // intenta enviar en lote si hay visibles
        deliveryAck.flush();
      } catch { /* noop */ }
    };

    const connect = async () => {
      subscribed = false;

      // Evita canales duplicados
      for (const c of sb.getChannels()) {
        if (c.topic && String(c.topic).startsWith("notifications-")) sb.removeChannel(c);
      }

      const { data } = await sb.auth.getUser();
      const uid = data.user?.id ?? null;
      setSelfAuthId(uid);
      deliveryAck.setUser(uid);
      if (!uid) return;

      // 1) Cache local
      const cached = notificationsCache.load();
      if (cached) {
        hydrate(cached.rows, cached.unseen);
        cached.rows.forEach((r) => {
          if (r.type === "new_message") deliveryAck.enqueueFromNotification(r.message_id);
        });
      }

      // 2) SSR inicial / prefetch
      if (opts?.initial) {
        hydrate(opts.initial.items || [], opts.initial.unseen ?? undefined);
        (opts.initial.items || []).forEach((r) => {
          if (r.type === "new_message") deliveryAck.enqueueFromNotification(r.message_id);
        });
      } else if (opts?.prefetchFromApi !== false) {
        try {
          const res = await fetch(`/api/notifications?limit=${opts?.limit ?? 30}`, { cache: "no-store" });
          if (!cancelled && res.ok) {
            const json = await res.json();
            const rows: NotificationRow[] = json.items || [];
            hydrate(rows, json.unseen ?? undefined);
            rows.forEach((r) => {
              if (r.type === "new_message") deliveryAck.enqueueFromNotification(r.message_id);
            });
          }
        } catch { /* noop */ }
      }

      // 3) Realtime
      ch = sb.channel(`notifications-${uid}`);

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (p: any) => {
          if (cancelled) return;
          const evt = p.eventType as "INSERT" | "UPDATE" | "DELETE";
          const row = (evt === "DELETE" ? p.old : p.new) as NotificationRow;
          if (!row || row.user_id !== uid) return;

          upsert(row);

          if (evt === "INSERT") {
            if (row.type === "new_message") {
              deliveryAck.enqueueFromNotification(row.message_id);
              deliveryAck.flush(); // intenta enviar ya si visible
            }
            const pres = presentNotification(row);
            const createdAt = row.created_at ? new Date(row.created_at) : new Date();
            push({
              title: pres.title,
              timeAgo: format(createdAt, "es"),
              description: pres.description,
              variant: pres.variant,
              actionLabel: pres.actionLabel,
              thumbUrl: pres.thumbUrl,
              onAction: () => {
                if (!pres.deeplink) return;
                const url = new URL(window.location.href);
                const [base] = url.href.split("?");
                window.history.pushState({}, "", `${base}${pres.deeplink}`);
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
          catchUp(uid);
          deliveryAck.flush();
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          subscribed = false;
          scheduleReconnect();
        }
      });
    };

    const onVis = () => deliveryAck.onVisibilityOrOnline();
    const onOnline = () => deliveryAck.onVisibilityOrOnline();

    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("online", onOnline);

    connect();

    return () => {
      cancelled = true;
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("online", onOnline);
      if (ch) supabaseBrowser().removeChannel(ch);
      deliveryAck.reset();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrate, upsert, setSelfAuthId, opts?.initial, opts?.limit, opts?.prefetchFromApi]);
}
