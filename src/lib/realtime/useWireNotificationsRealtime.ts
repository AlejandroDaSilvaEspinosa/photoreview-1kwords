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
import { connectWithBackoff } from "@/lib/realtime/channel";
import {
  enqueueDelivered,
  pokeReceiptsFlushSoon,
} from "@/lib/net/receiptsOutbox";

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

      if (!uid) return;

      // 1) Cache local
      const cached = notificationsCache.load();
      if (cached) {
        hydrate(cached.rows, cached.unseen);
        // Para nuevas notificaciones de mensajes, encola "delivered" batched
        const msgIds = cached.rows
          .filter((r) => r.type === "new_message" && r.message_id)
          .map((r) => Number(r.message_id));
        if (msgIds.length) {
          enqueueDelivered(msgIds);
          pokeReceiptsFlushSoon();
        }
      }

      // 2) Inicial del SSR / prop
      if (opts?.initial) {
        hydrate(opts.initial.items || [], opts.initial.unseen ?? undefined);
        const msgIds = (opts.initial.items || [])
          .filter((r) => r.type === "new_message" && r.message_id)
          .map((r) => Number(r.message_id));
        if (msgIds.length) {
          enqueueDelivered(msgIds);
          pokeReceiptsFlushSoon();
        }
      } else if (opts?.prefetchFromApi !== false) {
        // 3) Prefetch desde API
        try {
          const res = await fetch(
            `/api/notifications?limit=${opts?.limit ?? 30}`,
            { cache: "no-store" }
          );
          if (!cancelled && res.ok) {
            const json = await res.json();
            const rows: NotificationRow[] = json.items || [];
            hydrate(rows, json.unseen ?? undefined);
            const msgIds = rows
              .filter((r) => r.type === "new_message" && r.message_id)
              .map((r) => Number(r.message_id));
            if (msgIds.length) {
              enqueueDelivered(msgIds);
              pokeReceiptsFlushSoon();
            }
          }
        } catch (e) {
          if (!cancelled)
            toastError(e, { title: "Fallo cargando notificaciones" });
        }
      }
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
            "Respuesta no válida del servidor de notificaciones."
          );
        const json = await res.json();
        const rows: NotificationRow[] = json.items ?? [];
        for (const r of rows) {
          upsert(r);
        }
        // Encola delivered de los "new_message" que hayan llegado en catch-up
        const msgIds = rows
          .filter((r) => r.type === "new_message" && r.message_id)
          .map((r) => Number(r.message_id));
        if (msgIds.length) {
          enqueueDelivered(msgIds);
          pokeReceiptsFlushSoon();
        }
      } catch (e) {
        toastError(e, {
          title: "No se pudieron sincronizar notificaciones",
          fallback: "Reintentaremos automáticamente.",
        });
      }
    };

    // Prime (no bloquea la suscripción; el outbox está debounced)
    primeLocal().catch(() => {});

    const dispose = connectWithBackoff({
      channelName: `notifications-${
        useNotificationsStore.getState().selfAuthId ?? "anon"
      }`,
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
              if (row.type === "new_message" && row.message_id) {
                // Encola delivered (batched) y provoca flush pronto
                enqueueDelivered([Number(row.message_id)]);
                pokeReceiptsFlushSoon();
              }
              // Toast UI
              const pres = presentNotification(row);
              const createdAt = row.created_at
                ? new Date(row.created_at)
                : new Date();
              let mill = createdAt.getMilliseconds(); // Get millisecond value from date
              //evitar desfase
              mill -= 1000; // Add your one millisecond to it
              createdAt.setMilliseconds(mill); // convert millisecond to again date object
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
          }
        );
      },
      onCatchUp: catchUp,
    });

    const vis = () => pokeReceiptsFlushSoon();
    const onl = () => pokeReceiptsFlushSoon();
    window.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    window.addEventListener("online", onl);

    return () => {
      cancelled = true;
      window.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", vis);
      window.removeEventListener("online", onl);
      dispose();
      // No hay reset necesario: el outbox se autogestiona
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
