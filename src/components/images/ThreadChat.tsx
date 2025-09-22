"use client";

import React, { useRef, useEffect, useState } from "react";
import styles from "./ThreadChat.module.css";
import ReactMarkdown from "react-markdown";
import { Thread, ThreadMessage, ThreadStatus } from "@/types/review";
import { format } from "timeago.js";
import "@/lib/timeago";
import AutoGrowTextarea from "../AutoGrowTextarea";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Props = {
  activeThread: Thread;
  threads: Thread[];
  onAddThreadMessage: (threadId: number, text: string) => Promise<void> | void;
  onFocusThread: (threadId: number | null) => void;
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => void;
  onDeleteThread: (id: number) => void;
};

type DeliveryState = "sending" | "sent" | "delivered" | "read";

export default function ThreadChat({
  activeThread,
  threads,
  onAddThreadMessage,
  onFocusThread,
  onToggleThreadStatus,
  onDeleteThread,
}: Props) {
  // draft local por hilo
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const listRef = useRef<HTMLDivElement | null>(null);

  // auth uid (auth.users.id)
  const [selfAuthId, setSelfAuthId] = useState<string | null>(null);
  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => setSelfAuthId(data.user?.id ?? null))
      .catch(() => setSelfAuthId(null));
  }, []);

  const nextStatus = (s: ThreadStatus): ThreadStatus =>
    s === "corrected" ? "reopened" : "corrected";
  const toggleLabel = (s: ThreadStatus) =>
    s === "corrected" ? "Reabrir hilo" : "Validar correcciones";
  const colorByNextStatus = (s: ThreadStatus) => (s === "corrected" ? "orange" : "green");
  const colorByStatus = (s: ThreadStatus) =>
    s === "corrected" ? "#0FA958" : s === "reopened" ? "#FFB000" : s === "deleted" ? "#666" : "#FF0040";

  const setDraft = (threadId: number, value: string | ((prev: string) => string)) => {
    setDrafts((prev) => ({
      ...prev,
      [threadId]: typeof value === "function" ? value(prev[threadId] ?? "") : value,
    }));
  };
  const getDraft = (threadId: number) => drafts[threadId] ?? "";
  const clearDraft = (threadId: number) => {
    setDrafts((prev) => {
      const { [threadId]: _omit, ...rest } = prev;
      return rest;
    });
  };

  useEffect(() => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, [activeThread?.messages, activeThread?.id]);

  // isMine SIEMPRE por id: meta.isMine (optimista/merge) OR sending OR createdByAuthId === selfAuthId
  const isMine = (m: ThreadMessage) => {
    const meta = (m.meta || {}) as any;
    if (meta.isMine === true) return true;
    if ((meta.localDelivery as DeliveryState | undefined) === "sending") return true;
    const createdByAuthId = (m as any).createdByAuthId as string | null | undefined;
    return !!selfAuthId && !!createdByAuthId && createdByAuthId === selfAuthId;
  };

  const handleSend = async () => {
    const id = activeThread?.id;
    if (!id) return;
    const draft = getDraft(id);
    if (!draft.trim()) return;
    clearDraft(id);
    await onAddThreadMessage(id, draft.trim());
  };

  return (
    <div
      className={styles.chatDock}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div className={styles.chatHeader}>
        <span>
          <span className={styles.dotMini} style={{ background: colorByStatus(activeThread.status) }} />
          Hilo #{threads.findIndex((x) => x.id === activeThread.id) + 1}
        </span>
        <button
          type="button"
          onClick={() => onFocusThread(null)}
          className={styles.closeThreadChatBtn}
          aria-label="Cerrar hilo"
          title="Cerrar hilo"
        >
          ×
        </button>
      </div>

      <div ref={listRef} className={styles.chatList}>
        {activeThread.messages?.map((m: ThreadMessage) => {
          const mine = isMine(m);
          const meta = (m.meta || {}) as any;
          const delivery = meta.localDelivery as DeliveryState | undefined;
          const sys = !!m.isSystem || (m.createdByName || "").toLowerCase() === "system";

          const ticks =
            delivery === "sending"   ? "⏳" :
            delivery === "read"      ? "✓✓" :
            delivery === "delivered" ? "✓✓"  :
                                       "✓"; // "sent" → ✓

          return (
            <div
              key={m.id}
              className={
                sys ? `${styles.bubble} ${styles.system}`
                    : `${styles.bubble} ${mine ? styles.mine : styles.theirs}`
              }
            >
              <div lang="es" className={styles.bubbleText}>
                <ReactMarkdown>{m.text}</ReactMarkdown>
              </div>
              <div className={styles.bubbleMeta}>
                <span className={styles.author}>
                  {sys ? "Sistema" : mine ? "Tú" : m.createdByName || "Desconocido"}
                </span>
                <span className={styles.messageMeta}>

                  <span className={styles.timeago}>{format(m.createdAt, "es")}</span>
                  {!sys && mine && <span className={`${styles.ticks} ${delivery === "read" && styles.read}` }>{ticks}</span>}
                </span>

              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.composer}>
        <AutoGrowTextarea
          value={activeThread?.id ? getDraft(activeThread?.id) : ""}
          onChange={(v: string) => activeThread.id && setDraft(activeThread.id, v)}
          placeholder="Escribe un mensaje…"
          minRows={1}
          maxRows={5}
          growsUp
          onEnter={handleSend}
        />
        <button onClick={handleSend}>Enviar</button>
      </div>

      <div className={styles.changeStatusBtnWrapper}>
        <button
          className={`${styles.changeStatusBtn} ${styles[`${colorByNextStatus(activeThread.status)}`]}`}
          onClick={() => onToggleThreadStatus(activeThread.id, nextStatus(activeThread.status))}
          title={toggleLabel(activeThread.status)}
        >
          {toggleLabel(activeThread.status)}
        </button>

        <button
          title="Borrar hilo"
          className={`${styles.red} ${styles.deleteThreadBtn}`}
          onClick={() => onDeleteThread(activeThread.id)}
        >
          🗑
        </button>
      </div>
    </div>
  );
}
