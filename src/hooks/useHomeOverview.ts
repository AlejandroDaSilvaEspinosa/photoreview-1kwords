// src/hooks/useHomeOverview.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { SkuWithImagesAndStatus, ThreadStatus } from "@/types/review";

type ImageStats = { pending: number; corrected: number; reopened: number; total: number };
export type StatsBySku = Record<string, Record<string, ImageStats>>; // sku -> image_name -> stats
export type UnreadBySku = Record<string, boolean>;

const emptyStats = (): ImageStats => ({ pending: 0, corrected: 0, reopened: 0, total: 0 });

export function useHomeOverview(skus: SkuWithImagesAndStatus[]) {
  const skuList = useMemo(() => skus.map((s) => s.sku), [skus]);
  const [stats, setStats] = useState<StatsBySku>({});
  const [unread, setUnread] = useState<UnreadBySku>({});
  const [selfId, setSelfId] = useState<string | null>(null);

  // auth id
  useEffect(() => {
    supabaseBrowser().auth.getUser()
      .then(({ data }) => setSelfId(data.user?.id ?? null))
      .catch(() => setSelfId(null));
  }, []);

  // carga inicial (resúmenes por imagen)
  useEffect(() => {
    if (!skuList.length) return;
    let alive = true;

    (async () => {
      const sb = supabaseBrowser();
      // traemos los hilos relevantes y agregamos en cliente
      const { data: rows } = await sb
        .from("review_threads")
        .select("sku,image_name,status")
        .in("sku", skuList as string[])
        .neq("status", "deleted");

      if (!alive || !rows) return;

      const map: StatsBySku = {};
      for (const r of rows as { sku: string; image_name: string; status: ThreadStatus }[]) {
        const byImg = (map[r.sku] ||= {});
        const st = (byImg[r.image_name] ||= emptyStats());
        st[r.status as keyof ImageStats]++ as unknown as number;
        st.total++;
      }
      setStats(map);
    })();

    return () => { alive = false; };
  }, [skuList]);

  // carga inicial de no leídos (boolean por sku)
  useEffect(() => {
    if (!skuList.length || !selfId) return;
    let alive = true;

    (async () => {
      const sb = supabaseBrowser();

      // Mensajes de esos SKUs (join con threads) y receipts del usuario
      // Nota: usamos left join y filtramos receipts nulos del usuario.
      const { data } = await sb
        .from("review_messages")
        .select(`
          id, created_by, thread_id,
          review_threads!inner(sku),
          review_message_receipts!left(user_id, read_at)
        `)
        .in("review_threads.sku", skuList as string[])
        .neq("created_by", selfId);

      if (!alive || !data) return;

      const anyUnread: UnreadBySku = {};
      for (const row of data as any[]) {
        const sku = row.review_threads?.sku;
        const receipts = (row.review_message_receipts || []) as { user_id: string; read_at: string | null }[];
        const mine = row.created_by === selfId;
        if (!sku || mine) continue;

        const rec = receipts.find((r) => r.user_id === selfId);
        const isUnread = !rec || !rec.read_at;
        if (isUnread) anyUnread[sku] = true;
      }
      setUnread(anyUnread);
    })();

    return () => { alive = false; };
  }, [skuList, selfId]);

  // realtime (threads + messages + receipts)
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel("home-overview", { config: { broadcast: { ack: true } } });

    // Threads → actualizar barras por imagen
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_threads" },
      (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as any;
        if (!row || !row.sku || !skuList.includes(row.sku)) return;
        if (row.status === "deleted") return;

        setStats((prev) => {
          const next: StatsBySku = { ...prev };
          const byImg = (next[row.sku] ||= {});
          const key = row.image_name as string;
          const st = (byImg[key] ||= emptyStats());

          // recalcular con simplicidad: restar/añadir según evento
          if (p.eventType === "INSERT") {
            st[row.status] = (st[row.status]  ?? 0) + 1;
            st.total++;
          } else if (p.eventType === "UPDATE") {
            const old = (p as any).old?.status;
            const neu = (p as any).new?.status;
            if (old && old !== "deleted") st[old] = Math.max(0, (st[old] ?? 0) - 1);
            if (neu && neu !== "deleted") st[neu] = (st[neu] ?? 0) + 1;
          } else if (p.eventType === "DELETE") {
            st[row.status] = Math.max(0, (st[row.status] ?? 0) - 1);
            st.total = Math.max(0, st.total - 1);
          }
          return next;
        });
      }
    );

    // Messages / receipts → badge de no leídos
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_messages" },
      (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as any;
        const sku = row?.review_threads?.sku; // no viene por defecto en payload
        // Si el trigger no trae join, hacemos una consulta rápida
        if (!sku || !selfId) return;
      }
    );

    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_message_receipts" },
      () => {
        // Para mantenerlo simple, forzamos un refetch rápido de unread.
        // (pudiendo optimizar si lo necesitas)
        if (!selfId || !skuList.length) return;
        (async () => {
          const { data } = await supabaseBrowser()
            .from("review_messages")
            .select(`
              id, created_by, thread_id,
              review_threads!inner(sku),
              review_message_receipts!left(user_id, read_at)
            `)
            .in("review_threads.sku", skuList as string[])
            .neq("created_by", selfId);

          if (!data) return;
          const anyUnread: UnreadBySku = {};
          for (const row of data as any[]) {
            const sku = row.review_threads?.sku;
            const receipts = (row.review_message_receipts || []) as { user_id: string; read_at: string | null }[];
            const rec = receipts.find((r) => r.user_id === selfId);
            const isUnread = !rec || !rec.read_at;
            if (row.created_by !== selfId && sku && isUnread) anyUnread[sku] = true;
          }
          setUnread(anyUnread);
        })();
      }
    );

    ch.subscribe();
    return () => { sb.removeChannel(ch); };
  }, [skuList, selfId]);

  return { stats, unread };
}
