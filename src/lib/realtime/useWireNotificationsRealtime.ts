"use client";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  useNotificationsStore,
  type NotificationRow,
  notificationsCache,
} from "@/stores/notifications";
import { presentNotification } from "@/lib/notifications/presenter";
import { useToast, toastError } from "@/hooks/useToast";
import { format } from "timeago.js";
import { deliveryAck } from "@/lib/realtime/deliveryAck";
import { connectWithBackoff } from "@/lib/realtime/channel";

export function useWireNotificationsRealtime(opts?: {
  initial?: { items: NotificationRow[]; unseen?: number } | null;
  limit?: number;
  prefetchFromApi?: boolean;
}) {
  const hydrate = useNotificationsStore((s) => s.hydrate);
  const upsert = useNotificationsStore((s) => s.upsert);
  const setSelfAuthId = useNotificationsStore((s) => s.setSelfAuthId);
  const { push } = useToast();

  useEffect(() => {
    let cancelled = false;
    const sb = supabaseBrowser();

    const primeLocal = async () => {
      const { data } = await sb.auth.getUser();
      const uid = data.user?.id ?? null;
      setSelfAuthId(uid);
      deliveryAck.setUser(uid);
      if (!uid) return;

      const cached = notificationsCache.load();
      if (cached) {
        hydrate(cached.rows, cached.unseen);
        cached.rows.forEach((r) => {
          if (r.type === "new_message")
            deliveryAck.enqueueFromNotification(r.message_id as any);
        });
      }

      if (opts?.initial) {
        hydrate(opts.initial.items || [], opts.initial.unseen ?? undefined);
        (opts.initial.items || []).forEach((r) => {
          if (r.type === "new_message")
            deliveryAck.enqueueFromNotification(r.message_id as any);
        });
      } else if (opts?.prefetchFromApi !== false) {
        try {
          const res = await fetch(
            `/api/notifications?limit=${opts?.limit ?? 30}`,
            { cache: "no-store" },
          );
          if (!cancelled && res.ok) {
            const json = await res.json();
            const rows: NotificationRow[] = json.items || [];
            hydrate(rows, json.unseen ?? undefined);
            rows.forEach((r) => {
              if (r.type === "new_message")
                deliveryAck.enqueueFromNotification(r.message_id as any);
            });
          }
        } catch (e) {
          if (!cancelled)
            toastError(e, { title: "Fallo cargando notificaciones" });
        }
      }
      deliveryAck.flush();
    };

    const catchUp = async () => {
      if (cancelled) return;
      const latest = useNotificationsStore.getState().items[0]?.created_at;
      const uid = useNotificationsStore.getState().selfAuthId;
      if (!uid || !latest) return;
      try {
        const url = new URL(`/api/notifications`, window.location.origin);
        url.searchParams.set("after", latest);
        url.searchParams.set("limit", String(opts?.limit ?? 30));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok)
          throw new Error(
            "Respuesta no válida del servidor de notificaciones.",
          );
        const json = await res.json();
        const rows: NotificationRow[] = json.items ?? [];
        for (const r of rows) {
          upsert(r);
          if (r.type === "new_message")
            deliveryAck.enqueueFromNotification(r.message_id as any);
        }
        deliveryAck.flush();
      } catch (e) {
        toastError(e, {
          title: "No se pudieron sincronizar notificaciones",
          fallback: "Reintentaremos automáticamente.",
        });
      }
    };

    primeLocal().catch(() => {});

    const dispose = connectWithBackoff({
      channelName: `notifications-${useNotificationsStore.getState().selfAuthId ?? "anon"}`,
      onSetup: (ch) => {
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications" },
          (p: any) => {
            if (cancelled) return;
            const evt = p.eventType as "INSERT" | "UPDATE" | "DELETE";
            const row = (evt === "DELETE" ? p.old : p.new) as NotificationRow;
            const uid = useNotificationsStore.getState().selfAuthId;
            if (!row || row.user_id !== uid) return;

            upsert(row);

            if (evt === "INSERT") {
              if (row.type === "new_message") {
                deliveryAck.enqueueFromNotification(row.message_id as any);
                deliveryAck.flush();
              }
              const pres = presentNotification(row);
              const createdAt = row.created_at
                ? new Date(row.created_at)
                : new Date();
              push({
                title: pres.title,
                timeAgo: format(createdAt, "es"),
                description: pres.description,
                variant: pres.variant,
                actionLabel: pres.actionLabel,
                thumbUrl: pres.thumbUrl,
                onAction: () => {
                  try {
                    if (!pres.deeplink) return;
                    const url = new URL(window.location.href);
                    const [base] = url.href.split("?");
                    window.history.pushState({}, "", `${base}${pres.deeplink}`);
                  } catch (e) {
                    toastError(e, {
                      title: "No se pudo abrir el enlace",
                      fallback: "Copia/pega el enlace manualmente.",
                    });
                  }
                },
              });
            }
          },
        );
      },
      onCatchUp: catchUp,
    });

    const vis = () => deliveryAck.onVisibilityOrOnline();
    const onl = () => deliveryAck.onVisibilityOrOnline();
    window.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    window.addEventListener("online", onl);

    return () => {
      cancelled = true;
      window.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", vis);
      window.removeEventListener("online", onl);
      dispose();
      deliveryAck.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    opts?.initial,
    opts?.limit,
    opts?.prefetchFromApi,
    hydrate,
    upsert,
    setSelfAuthId,
  ]);
}
