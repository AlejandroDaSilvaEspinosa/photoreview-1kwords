"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import type { SkuStatus, ImageStatus } from "@/types/review";

export type SkuStatusRow = {
  sku: string;
  status: SkuStatus;
  images_total: number | null;
  images_needing_fix: number | null;
  updated_at: string;
};

export type ImageStatusRow = {
  sku: string;
  image_name: string;
  status: ImageStatus;
  updated_at: string;
};

// Mapas en memoria
type MapBySku = Record<string, SkuStatusRow>;
type MapByImage = Record<string, ImageStatusRow>; // key: `${sku}|${image_name}`

type Handlers = {
  onSkuStatusUpsert?: (
    row: SkuStatusRow,
    evt: "INSERT" | "UPDATE" | "DELETE"
  ) => void;
  onImageStatusUpsert?: (
    row: ImageStatusRow,
    evt: "INSERT" | "UPDATE" | "DELETE"
  ) => void;
  onStatusChange?: (
    status: "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR" | "TIMED_OUT"
  ) => void;
};

/**
 * Carga y escucha en realtime los estados agregados de SKUs e imágenes
 * para un conjunto de skuIds. Expone handlers al estilo useSkuChannel.
 */
export function useSkusStatus(skuIds: string[], handlers?: Handlers) {
  const [bySku, setBySku] = useState<MapBySku>({});
  const [byImage, setByImage] = useState<MapByImage>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // refs estables
  const idsRef = useRef<Set<string>>(new Set(skuIds));
  useEffect(() => {
    idsRef.current = new Set(skuIds);
  }, [skuIds.join("|")]);

  const hRef = useRef<Handlers>(handlers ?? {});
  useEffect(() => {
    hRef.current = handlers ?? {};
  }, [handlers]);

  // -------- Precarga inicial --------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sb = supabaseBrowser();

        if (skuIds.length === 0) {
          if (!cancelled) {
            setBySku({});
            setByImage({});
          }
          return;
        }

        const [skusRes, imgsRes] = await Promise.all([
          sb.from("review_skus_status")
            .select("sku,status,images_total,images_needing_fix,updated_at")
            .in("sku", skuIds),
          sb.from("review_images_status")
            .select("sku,image_name,status,updated_at")
            .in("sku", skuIds),
        ]);

        if (skusRes.error) throw skusRes.error;
        if (imgsRes.error) throw imgsRes.error;
        if (cancelled) return;

        const mSku: MapBySku = {};
        (skusRes.data || []).forEach((row: any) => {
          mSku[row.sku] = row as SkuStatusRow;
        });

        const mImg: MapByImage = {};
        (imgsRes.data || []).forEach((row: any) => {
          const r = row as ImageStatusRow;
          mImg[`${r.sku}|${r.image_name}`] = r;
        });

        setBySku(mSku);
        setByImage(mImg);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Error cargando estados");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [skuIds.join("|")]);

  // -------- Realtime --------
  useEffect(() => {
    const sb = supabaseBrowser();

    // Un único canal para ambos feeds
    const channel = sb.channel("skus-status-feed", {
      config: { broadcast: { ack: true } },
    });

    // SKUs
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_skus_status" },
      (payload) => {
        const evt = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const row =
          (evt === "DELETE"
            ? (payload.old as SkuStatusRow)
            : (payload.new as SkuStatusRow)) || (payload.new as SkuStatusRow);
        if (!row) return;
        if (!idsRef.current.has(row.sku)) return;

        setBySku((prev) => {
          const next = { ...prev };
          if (evt === "DELETE") delete next[row.sku];
          else next[row.sku] = row;
          return next;
        });
        hRef.current.onSkuStatusUpsert?.(row, evt);
      }
    );

    // Imágenes
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_images_status" },
      (payload) => {
        const evt = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const row =
          (evt === "DELETE"
            ? (payload.old as ImageStatusRow)
            : (payload.new as ImageStatusRow)) || (payload.new as ImageStatusRow);
        if (!row) return;
        if (!idsRef.current.has(row.sku)) return;

        const key = `${row.sku}|${row.image_name}`;
        setByImage((prev) => {
          const next = { ...prev };
          if (evt === "DELETE") delete next[key];
          else next[key] = row;
          return next;
        });
        hRef.current.onImageStatusUpsert?.(row, evt);
      }
    );

    channel.subscribe((status) => {
      hRef.current.onStatusChange?.(status as any);
    });

    return () => {
      sb.removeChannel(channel);
    };
  }, []);

  // -------- Helpers --------
  const getSkuStatus = (sku: string): SkuStatus | undefined =>
    bySku[sku]?.status;

  const getImageStatus = (sku: string, imageName: string): ImageStatus | undefined =>
    byImage[`${sku}|${imageName}`]?.status;

  const imagesBySku = useMemo(() => {
    const acc: Record<string, ImageStatusRow[]> = {};
    for (const key of Object.keys(byImage)) {
      const [sku, image_name] = key.split("|");
      const row = byImage[key];
      (acc[sku] ||= []).push(row);
    }
    return acc;
  }, [byImage]);

  return {
    bySku,
    byImage,
    getSkuStatus,
    getImageStatus,
    imagesBySku,
    loading,
    error,
  };
}
