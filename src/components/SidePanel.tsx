// src/components/SidePanel.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import styles from "./SidePanel.module.css";
import ThreadChat from "./ThreadChat";
import type { Thread, ThreadStatus } from "@/types/review";
import { emitToast } from "@/hooks/useToast";
import { localGet, localSet, toastStorageOnce } from "@/lib/storage";

/**
 * SidePanel (refactor a helpers de storage)
 * - Reemplaza acceso directo a localStorage por utilidades con toasts deduplicados.
 */

type Props = {
  name: string;
  isValidated: boolean;
  threads: Thread[];
  activeThreadId: number | null;

  onValidateSku: () => void;
  onUnvalidateSku: () => void;
  onAddThreadMessage: (threadId: number, text: string) => Promise<void> | void;
  onDeleteThread: (id: number) => void;
  onFocusThread: (id: number | null) => void;
  onToggleThreadStatus: (
    threadId: number,
    next: ThreadStatus
  ) => Promise<void> | void;

  onlineUsers?: { username: string }[];

  withCorrectionsCount: number;
  validatedImagesCount: number;
  totalCompleted: number;
  totalImages: number;

  loading?: boolean;
  initialCollapsed?: boolean;
  composeLocked?: boolean;
  statusLocked?: boolean;
};

const LS_KEY = "photoreview:sidepanel:collapsed";

export default function SidePanel({
  name,
  isValidated,
  threads,
  activeThreadId,
  onValidateSku,
  onUnvalidateSku,
  onDeleteThread,
  onFocusThread,
  onToggleThreadStatus,
  onlineUsers = [],
  withCorrectionsCount,
  validatedImagesCount,
  totalCompleted,
  composeLocked,
  statusLocked,
  totalImages,
  loading = false,
  initialCollapsed = false,
}: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);

  useEffect(() => {
    try {
      const v = localGet(LS_KEY);
      if (v != null) setCollapsed(v === "1");
    } catch {
      toastStorageOnce("leer la preferencia del panel");
    }
  }, []);
  useEffect(() => {
    try {
      localSet(LS_KEY, collapsed ? "1" : "0");
    } catch {
      toastStorageOnce("guardar la preferencia del panel");
    }
  }, [collapsed]);

  const selected = useMemo(
    () =>
      activeThreadId != null
        ? threads.find((t) => t.id === activeThreadId) ?? null
        : null,
    [activeThreadId, threads]
  );

  const hasOpenThreads = useMemo(
    () => threads.some((t) => t.status === "pending" || t.status === "reopened"),
    [threads]
  );

  const threadIndex = useMemo(
    () => (activeThreadId ? threads.findIndex((t) => t.id === activeThreadId) + 1 : 0),
    [threads, activeThreadId]
  );

  
  return (
    <aside
      className={`${styles.panel} ${collapsed ? styles.isCollapsed : ""}`}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="Panel de revisión"
    >
      {collapsed && (
        <div className={styles.rail} aria-hidden>
          <div className={styles.railHeader}>
            <span className={styles.dotMini} />
            <span className={styles.presenceText}>{onlineUsers.length} en línea</span>
          </div>
          <button
            type="button"
            className={styles.railExpandBtn}
            onClick={() => setCollapsed(false)}
            aria-label="Abrir panel"
            title="Abrir panel"
          >
            ❮
          </button>
        </div>
      )}

      {!collapsed && (
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.presenceWrap}>
              <span className={styles.dotMini} />
              <span className={styles.presenceText}>{onlineUsers.length} en línea</span>
            </div>
            <button
              type="button"
              className={styles.collapseBtn}
              onClick={() => setCollapsed(true)}
              aria-label="Colapsar panel"
              title="Colapsar panel"
            >
              ❯
            </button>
          </header>

          <span className={styles.fileName}>Revisión de: {name}</span>
          {isValidated && <span className={styles.validatedBadge}>Validada</span>}

          <div className={styles.validationButtons}>
            {!isValidated ? (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.green}`}
                onClick={onValidateSku}
                disabled={hasOpenThreads}
                title={
                  hasOpenThreads
                    ? "Hay hilos pendientes o reabiertos. Resuélvelos para validar el SKU."
                    : "Validar SKU"
                }
              >
                ✓ Validar SKU
              </button>
            ) : (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.orange}`}
                onClick={onUnvalidateSku}
                title="Quitar validación del SKU"
              >
                ↩️ Quitar validación
              </button>
            )}
          </div>

          <div className={styles.divider}>
            <span>Chat del punto seleccionado</span>
          </div>

          {loading ? (
            <div className={styles.loaderWrap}>
              <div className={styles.loaderSpinner} />
              <div className={styles.loaderText}>Cargando anotaciones…</div>
            </div>
          ) : (
            <div className={styles.annotationsList}>
              {!selected ? (
                <p className={styles.noAnnotations}>
                  Selecciona un punto en la imagen para ver su chat.
                </p>
              ) : (
                <ThreadChat
                  activeThread={selected}
                  threadIndex={threadIndex}
                  onFocusThread={onFocusThread}
                  onToggleThreadStatus={onToggleThreadStatus}
                  onDeleteThread={onDeleteThread}
                  composeLocked={composeLocked}
                  statusLocked={statusLocked}
                />
              )}
            </div>
          )}

          <section className={styles.reviewSummary} aria-label="Progreso de revisión">
            <h4>Progreso</h4>
            <div className={styles.progressInfo}>
              <span>Con correcciones</span>
              <strong className={styles.countWarn}>{withCorrectionsCount}</strong>
            </div>
            <div className={styles.progressInfo}>
              <span>Validadas</span>
              <strong className={styles.countOk}>{validatedImagesCount}</strong>
            </div>
            <div className={styles.progressInfo}>
              <span>Completadas</span>
              <strong>
                {totalCompleted} / {totalImages}
              </strong>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
