// src/hooks/useHomeOverview.ts
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { SkuWithImagesAndStatus, ThreadStatus } from "@/types/review";
import { toastError } from "@/hooks/useToast";

type CountableStatus = Exclude<ThreadStatus, "deleted">;

export type ImageStats = { total: number } & Record<CountableStatus, number>;
export type StatsBySku = Record<string, Record<string, ImageStats>>;
export type UnreadBySku = Record<string, boolean>;

const emptyStats = (): ImageStats => ({
  total: 0,
  pending: 0,
  corrected: 0,
  reopened: 0,
});

const isCountable = (s: unknown): s is CountableStatus =>
  s === "pending" || s === "corrected" || s === "reopened";

export function useHomeOverview(skus: SkuWithImagesAndStatus[]) {
  const skuList = useMemo(
    () => (skus?.length ? skus.map((s) => s.sku) : []),
    [skus]
  );

  // Un único cliente por hook
  const sb = useMemo(() => supabaseBrowser(), []);

  const [stats, setStats] = useState<StatsBySku>({});
  const [unread, setUnread] = useState<UnreadBySku>({});
  const [selfId, setSelfId] = useState<string | null>(null);

  // Cache local para evitar N+1 lookups
  const msgSkuCache = useRef<Map<number, string>>(new Map());

  // --- auth uid ---
  useEffect(() => {
    let cancelled = false;
    sb.auth
      .getUser()
      .then(({ data }) => !cancelled && setSelfId(data.user?.id ?? null))
      .catch((e) => toastError(e, { title: "No se pudo recuperar la sesión" }));
    return () => {
      cancelled = true;
    };
  }, [sb]);

  // --- carga inicial: estadísticas por imagen ---
  useEffect(() => {
    if (!skuList.length) return;
    let alive = true;

    (async () => {
      try {
        const { data, error } = await sb
          .from("review_threads")
          .select("sku,image_name,status")
          .in("sku", skuList as string[])
          .neq("status", "deleted");

        if (!alive) return;
        if (error) throw error;

        const map: StatsBySku = {};
        for (const r of (data ?? []) as {
          sku: string;
          image_name: string;
          status: ThreadStatus;
        }[]) {
          if (!r?.sku || !r.image_name || !isCountable(r.status)) continue;
          const byImg = (map[r.sku] ||= {});
          const st = (byImg[r.image_name] ||= emptyStats());
          st[r.status] = (st[r.status] ?? 0) + 1;
          st.total += 1;
        }
        setStats(map);
      } catch (e) {
        toastError(e, { title: "No se pudieron cargar los resúmenes" });
      }
    })();

    return () => {
      alive = false;
    };
  }, [sb, skuList]);

  // --- carga inicial: no leídos por SKU (RPC server-side) ---
  useEffect(() => {
    if (!skuList.length || !selfId) return;
    let alive = true;

    (async () => {
      try {
        const { data, error } = await sb.rpc("unread_by_sku", {
          p_user_id: selfId,
          p_skus: skuList as string[],
        });

        if (!alive) return;
        if (error) throw error;

        const next: UnreadBySku = {};
        for (const row of (data ?? []) as {
          sku: string;
          unread_count: number;
        }[]) {
          next[row.sku] = (row.unread_count ?? 0) > 0;
        }
        setUnread(next);
      } catch (e) {
        toastError(e, {
          title: "No se pudieron cargar los mensajes no leídos",
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [sb, skuList, selfId]);

  // --- realtime: threads + receipts + mensajes ---
  useEffect(() => {
    if (!skuList.length) return;

    const ch = sb.channel("home-overview", {
      config: { broadcast: { ack: true } },
    });

    // THREADS → actualizar barras por imagen (inmutable)
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_threads" },
      (p) => {
        try {
          const evt = p.eventType;
          const row = (evt === "DELETE" ? (p as any).old : (p as any).new) as {
            sku?: string;
            image_name?: string;
            status?: ThreadStatus;
          } | null;

          if (!row?.sku || !row.image_name || !skuList.includes(row.sku))
            return;

          setStats((prev) => {
            const next: StatsBySku = { ...prev };
            const prevByImg = next[row.sku!] ?? {};
            const byImg: Record<string, ImageStats> = { ...prevByImg };
            const prevSt = byImg[row.image_name!] ?? emptyStats();
            const st: ImageStats = { ...prevSt };

            if (evt === "INSERT") {
              if (isCountable(row.status)) {
                st[row.status] = (st[row.status] ?? 0) + 1;
                st.total = (st.total ?? 0) + 1;
              }
            } else if (evt === "UPDATE") {
              const oldStatus = (p as any).old?.status as
                | ThreadStatus
                | undefined;
              const newStatus = (p as any).new?.status as
                | ThreadStatus
                | undefined;
              if (isCountable(oldStatus))
                st[oldStatus] = Math.max(0, (st[oldStatus] ?? 0) - 1);
              if (isCountable(newStatus))
                st[newStatus] = (st[newStatus] ?? 0) + 1;
            } else if (evt === "DELETE") {
              const delStatus = (p as any).old?.status as
                | ThreadStatus
                | undefined;
              if (isCountable(delStatus))
                st[delStatus] = Math.max(0, (st[delStatus] ?? 0) - 1);
              st.total = Math.max(0, (st.total ?? 0) - 1);
            }

            byImg[row.image_name!] = st;
            next[row.sku!] = byImg;
            return next;
          });
        } catch (e) {
          toastError(e, { title: "Error en tiempo real de hilos" });
        }
      }
    );

    // RECEIPTS → recomputa sólo el SKU afectado
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_message_receipts" },
      async (p) => {
        try {
          const merged = { ...(p.old as any), ...(p.new as any) } as {
            message_id?: number;
            user_id?: string;
            read_at?: string | null;
          };
          if (!merged.message_id || !selfId) return;

          let sku = msgSkuCache.current.get(merged.message_id);
          if (!sku) {
            const { data, error } = await sb
              .from("review_messages")
              .select(`id, review_threads!inner(sku)`)
              .eq("id", merged.message_id)
              .limit(1)
              .maybeSingle();
            if (error || !data?.review_threads?.sku) return;
            sku = data.review_threads.sku as string;
            msgSkuCache.current.set(merged.message_id, sku);
          }

          if (!skuList.includes(sku)) return;

          const { data, error } = await sb.rpc("unread_by_sku", {
            p_user_id: selfId,
            p_skus: [sku],
          });
          if (error) return;

          const unreadCount = (data?.[0]?.unread_count ?? 0) as number;
          setUnread((prev) => ({ ...prev, [sku!]: unreadCount > 0 }));
        } catch (e) {
          toastError(e, { title: "Error actualizando lectura de mensajes" });
        }
      }
    );

    // MENSAJES NUEVOS → refrescar sólo ese SKU (RPC excluye system/propios)
    ch.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "review_messages" },
      async (p) => {
        try {
          if (!selfId) return;
          const msg = (p as any).new as { id: number; created_by: string };
          if (!msg?.id) return;

          let sku = msgSkuCache.current.get(msg.id);
          if (!sku) {
            const { data, error } = await sb
              .from("review_messages")
              .select(`id, review_threads!inner(sku)`)
              .eq("id", msg.id)
              .limit(1)
              .maybeSingle();
            if (error || !data?.review_threads?.sku) return;
            sku = data.review_threads.sku as string;
            msgSkuCache.current.set(msg.id, sku);
          }

          if (!skuList.includes(sku)) return;

          const { data, error } = await sb.rpc("unread_by_sku", {
            p_user_id: selfId,
            p_skus: [sku],
          });
          if (error) return;

          const unreadCount = (data?.[0]?.unread_count ?? 0) as number;
          setUnread((prev) => ({ ...prev, [sku!]: unreadCount > 0 }));
        } catch (e) {
          toastError(e, { title: "Error al refrescar mensajes no leídos" });
        }
      }
    );

    ch.subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [sb, skuList, selfId]);

  return { stats, unread };
}
