"use client";
import React, { useEffect, useRef, useState } from "react";
import styles from "./SidePanel.module.css";
import type { AnnotationThread } from "@/types/review";
import { format } from "timeago.js";
import "@/lib/timeago";

type Props = {
  name: string | null;
  threads: AnnotationThread[];
  onAddMessage: (threadId: number, text: string) => void;
  onDeleteThread: (threadId: number) => void;
  onFocusThread: (id: number) => void;
  onToggleThreadStatus: (threadId: number, next: "pending" | "corrected" | "reopened") => void;

  // SKU
  canCloseSku: boolean;
  onValidateSku: () => void;

  // presencia
  onlineUsers?: { username: string }[];
  currentUsername?: string;
};

function normalize(s?: string | null) {
  return (s ?? "").trim().toLowerCase();
}

export default function SidePanel({
  name,
  threads,
  onAddMessage,
  onDeleteThread,
  onFocusThread,
  onToggleThreadStatus,
  canCloseSku,
  onValidateSku,
  onlineUsers = [],
  currentUsername,
}: Props) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const listRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const setListRef = (threadId: number) => (el: HTMLDivElement | null) => {
    if (!el) listRefs.current.delete(threadId);
    else listRefs.current.set(threadId, el);
  };

  useEffect(() => {
    threads.forEach((th) => {
      const box = listRefs.current.get(th.id);
      if (box) requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));
    });
  }, [threads]);

  const isMine = (author?: string | null) => {
    const a = normalize(author);
    const me = normalize(currentUsername);
    return !a || (!!me && a === me);
  };

  return (
    <div className={styles.sidePanel}>
      <div className={styles.commentSection}>
        <h3>Revisión de:</h3>
        <div className={styles.currentImageInfo}>
          <span className={styles.fileName}>{name}</span>

          <div className={styles.presenceWrap}>
            <span className={styles.presenceDot} />
            <span className={styles.presenceText}>{onlineUsers.length} en línea</span>
          </div>

          <button
            className={styles.validateSkuButton}
            onClick={onValidateSku}
            disabled={!canCloseSku}
            title={canCloseSku ? "Cerrar revisión del SKU" : "Hay hilos abiertos"}
          >
            Validar SKU
          </button>
        </div>

        <div className={styles.divider}><span>Chat por punto</span></div>

        <div className={styles.annotationsList}>
          {threads.length === 0 && (
            <p className={styles.noAnnotations}>
              Haz clic en un punto de la imagen para iniciar un hilo de chat.
            </p>
          )}

          {threads.map((th, index) => {
            const nextStatus =
              th.status === "pending" ? "corrected" : th.status === "corrected" ? "reopened" : "corrected";

            return (
              <div key={th.id} className={styles.annotationItem}>
                <div className={styles.annotationHeader}>
                  <span className={styles.annotationNumber}>{index + 1}</span>

                  <div className={styles.threadActions}>
                    <span className={`${styles.badge} ${styles[th.status]}`}>{th.status}</span>
                    <button
                      type="button"
                      className={styles.statusButton}
                      onClick={() => onToggleThreadStatus(th.id, nextStatus)}
                    >
                      {th.status === "pending" ? "Marcar corregido" :
                       th.status === "corrected" ? "Reabrir" : "Marcar corregido"}
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

                <div
                  className={styles.chatList}
                  ref={setListRef(th.id)}
                  onFocus={() => onFocusThread(th.id)}
                >
                  {(th.messages ?? []).map((m) => {
                    const author = (m as any)?.createdByName || "Usuario";
                    const mine = isMine((m as any)?.createdByName);
                    return (
                      <div
                        key={m.id}
                        className={`${styles.bubble} ${mine ? styles.mine : styles.theirs}`}
                      >
                        <div className={styles.bubbleText}>{m.text}</div>
                        <div className={styles.bubbleMeta}>
                          <span className={styles.author}>{author}</span>
                          <span className={styles.timeago}>{format(m.createdAt, "es")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

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
                        const text = (drafts[th.id] ?? "").trim();
                        if (text) {
                          onAddMessage(th.id, text);
                          setDrafts((d) => ({ ...d, [th.id]: "" }));
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={styles.sendButton}
                    onClick={() => {
                      const text = (drafts[th.id] ?? "").trim();
                      if (!text) return;
                      onAddMessage(th.id, text);
                      setDrafts((d) => ({ ...d, [th.id]: "" }));
                    }}
                  >
                    Enviar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
