// Hook de canales Realtime de Supabase para un SKU:
// - review_threads (filtrado por sku)
// - review_messages (filtrado en cliente por thread_id)
// - review_images_status (filtrado por sku)  <-- NUEVO
// - review_skus_status   (filtrado por sku)  <-- NUEVO

"use client";

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type {ThreadRow,MessageRow,ImageStatusRow,SkuStatusRow } from "@/types/review";

export type Handlers = {
  // THREADS
  onThreadInsert?: (t: ThreadRow) => void;
  onThreadUpdate?: (t: ThreadRow) => void;
  onThreadDelete?: (t: ThreadRow) => void;
  // MESSAGES
  onMessageInsert?: (m: MessageRow) => void;
  onMessageUpdate?: (m: MessageRow) => void;
  onMessageDelete?: (m: MessageRow) => void;
  //  Estados agregados en BD
  onImageStatusUpsert?: (row: ImageStatusRow) => void;
  onSkuStatusUpsert?: (row: SkuStatusRow) => void;
  // Opcional: avisos de estado del canal
  onStatusChange?: (
    status: "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR" | "TIMED_OUT"
  ) => void;
};

/**
 * Suscribe a cambios de threads, messages, image-status y sku-status
 * para un SKU. Limpieza robusta del canal.
 */
export function useSkuChannel(sku: string, handlers: Handlers) {
  // Handlers estables
  const hRef = useRef<Handlers>(handlers);
  useEffect(() => {
    hRef.current = handlers;
  }, [handlers]);

  // Cache de thread_ids que pertenecen a este SKU para filtrar messages
  const threadIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const sb = supabaseBrowser();
    let disposed = false;

    // Precarga ids de hilos del SKU
    (async () => {
      try {
        const { data, error } = await sb
          .from("review_threads")
          .select("id")
          .eq("sku", sku);

        if (!error && data && !disposed) {
          threadIdsRef.current = new Set<number>(
            data.map((r: { id: number }) => r.id)
          );
        }
      } catch {
        /* noop */
      }
    })();

    // Canal único por SKU
    const channel = sb.channel(`threads-${sku}`, {
      config: { broadcast: { ack: true } },
    });

    // === THREADS (filtrados por sku) ===
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "review_threads",
        filter: `sku=eq.${sku}`,
      },
      (payload) => {
        const { eventType } = payload;

        if ((eventType === "INSERT" || eventType === "UPDATE") && payload.new) {
          const row = payload.new as ThreadRow;
          threadIdsRef.current.add(row.id);
          if (eventType === "INSERT") {
            hRef.current.onThreadInsert?.(row);
          } else {
            hRef.current.onThreadUpdate?.(row);
          }
          return;
        }

        if (eventType === "DELETE") {
          const row = (payload.old as ThreadRow) || (payload.new as ThreadRow);
          if (row?.id != null) {
            threadIdsRef.current.delete(row.id);
            hRef.current.onThreadDelete?.(row);
          }
        }
      }
    );

    // === MESSAGES (filtrado en cliente por thread_id) ===
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_messages" },
      (payload) => {
        const { eventType } = payload;
        const row =
          (eventType === "DELETE"
            ? (payload.old as MessageRow)
            : (payload.new as MessageRow)) ||
          (payload.new as MessageRow) ||
          (payload.old as MessageRow);

        if (!row) return;
        if (!threadIdsRef.current.has(row.thread_id)) return;

        if (eventType === "INSERT") hRef.current.onMessageInsert?.(row);
        else if (eventType === "UPDATE") hRef.current.onMessageUpdate?.(row);
        else if (eventType === "DELETE") hRef.current.onMessageDelete?.(row);
      }
    );

    // === review_images_status (filtrado por sku) ===
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "review_images_status",
      },
      (payload) => {
        // Normalmente solo INSERT/UPDATE; si hay DELETE lo ignoramos o lo tratamos como "pending_review"
        const row =
          (payload.eventType === "DELETE"
            ? (payload.old as ImageStatusRow)
            : (payload.new as ImageStatusRow)) || (payload.new as ImageStatusRow);
        if (!row) return;
        hRef.current.onImageStatusUpsert?.({
          sku: row.sku,
          image_name: (row as any).image_name,
          status: (row as any).status,
          updated_at: (row as any).updated_at,
        });
      }
    );

    // === review_skus_status (filtrado por sku) ===
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "review_skus_status",
      },
      (payload) => {
        const row =
          (payload.eventType === "DELETE"
            ? (payload.old as SkuStatusRow)
            : (payload.new as SkuStatusRow)) || (payload.new as SkuStatusRow);
        if (!row) return;
        hRef.current.onSkuStatusUpsert?.({
          sku: row.sku,
          status: (row as any).status,
          images_total: (row as any).images_total ?? null,
          images_needing_fix: (row as any).images_needing_fix ?? null,
          updated_at: (row as any).updated_at,
        });
      }
    );

    // Suscripción con callback de estado
    channel.subscribe((status) => {
      if (disposed) return;
      hRef.current.onStatusChange?.(status as any);
    });

    // Cleanup robusto
    return () => {
      disposed = true;
      sb.removeChannel(channel);
    };
  }, [sku]);
}
