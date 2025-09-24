// src/lib/realtime/wireSkuRealtime.ts
"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useThreadsStore } from "@/stores/threads";
import { useMessagesStore } from "@/stores/messages";
import { useStatusesStore } from "@/stores/statuses";
import type { ThreadRow, MessageRow } from "@/types/review";
import type { ImageStatusRow, SkuStatusRow } from "@/stores/statuses";
import { toastError } from "@/hooks/useToast";

const round3 = (n: number) => Math.round(Number(n) * 1000) / 1000;
const keyOf = (image: string, x: number, y: number) =>
  `${image}|${round3(x)}|${round3(y)}`;

export function useWireSkuRealtime(sku: string) {
  const upThread = useThreadsStore((s) => s.upsertFromRealtime);
  const delThread = useThreadsStore((s) => s.removeFromRealtime);
  const upMsg    = useMessagesStore((s) => s.upsertFromRealtime);
  const delMsg   = useMessagesStore((s) => s.removeFromRealtime);
  const upSku    = useStatusesStore((s) => s.upsertSku);
  const upImg    = useStatusesStore((s) => s.upsertImage);

  useEffect(() => {
    const sb = supabaseBrowser();

    let ch: ReturnType<typeof sb.channel> | null = null;
    let subscribed = false;
    let cancelled = false;

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
        connect().catch(() => scheduleReconnect());
        retryMs = Math.min(maxMs, retryMs * 2);
      }, retryMs) as unknown as number;
    };

    // ------- Catch-up tras reconectar / volver a foco -------
    const catchUp = async () => {
      if (cancelled) return;
      try {
        // 1) Últimos hilos del SKU
        const { data: threads } = await sb
          .from("review_threads")
          .select("*")
          .eq("sku", sku)
          .order("created_at", { ascending: false })
          .limit(200);

        if (threads?.length) {
          const pendingByKey = useThreadsStore.getState().pendingByKey;
          for (const row of threads as ThreadRow[]) {
            upThread(row);
            // re-mapear mensajes de tempId si aplica
            const tempId = pendingByKey.get(
              keyOf(row.image_name, row.x as any, row.y as any)
            );
            if (tempId != null && tempId !== row.id) {
              useMessagesStore.getState().moveThreadMessages(tempId, row.id);
            }
          }

          // 2) Mensajes recientes de esos hilos
          const ids = (threads as ThreadRow[]).map((t) => t.id).filter(Boolean);
          if (ids.length) {
            const { data: msgs } = await sb
              .from("review_messages")
              .select("*")
              .in("thread_id", ids)
              .order("created_at", { ascending: true }) // mantener orden lógico
              .limit(1000);
            for (const m of (msgs || []) as MessageRow[]) {
              upMsg(m);
            }
          }
        }

        // 3) Estados de imagen de este SKU
        const { data: imgStatus } = await sb
          .from("review_images_status")
          .select("*")
          .eq("sku", sku)
          .order("updated_at", { ascending: false })
          .limit(300);
        for (const r of (imgStatus || []) as ImageStatusRow[]) upImg(r);

        // 4) Estado del SKU
        const { data: skuStatus } = await sb
          .from("review_skus_status")
          .select("*")
          .eq("sku", sku)
          .order("updated_at", { ascending: false })
          .limit(50);
        for (const r of (skuStatus || []) as SkuStatusRow[]) upSku(r);
      } catch (e) {
          toastError(e, { title: "Fallo obteniendo ultimas actualizaciones del sku" });
        }
    };

    // ------- Conexión / suscripción -------
    const connect = async () => {
      subscribed = false;

      // Evita duplicados del mismo tópico
      const channelName = `sku-feed-${sku}`;
      for (const c of sb.getChannels()) {        
        if (c.topic === channelName) sb.removeChannel(c);
      }

      ch = sb.channel(channelName);

      // THREADS
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_threads", filter: `sku=eq.${sku}` },
        (p) => {
          if (cancelled) return;
          const evt = p.eventType as "INSERT" | "UPDATE" | "DELETE";
          const row = (evt === "DELETE" ? p.old : p.new) as ThreadRow | null;
          if (!row) return;

          if (evt === "DELETE") {
            delThread(row);
            return;
          }

          const tmpMap = useThreadsStore.getState().pendingByKey;
          const tempId = tmpMap.get(keyOf(row.image_name, row.x as any, row.y as any));

          upThread(row);

          if (tempId != null && tempId !== row.id) {
            useMessagesStore.getState().moveThreadMessages(tempId, row.id);
          }
        }
      );

      // MESSAGES (no filtramos por SKU aquí por si tu esquema no lo incluye en messages)
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_messages" },
        async (p) => {
          if (cancelled) return;
          const evt = p.eventType as "INSERT" | "UPDATE" | "DELETE";
          const row = (evt === "DELETE" ? p.old : p.new) as MessageRow | null;
          if (!row) return;

          if (evt === "DELETE") {
            delMsg(row);
            return;
          }

          upMsg(row);

          // delivered/read automáticos para mensajes que recibo
          if (evt === "INSERT") {
            const isSystem = !!(row as any).is_system;
            if (!isSystem && row.id != null) {
              const selfId = useMessagesStore.getState().selfAuthId;
              if (row.created_by !== selfId) {
                try {
                  await fetch("/api/messages/receipts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messageIds: [row.id], mark: "delivered" }),
                  });

                  const activeId = useThreadsStore.getState().activeThreadId;
                  if (activeId === row.thread_id) {
                    await fetch("/api/messages/receipts", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ messageIds: [row.id], mark: "read" }),
                    });
                  }
                } 
                catch (e) {
                  toastError(e, { title: "Fallo enviando confirmación de lectura de mensaje" });
                }
              }
            }
          }
        }
      );

      // IMAGE STATUS
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_images_status", filter: `sku=eq.${sku}` },
        (p) => {
          if (cancelled) return;
          const row = (p.eventType === "DELETE" ? p.old : p.new) as ImageStatusRow | null;
          if (!row) return;
          upImg(row);
        }
      );

      // SKU STATUS
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_skus_status", filter: `sku=eq.${sku}` },
        (p) => {
          if (cancelled) return;
          const row = (p.eventType === "DELETE" ? p.old : p.new) as SkuStatusRow | null;
          if (!row) return;
          upSku(row);
        }
      );

      // RECEIPTS (si necesitas catch-up de receipts, se podría añadir después)
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_message_receipts" },
        (p) => {
          if (cancelled) return;
          const merged = { ...(p.old as any), ...(p.new as any) } as {
            message_id?: number;
            user_id?: string;
            read_at?: string | null;
          };
          if (!merged.message_id || !merged.user_id) return;
          useMessagesStore
            .getState()
            .upsertReceipt(merged.message_id, merged.user_id, merged.read_at ?? null);
        }
      );

      await ch.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          subscribed = true;
          clearRetry();
          retryMs = 1000;
          // al suscribir, sincroniza por si nos perdimos algo
          catchUp();
        } else if (
          status === "CLOSED" ||
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT"
        ) {
          subscribed = false;
          scheduleReconnect();
        }
      });
    };

    // Reintentos al volver a foco/online
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!subscribed) connect();
      else catchUp();
    };
    const onOnline = () => {
      if (!subscribed) connect();
      else catchUp();
    };

    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("online", onOnline);

    connect();

    return () => {
      cancelled = true;
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("online", onOnline);
      clearRetry();
      if (ch) sb.removeChannel(ch);
    };
  }, [sku, upThread, delThread, upMsg, delMsg, upSku, upImg]);
}
