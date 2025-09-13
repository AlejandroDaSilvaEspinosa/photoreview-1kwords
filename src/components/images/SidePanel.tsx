"use client";

import React, { useEffect, useRef, useState } from "react";
import styles from "./SidePanel.module.css";
import { format } from "timeago.js";
import "@/lib/timeago";

// Tipos mínimos que usamos aquí
export type ThreadStatus = "pending" | "corrected" | "reopened";
export type Message = {
  id: number;
  text: string;
  createdAt: string;
  createdByName?: string | null;
};
export type Thread = {
  id: number;
  x: number;
  y: number;
  status: ThreadStatus;
  messages: Message[];
};

type Props = {
  name: string | null;
  /** Habilita/oculta badge de validada; la validación real la gestiona el padre */
  isValidated: boolean;

  /** Hilos (puntos) de la imagen actual con sus mensajes */
  threads: Thread[];

  /** Marcar todo el SKU como validado (solo se habilita cuando no hay hilos abiertos) */
  onValidateSku: () => void;

  /** Quitar estado de validado del SKU */
  onUnvalidateSku: () => void;

  /** Añadir mensaje a un hilo (auto-guardado en el padre) */
  onAddMessage: (threadId: number, text: string) => Promise<void> | void;

  /** Eliminar un hilo completo */
  onDeleteThread: (threadId: number) => void;

  /** Foco/scroll visual a un hilo */
  onFocusThread: (id: number) => void;

  /** Cambiar estado de un hilo */
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => Promise<void> | void;

  /** Presencia */
  onlineUsers?: { username: string }[];

  /** Nombre de usuario actual para pintar mis mensajes a la derecha */
  currentUsername?: string;

  /** Métricas del progreso global (para el resumen) */
  withCorrectionsCount: number;
  validatedImagesCount: number;
  totalCompleted: number;
  totalImages: number;
};

function normalize(s?: string | null) {
  return (s ?? "").trim().toLowerCase();
}

export default function SidePanel({
  name,
  isValidated,
  threads,
  onValidateSku,
  onUnvalidateSku,
  onAddMessage,
  onDeleteThread,
  onFocusThread,
  onToggleThreadStatus,
  onlineUsers = [],
  currentUsername,
  withCorrectionsCount,
  validatedImagesCount,
  totalCompleted,
  totalImages,
}: Props) {
  // borradores por hilo (input del chat)
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const listsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  const setListRef =
    (threadId: number) => (el: HTMLDivElement | null) => {
      if (!el) listsRef.current.delete(threadId);
      else listsRef.current.set(threadId, el);
    };

  // auto-scroll cada vez que cambian los mensajes
  useEffect(() => {
    for (const [, box] of listsRef.current) {
      requestAnimationFrame(() => {
        box.scrollTop = box.scrollHeight;
      });
    }
  }, [threads]);

  const isMine = (author?: string | null) => {
    const me = normalize(currentUsername);
    const a = normalize(author);
    return !a || (!!me && a === me);
  };

  // un hilo está "abierto" si no está corregido
  const hasOpenThreads = threads.some(
    (t) => t.status === "pending" || t.status === "reopened"
  );

  const handleSend = async (threadId: number) => {
    const text = (drafts[threadId] ?? "").trim();
    if (!text) return;
    await onAddMessage(threadId, text);
    setDrafts((d) => ({ ...d, [threadId]: "" }));
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

          {isValidated && (
            <span className={styles.validatedBadge}>✅ Validada</span>
          )}
        </div>

        {/* Botón principal de validación de SKU */}
        <div className={styles.validationButtons}>
          {!isValidated ? (
            <button
              type="button"
              className={styles.validateButton}
              onClick={onValidateSku}
              disabled={hasOpenThreads} // solo habilitado si TODO está corregido
              title={
                hasOpenThreads
                  ? "Hay hilos pendientes o reabiertos. Resuélvelos para validar el SKU."
                  : "Validar SKU"
              }
            >
              ✅ Validar SKU
            </button>
          ) : (
            <button
              type="button"
              className={styles.unvalidateButton}
              onClick={onUnvalidateSku}
            >
              ↩️ Quitar validación del SKU
            </button>
          )}
        </div>

        <div className={styles.divider}>
          <span>Chat de correcciones por punto</span>
        </div>

        <div className={styles.annotationsList}>
          {threads.length === 0 && (
            <p className={styles.noAnnotations}>
              Haz clic en un punto de la imagen para iniciar un hilo de chat.
            </p>
          )}

          {threads.map((th, idx) => {
            const pillText =
              th.status === "pending"
                ? "Pendiente"
                : th.status === "reopened"
                ? "Reabierto"
                : "Corregido";

            const toggleLabel =
              th.status === "corrected" ? "Reabrir" : "Marcar corregido";

            return (
              <div key={th.id} className={styles.annotationItem}>
                <div className={styles.annotationHeader}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className={styles.annotationNumber}>{idx + 1}</span>
                    {/* Pill de estado */}
                    <span
                      className={styles.validatedBadge}
                      style={{
                        background:
                          th.status === "corrected"
                            ? "#00AA00"
                            : th.status === "reopened"
                            ? "#FFB000"
                            : "#FF0040",
                      }}
                    >
                      {pillText}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className={styles.validateButton}
                      style={{
                        background: th.status === "corrected" ? "#FF6600" : "#00AA00",
                      }}
                      onClick={() => onToggleThreadStatus(th.id, nextStatus(th.status))}
                    >
                      {toggleLabel}
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteThread(th.id)}
                      className={styles.deleteAnnotationBtn}
                      aria-label="Eliminar hilo"
                      title="Eliminar hilo"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Lista de mensajes (chat) */}
                <div
                  className={styles.chatList}
                  ref={setListRef(th.id)}
                  onFocus={() => onFocusThread(th.id)}
                >
                  {(th.messages ?? []).map((m) => {
                    const mine = isMine(m.createdByName);
                    return (
                      <div
                        key={m.id}
                        className={`${styles.bubble} ${
                          mine ? styles.mine : styles.theirs
                        }`}
                      >
                        <div className={styles.bubbleText}>{m.text}</div>
                        <div className={styles.bubbleMeta}>
                          <span className={styles.author}>
                            {m.createdByName || "Usuario"}
                          </span>
                          <span className={styles.timeago}>
                            {format(m.createdAt, "es")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Composer (enviar mensaje) */}
                <div className={styles.chatComposer}>
                  <input
                    type="text"
                    className={styles.chatInput}
                    placeholder="Escribe un mensaje…"
                    value={drafts[th.id] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [th.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend(th.id);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={styles.sendButton}
                    onClick={() => handleSend(th.id)}
                  >
                    Enviar
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Resumen de progreso */}
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
