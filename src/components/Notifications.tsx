// src/components/Notifications.tsx
"use client";

import { useEffect, useState } from "react";
import { format } from "timeago.js";
import "@/lib/timeago";
import styles from "./Notifications.module.css";

import { useWireNotificationsRealtime } from "@/lib/realtime/wireNotifications";
import {
  useNotificationsStore,
  type NotificationRow,
  type NotificationType,
} from "@/stores/notifications";

type Props = {
  onOpenSku: (sku: string) => void;
  /** Prefetch opcional (SSR/route) para hidratar la store al montar */
  initial?: { items: NotificationRow[]; unseen?: number } | null;
};

const TITLE: Record<NotificationType, string> = {
  new_message: "Nuevo mensaje",
  new_thread: "Nuevo hilo",
  thread_status_changed: "Cambió el estado del hilo",
  image_status_changed: "Cambio de estado de imagen",
  sku_status_changed: "Cambio de estado del SKU",
};

export default function Notifications({ onOpenSku, initial }: Props) {
  // Suscripción + hidratación inicial (si la hay); si no hay initial, hace prefetch desde /api/notifications
  useWireNotificationsRealtime({ initial: initial ?? undefined, prefetchFromApi: !initial, limit: 30 });

  // Estado de UI (abierto/cerrado) local al componente
  const [open, setOpen] = useState(false);

  // Datos desde la store (única fuente)
  const items  = useNotificationsStore((s) => s.items);
  const unseen = useNotificationsStore((s) => s.unseen);
  const markViewedLocal = useNotificationsStore((s) => s.markViewedLocal);

  const hasBadge = unseen > 0;

  // Al abrir el panel → marcar como vistas en lote (optimista) + PATCH a la API
  useEffect(() => {
    if (!open) return;
    const ids = items.filter((n) => !n.viewed).map((n) => n.id);
    if (!ids.length) return;

    // Optimista local
    markViewedLocal(ids);

    // Persistir en backend (si falla ya llegará UPDATE/INSERT por realtime o lo reharás al abrir de nuevo)
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => {});
  }, [open, items, markViewedLocal]);

  const openTarget = (n: NotificationRow) => {
    if (n.sku) onOpenSku(n.sku);
    setOpen(false);
  };

  const renderSubtitle = (n: NotificationRow) => {
    // La tabla guarda un mensaje plano en n.message. Lo mostramos tal cual.
    // (Si quieres “fallbacks” distintos por tipo, puedes ampliarlo aquí.)
    return n.message || "";
  };

  return (
    <div className={styles.wrap}>
      <button
        className={styles.bellBtn}
        aria-label="Notificaciones"
        onClick={() => setOpen((o) => !o)}
      >
        🔔
        {hasBadge && <span className={styles.badge} />}
      </button>

      {open && (
        <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
          <div className={styles.panelHeader}>
            <strong>Notificaciones</strong>
            <button className={styles.closeBtn} onClick={() => setOpen(false)}>
              ×
            </button>
          </div>

          <div className={styles.list}>
            {items.length === 0 && (
              <div className={styles.empty}>No hay notificaciones</div>
            )}

            {items.map((n) => (
              <div key={n.id} className={styles.item} onClick={() => openTarget(n)}>
                <div className={styles.itemTop}>
                  <span className={styles.kind}>{TITLE[n.type]}</span>
                  <span className={styles.time}>{format(n.created_at, "es")}</span>
                </div>

                <div className={styles.line}>{renderSubtitle(n)}</div>

                {n.sku && (
                  <div className={styles.meta}>
                    SKU: <code>{n.sku}</code>
                    {n.image_name ? (
                      <>
                        {" "}
                        — Imagen: <code>{n.image_name}</code>
                      </>
                    ) : null}
                    {typeof n.thread_id === "number" ? (
                      <>
                        {" "}
                        — Hilo: <code>#{n.thread_id}</code>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
