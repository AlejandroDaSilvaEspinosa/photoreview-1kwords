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
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "timeago.js";
import styles from "./Notifications.module.css";
import NotificationIcon from "@/icons/notification.svg";

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
    const pres = presentNotification(n);
    if (pres.deeplink) {
      router.replace(`${pathname}${pres.deeplink}`, { scroll: false });
      setOpen(false);
      return;
    }
    if (n.sku) onOpenSku(n.sku);
    setOpen(false);
  };

  return (
    <div className={styles.wrap}>
      <button
        className={styles.bellBtn}
        aria-label="Notificaciones"
        onClick={() => setOpen((o) => !o)}
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
            <button className={styles.closeBtn} onClick={() => setOpen(false)}>
              ×
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
