"use client";

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { useToast } from "@/hooks/useToast";
import { notifyNative } from "@/lib/notify";
import type {
  ThreadRow,
  MessageRow,
  ImageStatusRow,
  SkuStatusRow,
} from "@/lib/useSkuChannel";

type Options = {
  onOpenSku?: (sku: string) => void;
  onOpenImage?: (sku: string, imageName: string) => void;
};

export function useGlobalRealtimeToasts(opts: Options = {}) {
  const { push } = useToast();
  const threadInfoRef = useRef<Map<number, { sku: string; image: string }>>(new Map());

  // ------- helpers -------
  const labelThreadStatus = (s: ThreadRow["status"]) =>
    s === "pending" ? "Pendiente"
    : s === "corrected" ? "Corregido"
    : s === "reopened" ? "Reabierto"
    : s === "deleted" ? "Eliminado"
    : String(s);

  const labelSkuStatus = (s: SkuStatusRow["status"]) =>
    s === "pending_validation" ? "Pdte. validar"
    : s === "needs_correction" ? "Necesita corrección"
    : s === "validated" ? "Validado"
    : s === "reopened" ? "Reabierto"
    : String(s);

  const variantFromThread = (s?: ThreadRow["status"]) =>
    s === "deleted" ? "error"
    : s === "corrected" ? "success"
    : s === "reopened" || s === "pending" ? "warning"
    : "info";

  const variantFromImage = (s?: ImageStatusRow["status"]) =>
    s === "needs_correction" ? "warning" : "success";

  const variantFromSku = (s?: SkuStatusRow["status"]) =>
    s === "validated" ? "success"
    : s === "needs_correction" || s === "reopened" ? "warning"
    : "info";

  const openAction = (sku: string, image?: string) => ({
    actionLabel: image && opts.onOpenImage ? "Abrir imagen" : (opts.onOpenSku ? "Abrir SKU" : ""),
    onAction: () => {
      if (image && opts.onOpenImage) return opts.onOpenImage(sku, image);
      if (opts.onOpenSku) return opts.onOpenSku(sku);
    }
  });

  const ensureThreadInfo = async (threadId: number) => {
    if (threadInfoRef.current.has(threadId)) return threadInfoRef.current.get(threadId)!;
    const sb = supabaseBrowser();
    const { data } = await sb
      .from("review_threads")
      .select("sku,image_name")
      .eq("id", threadId)
      .maybeSingle();
    const info = { sku: data?.sku ?? "?", image: data?.image_name ?? "?" };
    threadInfoRef.current.set(threadId, info);
    return info;
  };

  useEffect(() => {
    const sb = supabaseBrowser();

    // Precarga cache (id -> sku,image) para rotular mensajes
    (async () => {
      const { data } = await sb
        .from("review_threads")
        .select("id,sku,image_name");
      (data || []).forEach((r: any) => {
        threadInfoRef.current.set(r.id, { sku: r.sku, image: r.image_name });
      });
    })();

    // Canal global
    const ch = sb.channel("global-review-toasts", {
      config: { broadcast: { ack: true } },
    });

    // THREADS (INSERT/UPDATE/DELETE)
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_threads" },
      (payload) => {
        const evt = payload.eventType as "INSERT"|"UPDATE"|"DELETE";
        const row = (evt === "DELETE" ? (payload.old as ThreadRow) : (payload.new as ThreadRow)) || (payload.new as ThreadRow);
        if (!row) return;

        // mantener cache al día
        if (evt === "DELETE") {
          threadInfoRef.current.delete(row.id);
        } else {
          threadInfoRef.current.set(row.id, { sku: row.sku, image: row.image_name });
        }

        const title =
          evt === "INSERT" ? `Nuevo hilo #${row.id}`
          : evt === "UPDATE" ? `Hilo #${row.id} actualizado`
          : `Hilo #${row.id} eliminado`;

        const statusText =
          evt === "UPDATE" && (payload.old as ThreadRow)?.status
            ? `${labelThreadStatus((payload.old as ThreadRow).status)} → ${labelThreadStatus(row.status)}`
            : labelThreadStatus(row.status);

        const description =
          evt === "DELETE"
            ? `SKU ${row.sku} · ${row.image_name}`
            : `SKU ${row.sku} · ${row.image_name} · Estado: ${statusText}`;

        const variant =
          evt === "DELETE" ? "error" : variantFromThread(row.status);

        push({
          title,
          description,
          variant,
          ...openAction(row.sku, row.image_name),
        });
        notifyNative(title, { body: description });
      }
    );

    // MESSAGES (INSERT/UPDATE/DELETE)
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_messages" },
      async (payload) => {
        const evt = payload.eventType as "INSERT"|"UPDATE"|"DELETE";
        const row = (evt === "DELETE" ? (payload.old as MessageRow) : (payload.new as MessageRow)) || (payload.new as MessageRow);
        if (!row) return;

        const info = threadInfoRef.current.get(row.thread_id) ?? await ensureThreadInfo(row.thread_id);
        const who = row.created_by_display_name || row.created_by_username || "Usuario";

        const title =
          evt === "INSERT" ? `Nuevo mensaje en hilo #${row.thread_id}`
          : evt === "UPDATE" ? `Mensaje editado en hilo #${row.thread_id}`
          : `Mensaje eliminado en hilo #${row.thread_id}`;

        const preview = (row.text || "").slice(0, 120);
        const description =
          evt === "DELETE"
            ? `SKU ${info.sku} · ${info.image} · por ${who}`
            : `SKU ${info.sku} · ${info.image} · ${who}: "${preview}"`;

        push({
          title,
          description,
          variant: evt === "DELETE" ? "error" : "info",
          ...openAction(info.sku, info.image),
        });
        notifyNative(title, { body: description });
      }
    );

    // IMAGE STATUS (UPSERT/DELETE)
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_images_status" },
      (payload) => {
        const evt = payload.eventType as "INSERT"|"UPDATE"|"DELETE";
        const row = (evt === "DELETE" ? (payload.old as ImageStatusRow) : (payload.new as ImageStatusRow)) || (payload.new as ImageStatusRow);
        if (!row) return;

        const title =
          evt === "DELETE" ? `Estado de imagen eliminado`
          : `Imagen ${row.image_name} actualizada`;

        const statusText =
          evt === "DELETE" ? "" :
          row.status === "needs_correction" ? "Necesita corrección" : "Finalizada";

        const description =
          evt === "DELETE"
            ? `SKU ${row.sku} · ${row.image_name}`
            : `SKU ${row.sku} · ${row.image_name} · ${statusText}`;

        const variant = evt === "DELETE" ? "error" : variantFromImage(row.status);

        push({
          title,
          description,
          variant,
          ...openAction(row.sku, row.image_name),
        });
        notifyNative(title, { body: description });
      }
    );

    // SKU STATUS (UPSERT/DELETE)
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_skus_status" },
      (payload) => {
        const evt = payload.eventType as "INSERT"|"UPDATE"|"DELETE";
        const row = (evt === "DELETE" ? (payload.old as SkuStatusRow) : (payload.new as SkuStatusRow)) || (payload.new as SkuStatusRow);
        if (!row) return;

        const title =
          evt === "DELETE" ? `Estado de SKU eliminado`
          : `SKU ${row.sku} actualizado`;

        const description =
          evt === "DELETE"
            ? `Estado eliminado`
            : `Estado: ${labelSkuStatus(row.status)}${
                row.images_needing_fix != null ? ` · En corrección: ${row.images_needing_fix}` : ""
              }`;

        const variant = evt === "DELETE" ? "error" : variantFromSku(row.status);

        push({
          title,
          description,
          variant,
          ...openAction(row.sku),
        });
        notifyNative(title, { body: description });
      }
    );

    ch.subscribe();

    return () => {
      sb.removeChannel(ch);
    };
  }, [opts.onOpenSku, opts.onOpenImage, push]);
}
