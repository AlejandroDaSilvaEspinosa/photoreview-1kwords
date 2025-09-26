// src/components/images/ThreadChat.tsx
"use client";

import React, { useRef, useEffect, useMemo, useState, useCallback } from "react";
import styles from "./ThreadChat.module.css";
import ReactMarkdown from "react-markdown";
import { Thread, ThreadMessage, ThreadStatus } from "@/types/review";
import AutoGrowTextarea from "./AutoGrowTextarea";
import { useSupabaseUserId } from "@/hooks/useSupabaseUserId";
import { toastError } from "@/hooks/useToast";

type DeliveryState = "sending" | "sent" | "delivered" | "read";

/* ========= UnreadDividerAlign (memo por hilo) ========= */
const UnreadDividerAlign = React.memo(
  function UnreadDividerAlign({
    containerRef,
    label,
    threadId,
    offsetPx = 16,
    behavior = "auto",
  }: {
    containerRef: React.RefObject<HTMLDivElement | null>;
    label: string;
    threadId: number;
    offsetPx?: number;
    behavior?: ScrollBehavior;
  }) {
    console.log("test")
    const sepRef = useRef<HTMLDivElement | null>(null);
    const doneForThreadRef = useRef<{ id: number | null; done: boolean }>({
      id: null,
      done: false,
    });
    const raf1Ref = useRef<number | null>(null);
    const raf2Ref = useRef<number | null>(null);

    useEffect(() => {
      if (doneForThreadRef.current.id !== threadId) {
        doneForThreadRef.current = { id: threadId, done: false };
      }
      if (doneForThreadRef.current.done) return;

      const cont = containerRef.current;
      const el = sepRef.current;
      if (!cont || !el) return;

      raf1Ref.current = requestAnimationFrame(() => {
        raf2Ref.current = requestAnimationFrame(() => {
          const contRect = cont.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const delta = elRect.top - contRect.top - offsetPx;
          const targetTop = Math.max(
            0,
            Math.min(cont.scrollHeight - cont.clientHeight, cont.scrollTop + delta)
          );

          if (typeof (cont as any).scrollTo === "function" && behavior) {
            (cont as any).scrollTo({ top: targetTop, behavior });
          } else {
            cont.scrollTop = targetTop;
          }
          doneForThreadRef.current.done = true;
        });
      });

      return () => {
        if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current);
        if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current);
      };
    }, [threadId, containerRef, offsetPx, behavior]);

    return (
      <div
        ref={sepRef}
        className={styles.unreadDivider}
        role="separator"
        aria-label={label}
        title={label}
        data-unread-cutoff="true"
      >
        <span className={styles.unreadDividerLine} />
        <span className={styles.unreadDividerLabel}>{label}</span>
        <span className={styles.unreadDividerLine} />
      </div>
    );
  },
  (prev, next) => prev.threadId === next.threadId
);

/* ================================ Props ================================ */
type Props = {
  activeThread: Thread;
  /** Calculado en el padre para no pasar `threads` completos */
  threadIndex: number;
  onAddThreadMessage: (threadId: number, text: string) => Promise<void> | void;
  onFocusThread: (threadId: number | null) => void;
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => void;
  onDeleteThread: (id: number) => void;
};

/* ============================ Componente ============================ */
function ThreadChatInner({
  activeThread,
  threadIndex,
  onAddThreadMessage,
  onFocusThread,
  onToggleThreadStatus,
  onDeleteThread,
}: Props) {
  // Drafts por hilo
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const setDraft = useCallback((threadId: number, value: string | ((prev: string) => string)) => {
    setDrafts((prev) => ({
      ...prev,
      [threadId]:
        typeof value === "function" ? (value as any)(prev[threadId] ?? "") : value,
    }));
  }, []);
  const getDraft = useCallback((threadId: number) => drafts[threadId] ?? "", [drafts]);
  const clearDraft = useCallback((threadId: number) => {
    setDrafts((prev) => {
      const { [threadId]: _omit, ...rest } = prev;
      return rest;
    });
  }, []);

  const listRef = useRef<HTMLDivElement | null>(null);
  const selfAuthId = useSupabaseUserId();

  // Helpers estado hilo
  const nextStatus = useCallback(
    (s: ThreadStatus): ThreadStatus => (s === "corrected" ? "reopened" : "corrected"),
    []
  );

  const colorByStatus = useCallback(
    (s: ThreadStatus) =>
      s === "corrected"
        ? "#0FA958"
        : s === "reopened"
        ? "#FFB000"
        : s === "deleted"
        ? "#666"
        : "#FF0040",
    []
  );

  const isMine = useCallback(
    (m: ThreadMessage) => {
      const meta = (m.meta || {}) as any;
      if (meta.isMine === true) return true;
      if ((meta.localDelivery as DeliveryState | undefined) === "sending") return true;
      const createdByAuthId = (m as any).createdByAuthId as string | null | undefined;
      return !!selfAuthId && !!createdByAuthId && createdByAuthId === selfAuthId;
    },
    [selfAuthId]
  );

  const handleSend = useCallback(async () => {
    const id = activeThread?.id;
    if (!id) return;
    const draft = getDraft(id).trim();
    if (!draft) return;
    clearDraft(id);
    try {
      await onAddThreadMessage(id, draft);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = listRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      });
    } catch (e) {
      toastError(e, {
        title: "No se pudo enviar el mensaje",
        fallback: "Revisa tu conexión e inténtalo de nuevo.",
      });
    }
  }, [activeThread?.id, getDraft, clearDraft, onAddThreadMessage]);

  // Fechas/formatos
  const dateKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const labelFor = (d: Date) => {
    const now = new Date();
    const todayKey = dateKey(now);
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    const yestKey = dateKey(yest);
    const k = dateKey(d);
    if (k === todayKey) return "Hoy";
    if (k === yestKey) return "Ayer";
    return d.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  };
  const timeHHmm = (d: Date) =>
    d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false });

  // Snapshot de no-leídos
  type UnreadSnap = {
    tid: number;
    cutoffId: number | null;
    count: number;
    idsToRead: number[];
  };
  const [snap, setSnap] = useState<UnreadSnap | null>(null);

  // Sticky por hilo
  const stickyUnreadRef = useRef<{ cutoffId: number | null; count: number } | null>(null);
  const stickyLockedRef = useRef<boolean>(false);
  const lastSeenMessageIdRef = useRef<number | null>(null);
  // Reset al cambiar de hilo
  useEffect(() => {
    setSnap(null);
    prevDeliveryRef.current.clear();
    stickyUnreadRef.current = null;
    stickyLockedRef.current = false;
    // Agregar: resetear el tracking de mensajes vistos
    lastSeenMessageIdRef.current = null;
  }, [activeThread?.id]);


  const computeSnap = useCallback((): UnreadSnap | null => {
    const tid = activeThread?.id;
    const list = activeThread?.messages ?? [];
    if (!tid || !list.length) return null;

    let count = 0;
    let cutoffId: number | null = null;
    const idsToRead: number[] = [];

    for (const m of list) {
      const sys =
        !!m.isSystem ||
        (m.createdByName || "").toLowerCase() === "system" ||
        (m.createdByName || "").toLowerCase() === "sistema";
      if (sys) continue;
      if (isMine(m)) continue;
      const delivery = (m.meta?.localDelivery ?? "sent") as DeliveryState;
      if (delivery !== "read") {
        count++;
        if (cutoffId == null) cutoffId = (m.id as number) ?? null;
        const mid = (m.id as number) ?? -1;
        if (Number.isFinite(mid) && mid >= 0) idsToRead.push(mid);
      }
    }
    return { tid, cutoffId, count, idsToRead };
  }, [activeThread?.id, activeThread?.messages, isMine]);

  useEffect(() => {
    const s = computeSnap();
    setSnap(s);

// Lógica mejorada para el sticky:
  if (!stickyLockedRef.current && s && s.count > 0) {
    // Primera vez que hay mensajes no leídos: congelar el divisor
    stickyUnreadRef.current = {
      cutoffId: s.cutoffId,
      count: s.count
    };
    stickyLockedRef.current = true;
    
    // Marcar el último mensaje visto en este momento
    const list = activeThread?.messages ?? [];
    const lastSeenIdx = list.findIndex(m => m.id === s.cutoffId) - 1;
    if (lastSeenIdx >= 0) {
      lastSeenMessageIdRef.current = list[lastSeenIdx].id as number;
    }
  } else if (stickyLockedRef.current && s) {
    // Ya hay un sticky congelado, pero verificar si hay NUEVOS mensajes no leídos
    const list = activeThread?.messages ?? [];
    const lastSeen = lastSeenMessageIdRef.current;
    
    if (lastSeen) {
      // Buscar mensajes nuevos DESPUÉS del último visto
      const lastSeenIdx = list.findIndex(m => m.id === lastSeen);
      if (lastSeenIdx >= 0) {
        let newUnreadCount = 0;
        let newCutoffId = stickyUnreadRef.current?.cutoffId ?? null;
        
        // Contar nuevos mensajes no leídos después del último visto
        for (let i = lastSeenIdx + 1; i < list.length; i++) {
          const m = list[i];
          const sys = !!m.isSystem || 
                     (m.createdByName || "").toLowerCase() === "system" ||
                     (m.createdByName || "").toLowerCase() === "sistema";
          if (sys) continue;
          if (isMine(m)) continue;
          
          const delivery = (m.meta?.localDelivery ?? "sent") as DeliveryState;
          if (delivery !== "read") {
            if (newCutoffId === null || newCutoffId === stickyUnreadRef.current?.cutoffId) {
              // Establecer nuevo cutoff en el primer mensaje nuevo no leído
              newCutoffId = m.id as number;
            }
            newUnreadCount++;
          }
        }
        
        // Si hay nuevos mensajes no leídos, actualizar el sticky
        if (newUnreadCount > 0 && newCutoffId !== stickyUnreadRef.current?.cutoffId) {
          stickyUnreadRef.current = {
            cutoffId: newCutoffId,
            count: s.count // Usar el conteo total actual
          };
        }
      }
    }
  }
  }, [computeSnap]);

  // Filas de render
  type Row =
    | { kind: "divider"; key: string; label: string }
    | { kind: "unread"; key: string; label: string }
    | { kind: "msg"; msg: ThreadMessage };

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    let lastKey: string | null = null;
    const list = activeThread?.messages ?? [];

    const locked = stickyLockedRef.current;
    const sticky = stickyUnreadRef.current;
    const cutId = locked ? sticky?.cutoffId ?? null : snap?.cutoffId ?? null;
    const unreadCount = locked ? sticky?.count ?? 0 : snap?.count ?? 0;

    for (const m of list) {
      const dt = new Date(m.createdAt);
      const k = dateKey(dt);
      if (k !== lastKey) {
        out.push({ kind: "divider", key: k, label: labelFor(dt) });
        lastKey = k;
      }
      if (cutId != null && m.id === cutId) {
        out.push({
          kind: "unread",
          key: `unread-${m.id}`,
          label:
            unreadCount && unreadCount > 0
              ? `Mensajes no leídos (${unreadCount})`
              : `Mensajes no leídos`,
        });
      }
      out.push({ kind: "msg", msg: m });
    }
    return out;
  }, [activeThread?.id, activeThread?.messages, snap]);

  // ---- Scroll al final si NO hay divisor al abrir (una vez por hilo)
  const didInitialBottomRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const container = listRef.current;
    const tid = activeThread?.id;
    if (!container || tid == null) return;
    if (didInitialBottomRef.current.has(tid)) return;

    const locked = stickyLockedRef.current;
    const hasFrozen = !!(stickyUnreadRef.current && stickyUnreadRef.current.cutoffId != null);
    const hasSnap = !!(snap && snap.tid === tid && snap.count > 0 && snap.cutoffId != null);
    const hasUnreadDivider = locked ? hasFrozen : hasSnap;

    if (!hasUnreadDivider) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = listRef.current;
          if (el) el.scrollTop = el.scrollHeight;
          didInitialBottomRef.current.add(tid);
        });
      });
    }
  }, [activeThread?.id, snap]);

  // ---- Autoscroll en mensaje nuevo
  const lastMsgKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const list = activeThread?.messages ?? [];
    const last = list[list.length - 1];
    const currentKey = last ? `${last.id}|${last.createdAt}|${list.length}` : null;
    const prevKey = lastMsgKeyRef.current;
    lastMsgKeyRef.current = currentKey;

    if (!prevKey || !currentKey || prevKey === currentKey) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }, [activeThread?.messages]);

  // ---- Marcar leído
  useEffect(() => {
    const tid = activeThread?.id;
    if (!tid || !snap) return;
    if (!snap.idsToRead.length) return;

    (async () => {
      try {
        await fetch("/api/messages/receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: snap.idsToRead, mark: "read" }),
        });
      } catch (e) {
        toastError(e, {
          title: "No se pudo confirmar la lectura",
          fallback: "Reintentaremos automáticamente.",
        });
      }
    })();
  }, [activeThread?.id, snap]);

  // Render
  const prevDeliveryRef = useRef<Map<number, DeliveryState>>(new Map());

  const toggleLabel = useCallback(
    (s: ThreadStatus) => (s === "corrected" ? "Reabrir hilo" : "Validar correcciones"),
    []
  );

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
          <span
            className={styles.dotMini}
            style={{ background: colorByStatus(activeThread.status) }}
          />
          Hilo #{threadIndex}
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
        {rows.map((row, i) => {
          if (row.kind === "divider") {
            return (
              <div
                key={`div-${row.key}-${i}`}
                className={styles.dayDivider}
                role="separator"
                aria-label={row.label}
              >
                <span className={styles.dayDividerLabel}>{row.label}</span>
              </div>
            );
          }

          if (row.kind === "unread") {
            return (
              <UnreadDividerAlign
                key={`unread-thread-${activeThread.id}`}
                containerRef={listRef}
                label={row.label}
                offsetPx={16}
                behavior="auto"
                threadId={activeThread.id}
              />
            );
          }

          const m = row.msg;
          const meta = (m.meta || {}) as any;
          const delivery = (meta.localDelivery as DeliveryState | undefined) ?? "sent";
          const sys =
            !!m.isSystem ||
            (m.createdByName || "").toLowerCase() === "system" ||
            (m.createdByName || "").toLowerCase() === "sistema";
          const mine = isMine(m);

          const ticks =
            delivery === "sending"
              ? "⏳"
              : delivery === "read"
              ? "✓✓"
              : delivery === "delivered"
              ? "✓✓"
              : "✓";

          const prev = prevDeliveryRef.current.get(m.id as number);
          const justDelivered = prev === "sent" && (delivery === "delivered" || delivery === "read");
          const justRead = prev !== "read" && delivery === "read";
          prevDeliveryRef.current.set(m.id as number, delivery);

          const dt = new Date(m.createdAt);
          const hhmm = timeHHmm(dt);

          return (
            <div
              key={m.id}
              className={
                sys
                  ? `${styles.bubble} ${styles.system}`
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
                  <span className={styles.time}>{hhmm}</span>
                  {!sys && mine && (
                    <span
                      className={`${styles.ticks} ${
                        delivery === "read" ? styles.read : ""
                      } ${justDelivered ? styles.justDelivered : ""} ${
                        justRead ? styles.justRead : ""
                      }`}
                      aria-live="polite"
                      aria-label={
                        delivery === "read"
                          ? "Leído"
                          : delivery === "delivered"
                          ? "Entregado"
                          : delivery === "sent"
                          ? "Enviado"
                          : "Enviando"
                      }
                    >
                      {ticks}
                    </span>
                  )}
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
        <button onClick={handleSend} title="Enviar mensaje">
          Enviar
        </button>
      </div>

      <div className={styles.changeStatusBtnWrapper}>
        <button
          className={`${styles.changeStatusBtn} ${
            styles[`${activeThread.status === "corrected" ? "orange" : "green"}`]
          }`}
          onClick={() => {
            try {
              onToggleThreadStatus(
                activeThread.id,
                nextStatus(activeThread.status)
              );
            } catch (e) {
              toastError(e, {
                title: "No se pudo cambiar el estado del hilo",
                fallback: "Vuelve a intentarlo en unos segundos.",
              });
            }
          }}
          title={toggleLabel(activeThread.status)}
        >
          {toggleLabel(activeThread.status)}
        </button>

        <button
          title="Borrar hilo"
          className={`${styles.red} ${styles.deleteThreadBtn}`}
          onClick={() => {
            try {
              onDeleteThread(activeThread.id);
            } catch (e) {
              toastError(e, {
                title: "No se pudo borrar el hilo",
                fallback: "Comprueba tu conexión e inténtalo de nuevo.",
              });
            }
          }}
        >
          🗑
        </button>
      </div>
    </div>
  );
}

/* ============================ Memo fuerte del chat ============================ */
function messagesSignature(list: ThreadMessage[] = []): string {
  const L = list.length;
  const start = Math.max(0, L - 20);
  const parts: string[] = [];
  for (let i = start; i < L; i++) {
    const m = list[i] as any;
    const del = (m?.meta?.localDelivery as DeliveryState | undefined) ?? "sent";
    parts.push(`${m?.id ?? "?"}:${del}:${m?.createdAt ?? "?"}`);
  }
  return parts.join("|");
}

function areEqual(prev: any, next: any) {
  if (prev.activeThread.id !== next.activeThread.id) return false;
  if (prev.activeThread.status !== next.activeThread.status) return false;

  const prevSig = messagesSignature(prev.activeThread.messages);
  const nextSig = messagesSignature(next.activeThread.messages);
  if (prevSig !== nextSig) return false;

  if (prev.threadIndex !== next.threadIndex) return false;

  return true;
}

export default React.memo(ThreadChatInner, areEqual);
