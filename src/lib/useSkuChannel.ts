// src/lib/useSkuChannel.ts
// Hook de canales Realtime de Supabase para un SKU:
// - Escucha review_threads (filtrado por sku)
// - Escucha review_messages (sin filtro en DB, pero descarta en cliente
//   los thread_id que no pertenecen al sku actual)
// - Limpieza robusta: removeChannel en el cleanup
// - Evita recrear handlers con useRef

"use client";

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase";

export type ThreadStatus = "pending" | "corrected" | "reopened" | "deleted";

export type ThreadRow = {
  id: number;
  sku: string;
  image_name: string;
  x: number;
  y: number;
  status: ThreadStatus;
};

export type MessageRow = {
  id: number;
  thread_id: number;
  text: string;
  created_at: string;
  created_by?: string | null;
  created_by_username: string | null;
  created_by_display_name: string | null;
  is_system: boolean | null;
};

export type Handlers = {
  // THREADS
  onThreadInsert?: (t: ThreadRow) => void;
  onThreadUpdate?: (t: ThreadRow) => void;
  onThreadDelete?: (t: ThreadRow) => void;
  // MESSAGES
  onMessageInsert?: (m: MessageRow) => void;
  onMessageUpdate?: (m: MessageRow) => void;
  onMessageDelete?: (m: MessageRow) => void;
  // Opcional: avisos de estado del canal
  onStatusChange?: (status: "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR" | "TIMED_OUT") => void;
};

/**
 * Suscribe a los cambios de `review_threads` y `review_messages` para un SKU.
 * Limpia correctamente el canal al desmontar o cambiar de SKU.
 */
export function useSkuChannel(sku: string, handlers: Handlers) {
  // Handlers estables
  const hRef = useRef<Handlers>(handlers);
  useEffect(() => {
    hRef.current = handlers;
  }, [handlers]);

  // Cache de thread_ids que pertenecen a este SKU para filtrar mensajes
  const threadIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const sb = supabaseBrowser();
    let disposed = false;

    // Inicial: precarga ids de hilos del SKU para que los mensajes
    // existentes se filtren correctamente desde el primer instante.
    (async () => {
      try {
        const { data, error } = await sb
          .from("review_threads")
          .select("id")
          .eq("sku", sku);

        if (!error && data && !disposed) {
          threadIdsRef.current = new Set<number>(data.map((r: { id: number }) => r.id));
        }
      } catch {
        // noop
      }
    })();

    // Canal único por SKU
    const channel = sb.channel(`threads-${sku}`, {
      config: { broadcast: { ack: true } },
    });

    // === THREADS (filtrados por sku) ===
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_threads", filter: `sku=eq.${sku}` },
      (payload) => {
        const { eventType } = payload;

        // En UPDATE/INSERT, payload.new está presente
        if ((eventType === "INSERT" || eventType === "UPDATE") && payload.new) {
          const row = payload.new as ThreadRow;

          // Mantén la cache de ids al día
          threadIdsRef.current.add(row.id);

          if (eventType === "INSERT") {
            hRef.current.onThreadInsert?.(row);
          } else {
            hRef.current.onThreadUpdate?.(row);
          }
          return;
        }

        // En DELETE, suele venir en payload.old (requiere REPLICA IDENTITY FULL)
        if (eventType === "DELETE") {
          const row = (payload.old as ThreadRow) || (payload.new as ThreadRow);
          if (row?.id != null) {
            threadIdsRef.current.delete(row.id);
            hRef.current.onThreadDelete?.(row);
          }
        }
      }
    );

    // === MESSAGES (no podemos filtrar por sku en DB; filtramos en cliente) ===
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_messages" },
      (payload) => {
        const { eventType } = payload;

        // Para INSERT/UPDATE la fila está en new; para DELETE normalmente en old.
        const row =
          (eventType === "DELETE" ? (payload.old as MessageRow) : (payload.new as MessageRow)) ||
          (payload.new as MessageRow) ||
          (payload.old as MessageRow);

        if (!row) return;

        // Ignora mensajes de hilos que no pertenecen a este SKU
        if (!threadIdsRef.current.has(row.thread_id)) return;

        if (eventType === "INSERT") {
          hRef.current.onMessageInsert?.(row);
        } else if (eventType === "UPDATE") {
          hRef.current.onMessageUpdate?.(row);
        } else if (eventType === "DELETE") {
          hRef.current.onMessageDelete?.(row);
        }
      }
    );

    // Suscripción con callback de estado
    channel.subscribe((status) => {
      if (disposed) return;
      hRef.current.onStatusChange?.(status as any);
    });

    // Cleanup robusto: cierra y elimina el canal del cliente
    return () => {
      disposed = true;
      sb.removeChannel(channel);
    };
  }, [sku]);
}
