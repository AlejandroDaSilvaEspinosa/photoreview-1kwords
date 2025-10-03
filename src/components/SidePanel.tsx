"use client";

import React, { useEffect, useMemo, useState } from "react";
import styles from "./SidePanel.module.css";
import ThreadChat from "./ThreadChat";
import type { Thread, ThreadStatus } from "@/types/review";
import { localGet, localSet, toastStorageOnce } from "@/lib/storage";

type SkuStatus =
  | "pending_validation"
  | "needs_correction"
  | "validated"
  | "reopened";

type ThreadCounts = {
  pending: number;
  reopened: number;
  corrected: number;
  total: number;
};

type PresenceLike = {
  id?: string;
  username?: string | null;
  displayName?: string | null;
  email?: string | null;
  sessions?: number;
};

type Props = {
  name: string;

  /** Estado del SKU (fuente de verdad) */
  skuStatus: SkuStatus;

  /** Threads de la IMAGEN visible (el panel es por imagen) */
  threads: Thread[];
  activeThreadId: number | null;

  /** Operaciones de chat/thread */
  onAddThreadMessage: (threadId: number, text: string) => Promise<void> | void;
  onDeleteThread: (id: number) => void;
  onFocusThread: (id: number | null) => void;
  onToggleThreadStatus: (
    threadId: number,
    next: ThreadStatus
  ) => Promise<void> | void;

  onlineUsers?: PresenceLike[];

  /** Métricas del SKU (imágenes) */
  imagesReadyToValidate: number; // imágenes finished (listas para validar)
  totalImages: number;

  skuThreadCounts?: ThreadCounts;

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
  skuThreadCounts,
  loading = false,
  initialCollapsed = false,
  composeLocked,
  statusLocked,
}: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);
  const [presenceOpen, setPresenceOpen] = useState<boolean>(false);

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

  const selected =
    useMemo(
      () =>
        activeThreadId != null
          ? threads.find((t) => t.id === activeThreadId) ?? null
          : null,
      [activeThreadId, threads]
    ) || null;

  const threadIndex =
    useMemo(
      () =>
        activeThreadId
          ? threads.findIndex((t) => t.id === activeThreadId) + 1
          : 0,
      [threads, activeThreadId]
    ) || 0;

  // ===== Contadores (preferir TODO el SKU si nos llegan por props) =====
  const fallbackCounts: ThreadCounts = useMemo(() => {
    const pending = threads.filter((t) => t.status === "pending").length;
    const reopened = threads.filter((t) => t.status === "reopened").length;
    const corrected = threads.filter((t) => t.status === "corrected").length;
    const total = threads.length || pending + reopened + corrected; // por si threads filtra "deleted"
    return { pending, reopened, corrected, total };
  }, [threads]);

  const counts: ThreadCounts = skuThreadCounts ?? fallbackCounts;
  const correctedPct = counts.total
    ? (counts.corrected / counts.total) * 100
    : 0;

  const isValidated = skuStatus === "validated";
  const canValidate = skuStatus === "pending_validation";
  const showReopen = skuStatus === "validated" || skuStatus === "reopened";

  // === Presencia: asegurar únicos y mostrar sesiones si vienen
  const presenceList = useMemo(() => {
    const map = new Map<string, PresenceLike>();
    for (const u of onlineUsers) {
      const key =
        (u?.id as string) ||
        (u?.email as string) ||
        (u?.username as string) ||
        (u?.displayName as string) ||
        Math.random().toString(36);
      if (map.has(key)) {
        const cur = map.get(key)!;
        cur.sessions = (cur.sessions ?? 1) + (u.sessions ?? 1);
      } else {
        map.set(key, {
          id: key,
          username: u.username ?? null,
          displayName: u.displayName ?? null,
          email: u.email ?? null,
          sessions: u.sessions ?? 1,
        });
      }
    }
    return Array.from(map.values());
  }, [onlineUsers]);

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
              {presenceList.length} en línea
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
            <div
              className={styles.presenceWrap}
              title="Ver usuarios en línea"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setPresenceOpen((v) => !v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPresenceOpen((v) => !v);
                }
              }}
            >
              <span className={styles.dotMini} />
              <span className={styles.presenceText}>
                {presenceList.length} en línea
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

            {presenceOpen && (
              <div
                className={styles.presenceOverlay}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="Usuarios conectados"
              >
                <ul className={styles.presenceList}>
                  {presenceList.map((u) => {
                    const name =
                      u.displayName ||
                      u.username ||
                      u.email ||
                      (u.id
                        ? `Usuario ${String(u.id).slice(0, 6)}`
                        : "Anónimo");
                    const sessions = u.sessions ?? 1;
                    return (
                      <li key={u.id as string} className={styles.presenceItem}>
                        <span className={styles.userName}>{name}</span>
                        {sessions > 1 && (
                          <span className={styles.sessionBadge}>
                            {sessions}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
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
            <div className={styles.progressHeader}>
              <h4>Progreso</h4>

              {/* Barra estilizada: corregidas (blanco) vs resto (negro) */}
              <div
                className={styles.progressBarWrap}
                title={`${Math.round(correctedPct)}% corregido`}
              >
                <div
                  className={styles.progressBarFill}
                  style={{ width: `${correctedPct || 0}%` }}
                />
              </div>
            </div>

            <div className={styles.progressInfo}>
              <span>Imágenes listas para validar</span>
              <strong className={styles.countOk}>
                {imagesReadyToValidate} / {totalImages}
              </strong>
            </div>

            <div className={styles.progressInfo}>
              <span>Correcciones pendientes + reabiertas</span>
              <strong className={styles.countWarn}>
                {counts.pending + counts.reopened}
              </strong>
            </div>

            <div className={styles.progressInfo}>
              <span>Correcciones realizadas</span>
              <strong className={styles.countOk}>{counts.corrected}</strong>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
