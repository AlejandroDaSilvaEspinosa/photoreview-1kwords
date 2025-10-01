// src/components/Notifications.tsx
"use client";

import { presentNotification } from "@/lib/notifications/presenter";
import { useWireNotificationsRealtime } from "@/lib/realtime/useWireNotificationsRealtime";
import "@/lib/timeago";
import {
  useNotificationsStore,
  type NotificationRow,
} from "@/stores/notifications";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "timeago.js";
import styles from "./Notifications.module.css";
import NotificationIcon from "@/icons/notification.svg";
import CloseIcon from "@/icons/close.svg";

const PAGE_SIZE = 30;

export default function Notifications({
  onOpenSku,
  initial,
}: {
  onOpenSku: (sku: string) => void;
  initial?: { items: NotificationRow[]; unseen?: number } | null;
}) {
  useWireNotificationsRealtime({
    initial,
    prefetchFromApi: !initial,
    limit: PAGE_SIZE,
  });

  const [open, setOpen] = useState(false);
  const items = useNotificationsStore((s) => s.items);
  const unseen = useNotificationsStore((s) => s.unseen);
  const markViewedLocal = useNotificationsStore((s) => s.markViewedLocal);
  const appendOlder = useNotificationsStore((s) => s.appendOlder);

  const hasBadge = unseen > 0;
  const currentCursor = useMemo(
    () => (items.length ? items[items.length - 1].created_at : null),
    [items]
  );

  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // ========= NUEVO: cola de "viewed" pendiente (para parchear al backend en batch)
  const pendingViewedRef = useRef<Set<number>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushViewed = useCallback(async () => {
    const ids = Array.from(pendingViewedRef.current);
    if (!ids.length) return;
    pendingViewedRef.current.clear();
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    } catch {
      // Silenciar; en próxima interacción se volverá a intentar
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    // pequeño debounce para agrupar varios hovers/clicks
    flushTimerRef.current = setTimeout(flushViewed, 600);
  }, [flushViewed]);

  // marcar un item como visto en hover/click
  const markOneViewed = useCallback(
    (id: number) => {
      if (!pendingViewedRef.current.has(id)) {
        pendingViewedRef.current.add(id);
        markViewedLocal([id]);
        scheduleFlush();
      }
    },
    [markViewedLocal, scheduleFlush]
  );

  // ========= CARGA PEREZOSA
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
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const panelRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const container = panelRef.current,
      sentinel = sentinelRef.current;
    if (!container || !sentinel) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && loadMore()),
      { root: container, rootMargin: "100px", threshold: 0 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [open, items.length, currentCursor, hasMore, loadingMore]);

  const router = useRouter();
  const pathname = usePathname();

  const openTarget = (n: NotificationRow) => {
    // Asegura marcar vista al interactuar
    if (!n.viewed) markOneViewed(n.id);

    const pres = presentNotification(n);
    if (pres.deeplink) {
      router.replace(`${pathname}${pres.deeplink}`, { scroll: false });
      closePanel(); // cerrar tras navegar
      return;
    }
    if (n.sku) onOpenSku(n.sku);
    closePanel();
  };

  // ========= ABRIR/CERRAR CON LIMPIEZA
  const openPanel = () => setOpen(true);

  const closePanel = useCallback(() => {
    // 1) Marca como vistas todas las restantes que sigan sin "viewed"
    const ids = items.filter((n) => !n.viewed).map((n) => n.id);
    if (ids.length) {
      markViewedLocal(ids);
      ids.forEach((id) => pendingViewedRef.current.add(id));
    }
    // 2) Envía inmediatamente (sin esperar al debounce)
    flushViewed();
    // 3) Cierra
    setOpen(false);
  }, [items, markViewedLocal, flushViewed]);

  // Evita fugas de timer
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  return (
    <div className={styles.wrap}>
      <button
        className={styles.bellBtn}
        aria-label="Notificaciones"
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <NotificationIcon /> {hasBadge && <span className={styles.badge} />}
      </button>

      {open && (
        <div
          className={styles.panel}
          onClick={(e) => e.stopPropagation()}
          ref={panelRef}
        >
          <div className={styles.panelHeader}>
            <strong>Notificaciones</strong>
            <button className={styles.closeBtn} onClick={closePanel}>
              <CloseIcon />
            </button>
          </div>

          <div className={styles.list}>
            {items.length === 0 && (
              <div className={styles.empty}>No hay notificaciones</div>
            )}

            {items.map((n) => {
              const pres = presentNotification(n);
              return (
                <div
                  key={n.id}
                  className={styles.item}
                  onMouseEnter={() => {
                    if (!n.viewed) markOneViewed(n.id);
                  }}
                  onClick={() => openTarget(n)}
                >
                  {pres.thumbUrl ? (
                    <Image
                      width={64}
                      height={64}
                      className={styles.thumb}
                      src={pres.thumbUrl}
                      alt=""
                      aria-hidden
                    />
                  ) : null}

                  <div className={styles.itemContent}>
                    <div className={styles.itemTop}>
                      <span className={styles.kind}>{pres.title}</span>
                      <span className={styles.time}>
                        {format(n.created_at, "es")}
                      </span>
                    </div>

                    <div className={styles.line}>{pres.description}</div>

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

                  {/* Punto rojo (no vista) */}
                  {!n.viewed && (
                    <span
                      className={styles.unviewedDot}
                      aria-label="Notificación no vista"
                    />
                  )}
                </div>
              );
            })}

            <div ref={sentinelRef} />
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
