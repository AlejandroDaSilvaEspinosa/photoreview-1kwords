"use client";

import { useEffect } from "react";
import { useStatusesStore } from "@/stores/statuses";
import type { ImageStatusRow, SkuStatusRow } from "@/stores/statuses";
import { toastError } from "@/hooks/useToast";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { connectWithBackoff } from "@/lib/realtime/channel";

export function useWireAllStatusesRealtime() {
  const upSku = useStatusesStore((s) => s.upsertSku);
  const upImg = useStatusesStore((s) => s.upsertImage);

  useEffect(() => {
    const sb = supabaseBrowser();

    const catchUp = async () => {
      try {
        const { data: skuSt, error: e1 } = await sb
          .from("review_skus_status")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(300);
        if (e1) throw e1;
        (skuSt || []).forEach((r: any) => upSku(r as SkuStatusRow));

        const { data: imgSt, error: e2 } = await sb
          .from("review_images_status")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(1000);
        if (e2) throw e2;
        (imgSt || []).forEach((r: any) => upImg(r as ImageStatusRow));
      } catch (e) {
        toastError(e, { title: "Fallo obteniendo últimas actualizaciones de estado" });
      }
    };

    const dispose = connectWithBackoff({
      channelName: "all-statuses",
      onSetup: (ch) => {
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "review_skus_status" },
          (p) => {
            const row = ((p as any).eventType === "DELETE" ? (p as any).old : (p as any).new) as SkuStatusRow | null;
            if (row) upSku(row);
          }
        );
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "review_images_status" },
          (p) => {
            const row = ((p as any).eventType === "DELETE" ? (p as any).old : (p as any).new) as ImageStatusRow | null;
            if (row) upImg(row);
          }
        );
      },
      onCatchUp: catchUp,
    });

    return dispose;
  }, [upSku, upImg]);
}
