"use client";

import { supabaseBrowser } from "@/lib/supabase/browser";
import { useEffect } from "react";
import { useThreadsStore } from "@/stores/threads";
import { useMessagesStore } from "@/stores/messages";
import { useStatusesStore } from "@/stores/statuses";
import type { ThreadRow, MessageRow } from "@/types/review";
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
      async (p) => {
        const evt = p.eventType;
        const row = (evt === "DELETE" ? p.old : p.new) as MessageRow;
        if (!row) return;

        if (evt === "DELETE") {
          delMsg(row);
          return;
        }

        upMsg(row);

        // Marca DELIVERED siempre que no sea del sistema.
        if (evt === "INSERT") {
          const isSystem = !!(row as any).is_system;
          if (!isSystem && row.id != null) {
            try {
              await fetch("/api/messages/receipts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messageIds: [row.id], mark: "delivered" }),
              });
            } catch {}
          }
        }
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

    // RECEIPTS (delivered/read) → merge old+new para UPDATE
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_message_receipts" },
      (p) => {
        console.log("received")
        console.log(p)
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

    ch.subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [sku, upThread, delThread, upMsg, delMsg, upSku, upImg]);
}
