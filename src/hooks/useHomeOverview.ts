// src/hooks/useHomeOverview.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { SkuWithImagesAndStatus, ThreadStatus,MessageMetaRow } from "@/types/review";

/** Solo contamos estos estados (no 'deleted') */
type StatusKey = Exclude<ThreadStatus, "deleted">;

/** Stats por imagen */
export type ImageStats = { total: number } & Record<StatusKey, number>;
export type StatsBySku = Record<string, Record<string, ImageStats>>; // sku -> image_name -> stats
export type UnreadBySku = Record<string, boolean>;

const emptyStats = (): ImageStats => ({
  total: 0,
  pending: 0,
  corrected: 0,
  reopened: 0,
});

/** Type-guard para indexar de forma segura */
const isStatusKey = (s: unknown): s is StatusKey =>
  s === "pending" || s === "corrected" || s === "reopened";



export function useHomeOverview(skus: SkuWithImagesAndStatus[]) {
  const skuList = useMemo(() => skus.map((s) => s.sku), [skus]);
  const [stats, setStats] = useState<StatsBySku>({});
  const [unread, setUnread] = useState<UnreadBySku>({});
  const [selfId, setSelfId] = useState<string | null>(null);

  // auth id
  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => setSelfId(data.user?.id ?? null))
      .catch(() => setSelfId(null));
  }, []);

  const checkHasReceiptForThisMessage = async (messageId: number) => {
    if (!selfId) return null;

    const { data, error } = await supabaseBrowser()
      .from("review_threads")
      .select(`
        id,
        sku,
        messages:review_messages!inner(
          id,
          created_by,
          receipts:review_message_receipts!review_message_receipts_message_fkey(
            user_id,
            read_at
          )
        )
      `)
      .eq("messages.id", messageId)
      .eq("messages.receipts.user_id", selfId);

    if (error) {
      console.warn("checkHasReceiptForThisMessage error", error);
      return null;
    }
    const {sku} = data[0];
    // Si trae algo, ese mensaje concreto ya tiene receipt del usuario
    return {sku:sku, hasReceipt: (data ?? []).some((t: any) =>
      (t.messages ?? []).some((m: any) =>
        (m.receipts ?? []).some((r: any) => r.user_id === selfId)
      )
    )};
  };

  // carga inicial (resúmenes por imagen)
  useEffect(() => {
    if (!skuList.length) return;
    let alive = true;

    (async () => {
      const sb = supabaseBrowser();
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
        if (isStatusKey(r.status)) {
          st[r.status] += 1;
          st.total += 1;
        }
      }
      setStats(map);
    })();

    return () => {
      alive = false;
    };
  }, [skuList]);

  // carga inicial de no leídos (boolean por sku)
  useEffect(() => {
    if (!skuList.length || !selfId) return;
    let alive = true;

    (async () => {
      const sb = supabaseBrowser();

      const { data } = await sb
        .from("review_messages")
        .select(`
          id, created_by, thread_id,
          review_threads!inner(sku),
          review_message_receipts!left(user_id, read_at)
        `)
        .in("review_threads.sku", skuList as string[])
        .eq("review_message_receipts.user_id", selfId);

      if (!alive || !data) return;

      const anyUnread: UnreadBySku = {};
      for (const row of data as any[]) {
        const sku = row.review_threads?.sku as string | undefined;
        if (!sku || row.created_by === selfId) continue;
        const receipts =
          (row.review_message_receipts || []) as { user_id: string; read_at: string | null }[];
        const rec = receipts.find((r) => r.user_id === selfId);
        const isUnread = !rec || !rec.read_at;
        if (isUnread) anyUnread[sku] = true;
      }
      setUnread(anyUnread);
    })();

    return () => {
      alive = false;
    };
  }, [skuList, selfId]);

  // realtime (threads + receipts)
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel("home-overview", { config: { broadcast: { ack: true } } });

    // Threads → actualizar barras por imagen
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_threads" },
      (p) => {
        const evt = p.eventType;
        const row =
          (evt === "DELETE" ? (p as any).old : (p as any).new) as {
            sku?: string;
            image_name?: string;
            status?: ThreadStatus;
          } | null;

        if (!row?.sku || !row.image_name || !skuList.includes(row.sku)) return;

        setStats((prev) => {
          const next: StatsBySku = { ...prev };
          const byImg = (next[row.sku!] ||= {});
          const st = (byImg[row.image_name!] ||= emptyStats());

          if (evt === "INSERT") {
            if (isStatusKey(row.status)) {
              st[row.status] = (st[row.status] ?? 0) + 1;
              st.total += 1;
            }
          } else if (evt === "UPDATE") {
            const oldStatus = (p as any).old?.status as ThreadStatus | undefined;
            const newStatus = (p as any).new?.status as ThreadStatus | undefined;
            if (isStatusKey(oldStatus)) st[oldStatus] = Math.max(0, (st[oldStatus] ?? 0) - 1);
            if (isStatusKey(newStatus)) st[newStatus] = (st[newStatus] ?? 0) + 1;
            // total no cambia en UPDATE
          } else if (evt === "DELETE") {
            if (isStatusKey(row.status)) {
              st[row.status] = Math.max(0, (st[row.status] ?? 0) - 1);
            }
            st.total = Math.max(0, st.total - 1);
          }
          return next;
        });
      }
    );

    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_message_receipts" },
      async (p) => {
        const merged = { ...(p.old as any), ...(p.new as any) };
        if (!merged.message_id || !selfId) return;
        const data = await checkHasReceiptForThisMessage(merged.message_id);
        if(data){
          const {sku, hasReceipt} = data;
          setUnread((prev) => ({ ...prev, [sku]: hasReceipt }));
        }
      }
    );

    ch.subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [skuList, selfId]);

  return { stats, unread };
}
