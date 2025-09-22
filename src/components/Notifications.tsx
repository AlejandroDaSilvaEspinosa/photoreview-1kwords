"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { format } from "timeago.js";
import "@/lib/timeago";
import { supabaseBrowser } from "@/lib/supabase/browser";
import styles from "./Notifications.module.css";

type NotificationKind = "new_message" | "new_thread" | "change_sku_status" | "change_image_status";

type Notification = {
  id: number;
  user_id: string;
  author_id: string;
  kind: NotificationKind;
  sku: string | null;
  image_name: string | null;
  thread_id: number | null;
  message_id: number | null;
  payload: any;
  viewed: boolean;
  created_at: string;
};

type Props = {
  onOpenSku: (sku: string) => void;
  /** Prefetch opcional desde Home */
  initial?: { items: Notification[]; unseen: number } | null;
};

export default function Notifications({ onOpenSku, initial }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>(initial?.items ?? []);
  const [unseen, setUnseen] = useState<number>(initial?.unseen ?? 0);

  // cargar en background si no hay prefetch
  useEffect(() => {
    if (initial) return;
    let alive = true;
    (async () => {
      const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      if (!alive) return;
      if (res.ok) {
        const json = await res.json();
        setItems(json.items || []);
        setUnseen(json.unseen || 0);
      }
    })();
    return () => { alive = false; };
  }, [initial]);

  // realtime: nuevas notificaciones → prepend + unseen++
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel("notifications-self", { config: { broadcast: { ack: true } } });

    ch.on("postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications" },
      (p: any) => {
        const row = p.new as Notification;
        // Seguridad: si el row.user_id no es mío, lo ignorará RLS en el fetch, pero aquí llega por realtime;
        // si quieres, puedes comprobar auth.getUser() y filtrar.
        setItems(prev => [row, ...prev].slice(0, 50));
        setUnseen(prev => prev + (row.viewed ? 0 : 1));
      }
    );

    ch.subscribe();
    return () => { sb.removeChannel(ch); };
  }, []);

  // al abrir el panel, marcamos "viewed" en lote
  useEffect(() => {
    if (!open) return;
    const ids = items.filter(n => !n.viewed).map(n => n.id);
    if (!ids.length) return;
    (async () => {
      setItems(prev => prev.map(n => n.viewed ? n : { ...n, viewed: true }));
      setUnseen(0);
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }).catch(() => {});
    })();
  }, [open, items]);

  const badge = unseen > 0;

  const openTarget = (n: Notification) => {
    if (n.sku) onOpenSku(n.sku);
    setOpen(false);
  };

  const titleMap: Record<NotificationKind, string> = {
    new_message:       "Nuevo mensaje",
    new_thread:        "Nuevo hilo",
    change_sku_status: "Cambio de estado del SKU",
    change_image_status: "Cambio de estado de imagen",
  };

  const renderLine = (n: Notification) => {
    switch (n.kind) {
      case "new_message":
        return n.payload?.text_preview || "Mensaje nuevo";
      case "new_thread":
        return `Hilo creado ${n.image_name ? `en ${n.image_name}` : ""}`;
      case "change_sku_status":
        return `Estado: ${n.payload?.from ?? "?"} → ${n.payload?.to ?? "?"}`;
      case "change_image_status":
        return `Imagen ${n.image_name}: ${n.payload?.from ?? "?"} → ${n.payload?.to ?? "?"}`;
      default:
        return "";
    }
  };

  return (
    <div className={styles.wrap}>
      <button
        className={styles.bellBtn}
        aria-label="Notificaciones"
        onClick={() => setOpen(o => !o)}
      >
        🔔
        {badge && <span className={styles.badge} />}
      </button>

      {open && (
        <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
          <div className={styles.panelHeader}>
            <strong>Notificaciones</strong>
            <button className={styles.closeBtn} onClick={() => setOpen(false)}>×</button>
          </div>
          <div className={styles.list}>
            {items.length === 0 && <div className={styles.empty}>No hay notificaciones</div>}
            {items.map((n) => (
              <div key={n.id} className={styles.item} onClick={() => openTarget(n)}>
                <div className={styles.itemTop}>
                  <span className={styles.kind}>{titleMap[n.kind]}</span>
                  <span className={styles.time}>{format(n.created_at, "es")}</span>
                </div>
                <div className={styles.line}>{renderLine(n)}</div>
                {n.sku && <div className={styles.meta}>SKU: <code>{n.sku}</code></div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
