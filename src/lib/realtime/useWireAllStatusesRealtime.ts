// src/lib/realtime/useWireAllStatusesRealtime.ts
"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useStatusesStore } from "@/stores/statuses";
import type { ImageStatusRow, SkuStatusRow } from "@/stores/statuses";

export function useWireAllStatusesRealtime() {
  const upSku = useStatusesStore((s) => s.upsertSku);
  const upImg = useStatusesStore((s) => s.upsertImage);

  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel("all-statuses", { config: { broadcast: { ack: true } } });

    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_skus_status" },
      (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as SkuStatusRow | null;
        if (!row) return;
        upSku(row);
      }
    );

    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_images_status" },
      (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as ImageStatusRow | null;
        if (!row) return;
        upImg(row);
      }
    );

    ch.subscribe();
    return () => { sb.removeChannel(ch); };
  }, [upSku, upImg]);
}
