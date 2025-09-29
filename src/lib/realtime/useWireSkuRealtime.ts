"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useThreadsStore } from "@/stores/threads";
import { useMessagesStore } from "@/stores/messages";
import { useStatusesStore } from "@/stores/statuses";
import type { ThreadRow, MessageRow } from "@/types/review";
import type { ImageStatusRow, SkuStatusRow } from "@/stores/statuses";
import { toastError } from "@/hooks/useToast";
import { connectWithBackoff } from "@/lib/realtime/channel";

/**
 * Realtime por SKU:
 * - Threads/messages/statuses en vivo.
 * - SOLO marca delivered automáticamente (nunca read).
 * - Emite "rev:thread-live" si entra un mensaje por realtime para ese hilo (ascenso cache→live).
 */

const round3 = (n: number) => Math.round(Number(n) * 1000) / 1000;
const keyOf = (image: string, x: number, y: number) =>
  `${image}|${round3(x)}|${round3(y)}`;

export function useWireSkuRealtime(sku: string) {
  const upThread = useThreadsStore((s) => s.upsertFromRealtime);
  const delThread = useThreadsStore((s) => s.removeFromRealtime);
  const upMsg = useMessagesStore((s) => s.upsertFromRealtime);
  const delMsg = useMessagesStore((s) => s.removeFromRealtime);
  const upSku = useStatusesStore((s) => s.upsertSku);
  const upImg = useStatusesStore((s) => s.upsertImage);

  useEffect(() => {
    const sb = supabaseBrowser();

    const catchUp = async () => {
      try {
        // Threads recientes del SKU
        const { data: threads, error: e1 } = await sb
          .from("review_threads")
          .select("*")
          .eq("sku", sku)
          .order("created_at", { ascending: false })
          .limit(200);
        if (e1) throw e1;

        const pendingByKey = useThreadsStore.getState().pendingByKey;
        for (const row of (threads || []) as ThreadRow[]) {
          upThread(row);
          const tempId = pendingByKey.get(
            keyOf(row.image_name, row.x as any, row.y as any)
          );
          if (tempId != null && tempId !== row.id) {
            useMessagesStore.getState().moveThreadMessages(tempId, row.id);
          }
        }

        const ids = (threads || []).map((t: any) => t.id).filter(Boolean);
        if (ids.length) {
          const { data: msgs, error: e2 } = await sb
            .from("review_messages")
            .select("*")
            .in("thread_id", ids)
            .order("created_at", { ascending: true })
            .limit(1000);
          if (e2) throw e2;
          for (const m of (msgs || []) as MessageRow[]) upMsg(m);
        }

        // Estados imagen
        const { data: imgStatus, error: e3 } = await sb
          .from("review_images_status")
          .select("*")
          .eq("sku", sku)
          .order("updated_at", { ascending: false })
          .limit(300);
        if (e3) throw e3;
        for (const r of (imgStatus || []) as ImageStatusRow[]) upImg(r);

        // Estado SKU
        const { data: skuStatus, error: e4 } = await sb
          .from("review_skus_status")
          .select("*")
          .eq("sku", sku)
          .order("updated_at", { ascending: false })
          .limit(50);
        if (e4) throw e4;
        for (const r of (skuStatus || []) as SkuStatusRow[]) upSku(r);
      } catch (e) {
        toastError(e, {
          title: "Fallo obteniendo últimas actualizaciones del SKU",
        });
      }
    };

    const dispose = connectWithBackoff({
      channelName: `sku-feed-${sku}`,
      onSetup: (ch) => {
        // THREADS
        ch.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "review_threads",
            filter: `sku=eq.${sku}`,
          },
          (p) => {
            const evt = (p as any).eventType as "INSERT" | "UPDATE" | "DELETE";
            const row = (
              evt === "DELETE" ? (p as any).old : (p as any).new
            ) as ThreadRow | null;
            if (!row) return;

            if (evt === "DELETE") {
              delThread(row);
              return;
            }

            const tmpMap = useThreadsStore.getState().pendingByKey;
            const tempId = tmpMap.get(
              keyOf(row.image_name, row.x as any, row.y as any)
            );
            upThread(row);
            if (tempId != null && tempId !== row.id) {
              useMessagesStore.getState().moveThreadMessages(tempId, row.id);
            }
          }
        );

        // MESSAGES (global table)
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "review_messages" },
          async (p) => {
            const evt = (p as any).eventType as "INSERT" | "UPDATE" | "DELETE";
            const row = (
              evt === "DELETE" ? (p as any).old : (p as any).new
            ) as MessageRow | null;
            if (!row) return;

            if (evt === "DELETE") {
              delMsg(row);
              return;
            }

            upMsg(row);

            // Si llega un INSERT por realtime para este hilo, ascender a live (para divisor correcto).
            if (evt === "INSERT" && row.thread_id != null) {
              window.dispatchEvent(
                new CustomEvent("rev:thread-live", {
                  detail: { tid: row.thread_id },
                })
              );
            }

            // delivered automático (nunca read aquí)
            if (evt === "INSERT") {
              const isSystem = !!(row as any).is_system;
              if (!isSystem && row.id != null) {
                const selfId = useMessagesStore.getState().selfAuthId;
                if (row.created_by !== selfId) {
                  try {
                    await fetch("/api/messages/receipts", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        messageIds: [row.id],
                        mark: "delivered",
                      }),
                    });

                    const activeId = useThreadsStore.getState().activeThreadId;
                    if (activeId === row.thread_id) {
                      await fetch("/api/messages/receipts", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          messageIds: [row.id],
                          mark: "read",
                        }),
                      });
                    }
                  } catch (e) {
                    toastError(e, {
                      title: "Fallo enviando confirmación de lectura",
                    });
                  }
                }
              }
            }
          }
        );

        // IMAGE STATUS
        ch.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "review_images_status",
            filter: `sku=eq.${sku}`,
          },
          (p) => {
            const row = (
              (p as any).eventType === "DELETE"
                ? (p as any).old
                : (p as any).new
            ) as ImageStatusRow | null;
            if (row) upImg(row);
          }
        );

        // SKU STATUS
        ch.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "review_skus_status",
            filter: `sku=eq.${sku}`,
          },
          (p) => {
            const row = (
              (p as any).eventType === "DELETE"
                ? (p as any).old
                : (p as any).new
            ) as SkuStatusRow | null;
            if (row) upSku(row);
          }
        );

        // RECEIPTS → actualiza delivery local (read/delivered) al llegar por realtime
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "review_message_receipts" },
          (p) => {
            const merged = { ...(p as any).old, ...(p as any).new } as {
              message_id?: number;
              user_id?: string;
              read_at?: string | null;
            };
            if (!merged.message_id || !merged.user_id) return;
            useMessagesStore
              .getState()
              .upsertReceipt(
                merged.message_id,
                merged.user_id,
                merged.read_at ?? null
              );
          }
        );
      },
      onCatchUp: catchUp,
    });

    return dispose;
  }, [sku, upThread, delThread, upMsg, delMsg, upSku, upImg]);
}
