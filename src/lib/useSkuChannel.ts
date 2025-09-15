"use client";

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase";

type ThreadRow = {
  id: number;
  sku: string;
  image_name: string;
  x: number;
  y: number;
  status: "pending" | "corrected" | "reopened";
};

type MessageRow = {
  id: number;
  thread_id: number;
  text: string;
  created_at: string;
  created_by?: string | null;
  created_by_username: string | null;
  created_by_display_name: string | null;
  is_system: boolean | null;
};

type Handlers = {
  onThreadInsert?: (t: ThreadRow) => void;
  onThreadUpdate?: (t: ThreadRow) => void;
  onThreadDelete?: (t: ThreadRow) => void;
  onMessageInsert?: (m: MessageRow) => void;
  onMessageUpdate?: (m: MessageRow) => void;
  onMessageDelete?: (m: MessageRow) => void;
};

export function useSkuChannel(sku: string, handlers: Handlers) {
  // guardamos los handlers en un ref para no re-suscribir el canal cada render
  const hRef = useRef(handlers);
  useEffect(() => {
    hRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb.channel(`threads-${sku}`, {
      config: { broadcast: { ack: true } },
    });

    // THREADS
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "review_threads",
        filter: `sku=eq.${sku}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          hRef.current.onThreadInsert?.(payload.new as ThreadRow);
        } else if (payload.eventType === "UPDATE") {
          hRef.current.onThreadUpdate?.(payload.new as ThreadRow);
        } else if (payload.eventType === "DELETE") {
          hRef.current.onThreadDelete?.(payload.old as ThreadRow);
        }
      }
    );

    // MESSAGES (no filtramos por sku porque esa columna está en threads)
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "review_messages",
      },
      (payload) => {
          
        if (payload.eventType === "INSERT") {
          hRef.current.onMessageInsert?.(payload.new as MessageRow);
        } else if (payload.eventType === "UPDATE") {
          hRef.current.onMessageUpdate?.(payload.new as MessageRow);
        } else if (payload.eventType === "DELETE") {
          hRef.current.onMessageDelete?.(payload.old as MessageRow);
        }
      }
    );

    channel.subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [sku]);
}
