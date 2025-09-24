// src/lib/realtime/useWireAllStatusesRealtime.ts
"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useStatusesStore } from "@/stores/statuses";
import type { ImageStatusRow, SkuStatusRow } from "@/stores/statuses";
import { toastError } from "@/hooks/useToast";

export function useWireAllStatusesRealtime() {
  const upSku = useStatusesStore((s) => s.upsertSku);
  const upImg = useStatusesStore((s) => s.upsertImage);

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

    const catchUp = async () => {
      if (cancelled) return;
      try {
        // Últimos N estados globales (si manejas muchos, ajusta límites)
        const { data: skuSt } = await sb
          .from("review_skus_status")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(300);
        for (const r of (skuSt || []) as SkuStatusRow[]) upSku(r);

        const { data: imgSt } = await sb
          .from("review_images_status")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(1000);
        for (const r of (imgSt || []) as ImageStatusRow[]) upImg(r);
      }
      catch (e) {
        toastError(e, { title: "Fallo obteniendo ultimas actualizaciones de estado de skus"});
      }      
    };

    const connect = async () => {
      subscribed = false;

      // Evita canales duplicados
      const channelName = "all-statuses";
      for (const c of sb.getChannels()) {        
        if (c.topic === channelName) sb.removeChannel(c);
      }

      ch = sb.channel(channelName);

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_skus_status" },
        (p) => {
          if (cancelled) return;
          const row = (p.eventType === "DELETE" ? p.old : p.new) as SkuStatusRow | null;
          if (!row) return;
          upSku(row);
        }
      );

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_images_status" },
        (p) => {
          if (cancelled) return;
          const row = (p.eventType === "DELETE" ? p.old : p.new) as ImageStatusRow | null;
          if (!row) return;
          upImg(row);
        }
      );

      await ch.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          subscribed = true;
          clearRetry();
          retryMs = 1000;
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
  }, [upSku, upImg]);
}
