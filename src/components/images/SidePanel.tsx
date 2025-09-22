"use client";

import React from "react";
import styles from "./SidePanel.module.css";
import ThreadChat from "./ThreadChat";
import type { Thread, ThreadStatus } from "@/types/review";

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
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => Promise<void> | void;

  onlineUsers?: { username: string }[];

  withCorrectionsCount: number;
  validatedImagesCount: number;
  totalCompleted: number;
  totalImages: number;

  loading?: boolean;
};

export default function SidePanel({
  name,
  isValidated,
  threads,
  activeThreadId,
  onValidateSku,
  onUnvalidateSku,
  onAddThreadMessage,
  onDeleteThread,
  onFocusThread,
  onToggleThreadStatus,
  onlineUsers = [],
  withCorrectionsCount,
  validatedImagesCount,
  totalCompleted,
  totalImages,
  loading = false,
}: Props) {
  const selected =
    activeThreadId != null ? threads.find((t) => t.id === activeThreadId) ?? null : null;

  const hasOpenThreads = threads.some(
    (t) => t.status === "pending" || t.status === "reopened"
  );

  return (
    <div className={styles.sidePanel}>
      <div className={styles.commentSection}>
        <h3>Revisión de:</h3>

        <div className={styles.currentImageInfo}>
          <span>{name}</span>

          <div className={styles.presenceWrap}>
            <span className={styles.presenceDot} />
            <span className={styles.presenceText}>{onlineUsers.length} en línea</span>
          </div>

        {isValidated && <span className={styles.validatedBadge}>✅ Validada</span>}
        </div>

        <div className={styles.validationButtons}>
          {!isValidated ? (
            <button
              type="button"
              className={styles.validateButton}
              onClick={onValidateSku}
              disabled={hasOpenThreads}
              title={
                hasOpenThreads
                  ? "Hay hilos pendientes o reabiertos. Resuélvelos para validar el SKU."
                  : "Validar SKU"
              }
            >
              ✅ Validar SKU
            </button>
          ) : (
            <button type="button" className={styles.unvalidateButton} onClick={onUnvalidateSku}>
              ↩️ Quitar validación del SKU
            </button>
          )}
        </div>

        <div className={styles.divider}>
          <span>Chat del punto seleccionado</span>
        </div>

        {loading && (
          <div className={styles.loaderWrap}>
            <div className={styles.loaderSpinner} />
            <div className={styles.loaderText}>Cargando anotaciones…</div>
          </div>
        )}

        {!loading && (
          <div className={styles.annotationsList}>
            {!selected && (
              <p className={styles.noAnnotations}>
                Selecciona un punto en la imagen para ver su chat.
              </p>
            )}

            {selected && (
              <ThreadChat
                activeThread={selected}
                threads={threads}
                onAddThreadMessage={onAddThreadMessage}
                onFocusThread={onFocusThread}
                onToggleThreadStatus={onToggleThreadStatus}
                onDeleteThread={onDeleteThread}
              />
            )}
          </div>
        )}

        <div className={styles.reviewSummary}>
          <h4>Progreso:</h4>
          <div className={styles.progressInfo}>
            <span>Con correcciones:</span>
            <strong className={styles.commentCount}>{withCorrectionsCount}</strong>
          </div>
          <div className={styles.progressInfo}>
            <span>Validadas:</span>
            <strong className={styles.validatedCount}>{validatedImagesCount}</strong>
          </div>
          <div className={styles.progressInfo}>
            <span>Completadas:</span>
            <strong>
              {totalCompleted} / {totalImages}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}
