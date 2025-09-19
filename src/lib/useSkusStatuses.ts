"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import type { SkuStatus } from "@/types/review";

export type SkuStatusRow = {
  sku: string;
  status: SkuStatus;
  images_total: number | null;
  images_needing_fix: number | null;
  updated_at: string;
};

type MapBySku = Record<string, SkuStatusRow>;

export function useSkusStatuses(skuIds: string[]) {
  const [bySku, setBySku] = useState<MapBySku>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const idsRef = useRef<Set<string>>(new Set(skuIds));
  useEffect(() => { idsRef.current = new Set(skuIds); }, [skuIds]);

  // Precarga
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sb = supabaseBrowser();
        if (skuIds.length === 0) {
          setBySku({});
          return;
        }
        const { data, error } = await sb
          .from("review_skus_status")
          .select("sku,status,images_total,images_needing_fix,updated_at")
          .in("sku", skuIds);

        if (error) throw error;
        if (cancelled) return;

        const map: MapBySku = {};
        (data || []).forEach((row: any) => { map[row.sku] = row as SkuStatusRow; });
        setBySku(map);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Error cargando estados");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [skuIds.join("|")]); // join para dependencia estable

  // Realtime (escuchamos toda la tabla y filtramos en cliente por rendimiento/compatibilidad)
  useEffect(() => {
    const sb = supabaseBrowser();
    let disposed = false;

    const channel = sb.channel("skus-status-index", { config: { broadcast: { ack: true } } });

    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_skus_status" },
      (payload) => {
        const row =
          (payload.eventType === "DELETE" ? (payload.old as SkuStatusRow) : (payload.new as SkuStatusRow)) ||
          (payload.new as SkuStatusRow);
        if (!row) return;
        if (!idsRef.current.has(row.sku)) return;

        setBySku((prev) => {
          const next = { ...prev };
          if (payload.eventType === "DELETE") delete next[row.sku];
          else next[row.sku] = row;
          return next;
        });
      }
    );

    channel.subscribe();
    return () => { disposed = true; sb.removeChannel(channel); };
  }, []);

  // acceso cómodo
  const getStatusFor = (sku: string): SkuStatus | undefined => bySku[sku]?.status;

  return { bySku, getStatusFor, loading, error };
}
