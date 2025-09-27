// src/hooks/useHomeOverview.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { SkuWithImagesAndStatus, ThreadStatus } from "@/types/review";
import { toastError } from "@/hooks/useToast";

/** Estados contables (excluye 'deleted') */
type CountableStatus = Exclude<ThreadStatus, "deleted">;

/** Stats por imagen */
export type ImageStats = { total: number } & Record<CountableStatus, number>;
export type StatsBySku = Record<string, Record<string, ImageStats>>; // sku -> image_name -> stats
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
    [skus],
  );

  const [stats, setStats] = useState<StatsBySku>({});
  const [unread, setUnread] = useState<UnreadBySku>({});
  const [selfId, setSelfId] = useState<string | null>(null);

  // --- auth uid ---
  useEffect(() => {
    let cancelled = false;
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setSelfId(data.user?.id ?? null);
      })
      .catch((e) => toastError(e, { title: "No se pudo recuperar la sesión" }));
    return () => {
      cancelled = true;
    };
  }, []);

  // --- carga inicial: estadísticas por imagen ---
  useEffect(() => {
    if (!skuList.length) return;
    let alive = true;

    (async () => {
      try {
        const sb = supabaseBrowser();
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
  }, [skuList]);

  // --- carga inicial: no leídos por SKU ---
  useEffect(() => {
    if (!skuList.length || !selfId) return;
    let alive = true;

    (async () => {
      try {
        const sb = supabaseBrowser();

        // Mensajes (de otros) por los SKUs visibles + left join de recibos del usuario
        const { data, error } = await sb
          .from("review_messages")
          .select(
            `
            id,
            created_by,
            review_threads!inner(sku),
            review_message_receipts!left(
              user_id,
              read_at
            )
          `,
          )
          .in("review_threads.sku", skuList as string[]);

        if (!alive) return;
        if (error) throw error;

        // Cálculo conservador: si el mensaje no es mío y NO hay read_at para este usuario
        // (ya sea porque no hay receipt o porque está a null) => hay no leídos en ese SKU.
        const anyUnread: UnreadBySku = {};
        for (const row of (data ?? []) as any[]) {
          const sku = row?.review_threads?.sku as string | undefined;
          if (!sku) continue;
          if (row.created_by === selfId) continue;

          const receipts = (row.review_message_receipts ?? []) as {
            user_id: string;
            read_at: string | null;
          }[];

          const mineRec = receipts.find((r) => r.user_id === selfId);
          const isUnread = !mineRec || !mineRec.read_at;
          if (isUnread) anyUnread[sku] = true;
        }
        setUnread(anyUnread);
      } catch (e) {
        toastError(e, {
          title: "No se pudieron cargar los mensajes no leídos",
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [skuList, selfId]);

  // --- realtime: threads + receipts ---
  useEffect(() => {
    if (!skuList.length) return;

    const sb = supabaseBrowser();
    const ch = sb.channel("home-overview", {
      config: { broadcast: { ack: true } },
    });

    // THREADS → actualizar barras por imagen
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
            const byImg = (next[row.sku!] ||= {});
            const st = (byImg[row.image_name!] ||= emptyStats());

            if (evt === "INSERT") {
              if (isCountable(row.status)) {
                st[row.status] = (st[row.status] ?? 0) + 1;
                st.total += 1;
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
              st.total = Math.max(0, st.total - 1);
            }
            return next;
          });
        } catch (e) {
          toastError(e, { title: "Error en tiempo real de hilos" });
        }
      },
    );

    // RECEIPTS → actualizar bandera de no leídos
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

          // Recupera el SKU del mensaje afectado y comprueba si tiene receipt leído
          const { data, error } = await supabaseBrowser()
            .from("review_messages")
            .select(
              `
              id,
              review_threads!inner(sku),
              review_message_receipts!left(user_id, read_at)
            `,
            )
            .eq("id", merged.message_id)
            .limit(1)
            .maybeSingle();

          if (error || !data?.review_threads?.sku) return;
          const sku = data.review_threads.sku as string;

          // ¿Sigue habiendo mensajes no leídos para ese SKU?
          const receipts = (data.review_message_receipts ?? []) as {
            user_id: string;
            read_at: string | null;
          }[];
          const mineRec = receipts.find((r) => r.user_id === selfId);
          const stillUnread = !mineRec || !mineRec.read_at;

          setUnread((prev) => ({ ...prev, [sku]: stillUnread }));
        } catch (e) {
          toastError(e, { title: "Error actualizando lectura de mensajes" });
        }
      },
    );

    ch.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // Silencioso: el resto de hooks se reintentan; mostramos toast si quieres ruido
        // emitToast({ variant: "warning", title: "Conexión inestable", description: "Reconectando…" })
      }
    });

    return () => {
      supabaseBrowser().removeChannel(ch);
    };
  }, [skuList, selfId]);

  return { stats, unread };
}
