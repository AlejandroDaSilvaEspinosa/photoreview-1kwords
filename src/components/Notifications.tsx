"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  initial?: { items: NotificationRow[]; unseen?: number } | null;
};

const TITLE: Record<NotificationType, string> = {
  new_message: "Nuevo mensaje",
  new_thread: "Nuevo hilo",
  thread_status_changed: "Cambió el estado del hilo",
  image_status_changed: "Cambio de estado de imagen",
  sku_status_changed: "Cambio de estado del SKU",
};

const PAGE_SIZE = 30;

export default function Notifications({ onOpenSku, initial }: Props) {
  // SWR + realtime
  useWireNotificationsRealtime({ initial, prefetchFromApi: !initial, limit: PAGE_SIZE });

  const [open, setOpen] = useState(false);

  // Store
  const items  = useNotificationsStore((s) => s.items);
  const unseen = useNotificationsStore((s) => s.unseen);
  const markViewedLocal = useNotificationsStore((s) => s.markViewedLocal);
  const appendOlder = useNotificationsStore((s) => s.appendOlder);

  const hasBadge = unseen > 0;

  // Cursor = created_at del último ítem cargado
  const currentCursor = useMemo(
    () => (items.length ? items[items.length - 1].created_at : null),
    [items]
  );

  // Estado de paginación
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Al abrir, marcar como vistas (optimista)
  useEffect(() => {
    if (!open) return;
    const ids = items.filter((n) => !n.viewed).map((n) => n.id);
    if (!ids.length) return;
    markViewedLocal(ids);
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => {});
  }, [open, items, markViewedLocal]);

  // Cargar más (paginación)
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const url = new URL(`/api/notifications`, window.location.origin);
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (currentCursor) url.searchParams.set("before", currentCursor);
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        const rows: NotificationRow[] = json.items ?? [];
        appendOlder(rows);
        setHasMore(Boolean(json.has_more) && rows.length > 0);
      } else {
        // si falla, no bloquees futuros intentos
      }
    } catch {
      /* noop */
    } finally {
      setLoadingMore(false);
    }
  };

  // Sentinel para scroll infinito
  const panelRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = panelRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            // cuando el sentinel aparece, intenta cargar más
            loadMore();
          }
        }
      },
      {
        root: container,
        rootMargin: "100px", // empieza un poco antes de llegar al final
        threshold: 0,
      }
    );

    io.observe(sentinel);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length, currentCursor, hasMore, loadingMore]);

  const openTarget = (n: NotificationRow) => {
    if (n.sku) onOpenSku(n.sku);
    setOpen(false);
  };

  const renderSubtitle = (n: NotificationRow) => n.message || "";

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
        <div className={styles.panel} onClick={(e) => e.stopPropagation()} ref={panelRef}>
          <div className={styles.panelHeader}>
            <strong>Notificaciones</strong>
            <button className={styles.closeBtn} onClick={() => setOpen(false)}>×</button>
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
                    {n.image_name ? <> — Imagen: <code>{n.image_name}</code></> : null}
                    {typeof n.thread_id === "number" ? <> — Hilo: <code>#{n.thread_id}</code></> : null}
                  </div>
                )}
              </div>
            ))}

            {/* Sentinel */}
            <div ref={sentinelRef} />

            {/* Footer de estado */}
            <div className={styles.footerState}>
              {loadingMore ? (
                <div className={styles.loadingMore}>
                  <span className={styles.spinner} aria-hidden />
                  Cargando más…
                </div>
              ) : !hasMore && items.length > 0 ? (
                <div className={styles.end}>Has llegado al final</div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
