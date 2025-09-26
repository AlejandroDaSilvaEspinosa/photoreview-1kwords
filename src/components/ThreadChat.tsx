// src/components/images/ThreadChat.tsx
"use client";

import React, { useRef, useEffect, useMemo, useState, useCallback } from "react";
import styles from "./ThreadChat.module.css";
import ReactMarkdown from "react-markdown";
import { Thread, ThreadMessage, ThreadStatus } from "@/types/review";
import AutoGrowTextarea from "./AutoGrowTextarea";
import { useSupabaseUserId } from "@/hooks/useSupabaseUserId";
import { toastError } from "@/hooks/useToast";
import { sendMessage } from "@/lib/messages/send";
type DeliveryState = "sending" | "sent" | "delivered" | "read";

/* ========= Utilidades scroll ========= */
const NEAR_BOTTOM_PX = 130; // margen para decidir autoscroll con mensaje entrante
function isNearBottom(el: HTMLDivElement | null, slackPx = NEAR_BOTTOM_PX) {
  if (!el) return true;
  const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
  return dist <= slackPx;
}

/* ========= UnreadDividerAlign (alinear una vez por hilo/cutoff) ========= */
const UnreadDividerAlign = React.memo(
  function UnreadDividerAlign({
    containerRef,
    label,
    threadId,
    cutoffId,
    offsetPx = 16,
    behavior = "auto",
  }: {
    containerRef: React.RefObject<HTMLDivElement | null>;
    label: string;
    threadId: number;
    cutoffId: number | null;
    offsetPx?: number;
    behavior?: ScrollBehavior;
  }) {
    const sepRef = useRef<HTMLDivElement | null>(null);
    const doneKeyRef = useRef<string>("");

    useEffect(() => {
      const key = `${threadId}:${cutoffId ?? "none"}`;
      if (doneKeyRef.current === key) return; // nunca re-alinear si ya lo hicimos para este cutoff
      doneKeyRef.current = key;

      const cont = containerRef.current;
      const el = sepRef.current;
      if (!cont || !el) return;
        el.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
    }, [threadId, cutoffId, containerRef, offsetPx, behavior]);

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
  (prev, next) =>
    prev.threadId === next.threadId &&
    prev.cutoffId === next.cutoffId &&
    prev.label === next.label
);

/* ================================ Props ================================ */
type Props = {
  activeThread: Thread;
  composeLocked?: boolean;
  statusLocked?: boolean;
  threadIndex: number;
  onFocusThread: (threadId: number | null) => void;
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => void;
  onDeleteThread: (id: number) => void;
};

/* ============================ Componente ============================ */
function ThreadChatInner({
  activeThread,
  threadIndex,
  onFocusThread,
  onToggleThreadStatus,
  onDeleteThread,
  composeLocked,
  statusLocked
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
  const colorByNextStatus = (s: ThreadStatus) => (s === "corrected" ? "orange" : "green");
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
    const tid = activeThread?.id;
    if (!tid) return;

    const draft = getDraft(tid).trim();
    if (!draft) return;

    clearDraft(tid);

    try {
      // Encola + crea optimista; NO hace falta await.
      sendMessage(tid, draft);

      // Baja al final (mensaje propio). Doble RAF para esperar render del optimista.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = listRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      });
    } catch (e) {
      // Solo capturará errores síncronos (muy raro). Los fallos de red los gestiona el outbox.
      toastError(e, {
        title: "No se pudo encolar el mensaje",
        fallback: "Revisa tu conexión e inténtalo de nuevo.",
      });
    }
  }, [activeThread?.id, getDraft, clearDraft]);

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

  // =================== Modelo sticky/unread ===================
  type UnreadSnap = {
    tid: number;
    cutoffId: number | null; // primer no leído
    count: number; // total no leídos actuales
    idsToRead: number[]; // ids a marcar leído (se envían recibos)
  };

  // Snapshot “vivo” (recalculado por lista)
  const [snap, setSnap] = useState<UnreadSnap | null>(null);
  // Sticky congelado por hilo (posición + contador y etiqueta)
  const stickyRef = useRef<{ cutoffId: number | null; count: number; label: string } | null>(null);
  const stickyLockedRef = useRef<boolean>(false);
  // “Hasta aquí visto” en el momento de crear el sticky o al entrar
  const lastSeenMessageIdRef = useRef<number | null>(null);

  // reset al cambiar de hilo
  useEffect(() => {
    setSnap(null);
    prevDeliveryRef.current.clear();
    stickyRef.current = null;
    stickyLockedRef.current = false;

    const list = activeThread?.messages ?? [];
    if (!list.length) {
      lastSeenMessageIdRef.current = null;
      return;
    }

    // 1) Si ya hay no-leídos al entrar → congela ahí
    const firstUnread = list.find(
      (m) =>
        !m.isSystem &&
        !isMine(m) &&
        (((m.meta?.localDelivery as DeliveryState | undefined) ?? "sent") !== "read")
    );
    if (firstUnread) {
      const frozenCount = list.reduce((acc, m) => {
        const sys =
          !!m.isSystem ||
          (m.createdByName || "").toLowerCase() === "system" ||
          (m.createdByName || "").toLowerCase() === "sistema";
        if (sys) return acc;
        if (isMine(m)) return acc;
        const d = (m.meta?.localDelivery as DeliveryState | undefined) ?? "sent";
        return d !== "read" ? acc + 1 : acc;
      }, 0);

      stickyRef.current = {
        cutoffId: (firstUnread.id as number) ?? null,
        count: frozenCount,
        label: frozenCount > 0 ? `Mensajes no leídos (${frozenCount})` : "Mensajes no leídos",
      };
      stickyLockedRef.current = true;

      // Último visto = mensaje anterior al cutoff (si existe)
      const idx = list.findIndex((mm) => mm.id === firstUnread.id);
      lastSeenMessageIdRef.current = idx > 0 ? (list[idx - 1].id as number) : null;
    } else {
      // 2) No hay no-leídos → recordamos el último id para anclar cuando lleguen nuevos
      const last = list[list.length - 1];
      lastSeenMessageIdRef.current = (last?.id as number) ?? null;
    }
  }, [activeThread?.id, isMine]);

  // Recalcular snapshot vivo en cada cambio de mensajes
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
    const newSnap = computeSnap();
    setSnap(newSnap ?? null);

    // Si NO estaba bloqueado, podemos fijar sticky cuando aparezcan no-leídos tras lastSeen
    if (!stickyLockedRef.current) {
      const list = activeThread?.messages ?? [];
      const lastSeen = lastSeenMessageIdRef.current;

      if (list.length && lastSeen != null) {
        const startIdx = list.findIndex((m) => m.id === lastSeen);
        const slice = startIdx >= 0 ? list.slice(startIdx + 1) : list;
        const firstNewUnread = slice.find(
          (m) =>
            !m.isSystem &&
            !isMine(m) &&
            (((m.meta?.localDelivery as DeliveryState | undefined) ?? "sent") !== "read")
        );
        if (firstNewUnread) {
          const frozenCount = Math.max(newSnap?.count ?? 1, 1);
          stickyRef.current = {
            cutoffId: (firstNewUnread.id as number) ?? null,
            count: frozenCount,
            label: frozenCount > 0 ? `Mensajes no leídos (${frozenCount})` : "Mensajes no leídos",
          };
          stickyLockedRef.current = true;
        }
      }
    }
  }, [computeSnap, activeThread?.messages, isMine]);
  
  
  // ---- Filas de render
  type Row =
    | { kind: "divider"; key: string; label: string }
    | { kind: "unread"; key: string; label: string; cutoffId: number | null }
    | { kind: "msg"; msg: ThreadMessage };

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    let lastKey: string | null = null;
    const list = activeThread?.messages ?? [];

    const locked = stickyLockedRef.current;
    const sticky = stickyRef.current;
    const cutId = locked ? sticky?.cutoffId ?? null : snap?.cutoffId ?? null;
    const unreadLabel = locked
      ? sticky?.label ?? "Mensajes no leídos"
      : (snap && snap.count > 0
          ? `Mensajes no leídos (${snap.count})`
          : "Mensajes no leídos");

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
          key: `unread-${activeThread.id}-${m.id}`,
          label: unreadLabel,
          cutoffId: m.id as number,
        });
      }
      out.push({ kind: "msg", msg: m });
    }
    return out;
  }, [activeThread?.id, activeThread?.messages, snap]);

  // ---- Scroll inicial: solo si NO hay divisor
  const didInitialBottomRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const container = listRef.current;
    const tid = activeThread?.id;
    if (!container || tid == null) return;
    if (didInitialBottomRef.current.has(tid)) return;

    const locked = stickyLockedRef.current;
    const hasFrozen = !!(stickyRef.current && stickyRef.current.cutoffId != null);
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

  // ---- Autoscroll en mensaje nuevo (respetando sticky y con margen 130px)
  const lastMsgKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const list = activeThread?.messages ?? [];
    const last = list[list.length - 1];
    const currentKey = last ? `${last.id}|${last.createdAt}|${list.length}` : null;
    const prevKey = lastMsgKeyRef.current;
    lastMsgKeyRef.current = currentKey;

    if (!prevKey || !currentKey || prevKey === currentKey) return;

    const mine = last ? isMine(last) : false;
    const locked = stickyLockedRef.current;

    // Requisito 2: si entra mensaje (mío o de realtime) y el usuario está cerca del fondo,
    // bajamos al final. Si hay sticky, NO movemos (requisito 1).
    console.log("??")
    if ((mine || isNearBottom(listRef.current, NEAR_BOTTOM_PX))) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = listRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      });
    }
  }, [activeThread?.messages, isMine]);

  // ---- Enviar "read receipts" (manteniendo sticky congelado visualmente)
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
                key={`unread-thread-${activeThread.id}-${row.cutoffId ?? "none"}`}
                containerRef={listRef}
                label={row.label}
                offsetPx={16}
                behavior="auto"
                threadId={activeThread.id}
                cutoffId={row.cutoffId}
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
 <div className={styles.composer} aria-disabled={composeLocked ? "true" : "false"}>
        <AutoGrowTextarea
          value={activeThread?.id ? getDraft(activeThread?.id) : ""}
          onChange={(v: string) => activeThread.id && setDraft(activeThread.id, v)}
          placeholder={composeLocked ? "Creando hilo… espera un momento" : "Escribe un mensaje…"}
          minRows={1}
          maxRows={5}
          growsUp
          onEnter={composeLocked ? undefined : handleSend}
        />
        <button
          onClick={handleSend}
          disabled={composeLocked}
          aria-busy={composeLocked}
          className={composeLocked ? `${styles.buttonLoading}` : undefined}
          title={composeLocked ? "Guardando el nuevo hilo…" : "Enviar mensaje"}
        >
          {composeLocked ? <span className={styles.spinner} aria-hidden /> : "Enviar"}
        </button>
      </div>

      <div className={styles.changeStatusBtnWrapper}>
        <button
          className={`${styles.changeStatusBtn} 
          ${styles[`${colorByNextStatus(activeThread.status)}`]} ${
            statusLocked ? styles.buttonLoading : ""
          }`}
          onClick={() => onToggleThreadStatus(activeThread.id, nextStatus(activeThread.status))}
          title={toggleLabel(activeThread.status)}
          disabled={statusLocked}
          aria-busy={statusLocked}
        >
          {statusLocked ? (
            <>
              <span className={styles.spinner} aria-hidden /> Actualizando…
            </>
          ) : (
            toggleLabel(activeThread.status)
          )}
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
