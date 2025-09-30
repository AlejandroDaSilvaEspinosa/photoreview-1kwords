"use client";

import React, { useEffect, useMemo, useState } from "react";
import styles from "./SidePanel.module.css";
import ThreadChat from "./ThreadChat";
import type {
  Thread,
  ThreadStatus,
  SkuWithImagesAndStatus,
} from "@/types/review";
import { localGet, localSet, toastStorageOnce } from "@/lib/storage";

type SkuStatus =
  | "pending_validation"
  | "needs_correction"
  | "validated"
  | "reopened";

type Props = {
  name: string;

  /** Estado del SKU (fuente de verdad) */
  skuStatus: SkuStatus;

  /** Threads de la IMAGEN visible (el panel es por imagen) */
  threads: Thread[];
  activeThreadId: number | null;

  /** Acciones sobre SKU */
  onValidateSku: () => void;
  onUnvalidateSku: () => void;

  /** Operaciones de chat/thread */
  onAddThreadMessage: (threadId: number, text: string) => Promise<void> | void;
  onDeleteThread: (id: number) => void;
  onFocusThread: (id: number | null) => void;
  onToggleThreadStatus: (
    threadId: number,
    next: ThreadStatus
  ) => Promise<void> | void;

  onlineUsers?: { username: string }[];

  /** Métricas del SKU */
  imagesReadyToValidate: number; // imágenes finished (listas para validar)
  totalImages: number;

  /** Flags/UI */
  loading?: boolean;
  initialCollapsed?: boolean;
  composeLocked?: boolean;
  statusLocked?: boolean;
};

const LS_KEY = "photoreview:sidepanel:collapsed";

export default function SidePanel({
  name,
  skuStatus,
  threads,
  activeThreadId,
  onValidateSku,
  onUnvalidateSku,
  onAddThreadMessage,
  onDeleteThread,
  onFocusThread,
  onToggleThreadStatus,
  onlineUsers = [],
  imagesReadyToValidate,
  totalImages,
  loading = false,
  initialCollapsed = false,
  composeLocked,
  statusLocked,
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
  const threadIndex = useMemo(
    () =>
      activeThreadId
        ? threads.findIndex((t) => t.id === activeThreadId) + 1
        : 0,
    [threads, activeThreadId]
  );

  // Contadores por estado (de la imagen actual)
  const threadsPending = useMemo(
    () => threads.filter((t) => t.status === "pending").length,
    [threads]
  );
  const threadsReopened = useMemo(
    () => threads.filter((t) => t.status === "reopened").length,
    [threads]
  );
  const threadsCorrected = useMemo(
    () => threads.filter((t) => t.status === "corrected").length,
    [threads]
  );

  const isValidated = skuStatus === "validated";
  const canValidate = skuStatus === "pending_validation";
  const showReopen = skuStatus === "validated" || skuStatus === "reopened";

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
            <span className={styles.presenceText}>
              {onlineUsers.length} en línea
            </span>
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
              <span className={styles.presenceText}>
                {onlineUsers.length} en línea
              </span>
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
          {isValidated && (
            <span className={styles.validatedBadge}>Validada</span>
          )}

          <div className={styles.validationButtons}>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.green}`}
              onClick={onValidateSku}
              disabled={!canValidate}
              title={
                canValidate
                  ? "Validar SKU"
                  : "Sólo disponible cuando el SKU está pendiente de validación"
              }
            >
              ✓ Validar SKU
            </button>

            {showReopen && (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.orange}`}
                onClick={onUnvalidateSku}
                title="Reabrir SKU para continuar trabajando"
              >
                ↩️ Reabrir SKU
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
              {isValidated ? (
                <p className={styles.noAnnotations}>
                  Este SKU está <b>validado</b>. No puedes añadir hilos ni
                  mensajes hasta que se reabra.
                </p>
              ) : !selected ? (
                <p className={styles.noAnnotations}>
                  Selecciona un punto en la imagen para ver su chat.
                </p>
              ) : (
                <ThreadChat
                  activeThread={selected}
                  threadIndex={threadIndex}
                  onAddThreadMessage={onAddThreadMessage}
                  onFocusThread={onFocusThread}
                  onToggleThreadStatus={onToggleThreadStatus}
                  onDeleteThread={onDeleteThread}
                  composeLocked={composeLocked || isValidated}
                  statusLocked={statusLocked || isValidated}
                />
              )}
            </div>
          )}

          <section
            className={styles.reviewSummary}
            aria-label="Progreso de revisión"
          >
            <h4>Progreso</h4>

            {/* Imágenes listas para validar (de TODO el SKU) */}
            <div className={styles.progressInfo}>
              <span>Imágenes listas para validar</span>
              <strong className={styles.countOk}>
                {imagesReadyToValidate} / {totalImages}
              </strong>
            </div>

            {/* Threads de la imagen actual */}
            <div className={styles.progressInfo}>
              <span>Correcciones pendientes</span>
              <strong className={styles.countWarn}>{threadsPending}</strong>
            </div>
            <div className={styles.progressInfo}>
              <span>Correcciones reabiertas</span>
              <strong className={styles.countWarn}>{threadsReopened}</strong>
            </div>
            <div className={styles.progressInfo}>
              <span>Correcciones realizadas</span>
              <strong className={styles.countOk}>{threadsCorrected}</strong>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
