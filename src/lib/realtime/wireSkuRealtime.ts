// src/lib/realtime/wireSkuRealtime.ts
"use client";

import { supabaseBrowser } from "@/lib/supabase";
import { useEffect } from "react";
import { useThreadsStore } from "@/stores/threads";
import { useMessagesStore } from "@/stores/messages";
import { useStatusesStore } from "@/stores/statuses";
import type { ThreadRow, MessageRow } from "@/lib/supabase";
import type { ImageStatusRow, SkuStatusRow } from "@/stores/statuses";

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
    const ch = sb.channel(`sku-feed-${sku}`, { config: { broadcast: { ack: true } } });

    // THREADS
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_threads", filter: `sku=eq.${sku}` },
      (p) => {
        const evt = p.eventType;
        const row = (evt === "DELETE" ? p.old : p.new) as ThreadRow;
        if (!row) return;

        if (evt === "DELETE") {
          delThread(row);
          return;
        }

        // casar con optimista por coordenadas para no cambiar el índice y mover mensajes al id real
        const tmpMap = useThreadsStore.getState().pendingByKey;
        const tempId = tmpMap.get(keyOf(row.image_name, row.x as any, row.y as any));

        upThread(row);

        if (tempId != null && tempId !== row.id) {
          useMessagesStore.getState().moveThreadMessages(tempId, row.id);
        }
      }
    );

    // MESSAGES
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_messages" },
      (p) => {
        const evt = p.eventType;
        const row = (evt === "DELETE" ? p.old : p.new) as MessageRow;
        if (!row) return;
        if (evt === "DELETE") delMsg(row);
        else upMsg(row);
      }
    );

    // IMAGE STATUS
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_images_status", filter: `sku=eq.${sku}` },
      (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as ImageStatusRow;
        if (!row) return;
        upImg(row);
      }
    );

    // SKU STATUS
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_skus_status", filter: `sku=eq.${sku}` },
      (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as SkuStatusRow;
        if (!row) return;
        upSku(row);
      }
    );

    // RECEIPTS
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_message_receipts" },
      (p) => {
        const row = (p.new || p.old) as { message_id: number; user_id: string; read_at?: string | null };
        if (!row) return;
        useMessagesStore.getState().upsertReceipt(row.message_id, row.user_id, row.read_at);
      }
    );

    ch.subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [sku, upThread, delThread, upMsg, delMsg, upSku, upImg]);
}
