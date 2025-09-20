"use client";

import React, { useEffect, useRef, useState } from "react";
import styles from "./SidePanel.module.css";
import { format } from "timeago.js";
import "@/lib/timeago";
import ReactMarkDown from "react-markdown"
import AutoGrowTextarea from "../AutoGrowTextarea"
import ThreadChat from "./ThreadChat";

import type { Thread, ThreadMessage, ThreadStatus } from "@/types/review";


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
  currentUsername?: string;

  withCorrectionsCount: number;
  validatedImagesCount: number;
  totalCompleted: number;
  totalImages: number;

  /** loading global de anotaciones */
  loading?: boolean;
};

function normalize(s?: string | null) {
  return (s ?? "").trim().toLowerCase();
}

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
  currentUsername,
  withCorrectionsCount,
  validatedImagesCount,
  totalCompleted,
  totalImages,
  loading = false,
}: Props) {
  const selected =
    activeThreadId != null ? threads.find((t) => t.id === activeThreadId) ?? null : null;

  const selectedIndex =
    selected ? Math.max(0, threads.findIndex((t) => t.id === selected.id)) : -1;

    // estado
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const listRef = useRef<HTMLDivElement | null>(null);

  const setDraft = (threadId: number, value: string | ((prev: string) => string)) => {
    setDrafts(prev => ({
        ...prev,
        [threadId]:
          typeof value === "function" ? value(prev[threadId] ?? "") : value,
      }));
  };
  const getDraft = (threadId: number) => drafts[threadId] ?? "";

  const clearDraft = (threadId: number) => {
    setDrafts(prev => {
      const { [threadId]: _omit, ...rest } = prev;
      return rest; // elimina la clave para no crecer sin límite
    });
  };
  useEffect(() => {
    if (!selected) return;
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, [selected?.messages, selected?.id]);

  useEffect(() => {
    if(activeThreadId){
      getDraft(activeThreadId);
    }
  }, [activeThreadId]);

  const isMine = (author?: string | null) => {
    const me = normalize(currentUsername);
    const a = normalize(author);
    return !a || (!!me && a === me);
  };

  const hasOpenThreads = threads.some(
    (t) => t.status === "pending" || t.status === "reopened"
  );

  const handleSend = async () => {
    if(activeThreadId){
      const draft =  getDraft(activeThreadId)
      if (!selected || !draft.trim()) return;
      clearDraft(activeThreadId)
      await onAddThreadMessage(selected.id, draft.trim());
    }
  };

  const nextStatus = (s: ThreadStatus): ThreadStatus =>
    s === "corrected" ? "reopened" : "corrected";
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

        {/* Loader elegante mientras cargan anotaciones */}
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
                isMine={isMine}
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
