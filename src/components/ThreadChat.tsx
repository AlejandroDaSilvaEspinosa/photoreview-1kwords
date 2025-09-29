"use client";

import React, {
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import styles from "./ThreadChat.module.css";
import ReactMarkdown from "react-markdown";
import { Thread, ThreadMessage, ThreadStatus } from "@/types/review";
import AutoGrowTextarea from "./AutoGrowTextarea";
import { useSupabaseUserId } from "@/hooks/useSupabaseUserId";
import { toastError } from "@/hooks/useToast";

type DeliveryState = "sending" | "sent" | "delivered" | "read";

const NEAR_BOTTOM_PX = 130;
function isNearBottom(el: HTMLDivElement | null, slackPx = NEAR_BOTTOM_PX) {
  if (!el) return true;
  const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
  return dist <= slackPx;
}

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
      if (doneKeyRef.current === key) return;
      doneKeyRef.current = key;

      const el = sepRef.current;
      if (!el) return;
      el.scrollIntoView({
        behavior: "auto",
        block: "start",
        inline: "nearest",
      });
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

type Props = {
  activeThread: Thread;
  composeLocked?: boolean;
  statusLocked?: boolean;
  threadIndex: number;
  onAddThreadMessage: (threadId: number, text: string) => Promise<void> | void;
  onFocusThread: (threadId: number | null) => void;
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => void;
  onDeleteThread: (id: number) => void;
};

function ThreadChatInner({
  activeThread,
  threadIndex,
  onAddThreadMessage,
  onFocusThread,
  onToggleThreadStatus,
  onDeleteThread,
  composeLocked,
  statusLocked,
}: Props) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const setDraft = useCallback(
    (threadId: number, value: string | ((prev: string) => string)) => {
      setDrafts((prev) => ({
        ...prev,
        [threadId]:
          typeof value === "function"
            ? (value as any)(prev[threadId] ?? "")
            : value,
      }));
    },
    []
  );
  const getDraft = useCallback(
    (threadId: number) => drafts[threadId] ?? "",
    [drafts]
  );
  const clearDraft = useCallback((threadId: number) => {
    setDrafts((prev) => {
      const { [threadId]: _omit, ...rest } = prev;
      return rest;
    });
  }, []);

  const listRef = useRef<HTMLDivElement | null>(null);
  const selfAuthId = useSupabaseUserId();

  const nextStatus = useCallback(
    (s: ThreadStatus): ThreadStatus =>
      s === "corrected" ? "reopened" : "corrected",
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
      if ((meta.localDelivery as DeliveryState | undefined) === "sending")
        return true;
      const createdByAuthId = (m as any).createdByAuthId as
        | string
        | null
        | undefined;
      return (
        !!selfAuthId && !!createdByAuthId && createdByAuthId === selfAuthId
      );
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
    d.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  // ===== Orden cronológico estable =====
  const messagesChrono = useMemo(() => {
    const list = activeThread?.messages ?? [];
    return [...list].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime() || 0;
      const tb = new Date(b.createdAt).getTime() || 0;
      if (ta !== tb) return ta - tb;
      const sa = (a as any)?.meta?.displaySeq ?? 0;
      const sb = (b as any)?.meta?.displaySeq ?? 0;
      if (sa !== sb) return sa - sb;
      const na = (a as any)?.meta?.displayNano ?? 0;
      const nb = (b as any)?.meta?.displayNano ?? 0;
      if (na !== nb) return na - nb;
      return (a.id ?? 0) - (b.id ?? 0);
    });
  }, [activeThread?.messages]);

  // ===== Payload listo + epoch =====
  const threadMeta: any = (activeThread as any)?.meta || {};
  const threadHydratedFlag =
    threadMeta?.hydrated === true ||
    threadMeta?.source === "live" ||
    threadMeta?.source === "realtime";
  const payloadReady = threadHydratedFlag;
  const unreadEpoch = threadMeta?.unreadEpoch ?? 0;

  // ========= UNREAD: congelado por (tid, epoch) =========
  type FrozenUnread = {
    tid: number;
    epoch: number;
    cutoffId: number | null;
    count: number;
    label: string;
  };
  const [frozenUnread, setFrozenUnread] = useState<FrozenUnread | null>(null);
  const computedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const tid = activeThread?.id;
    if (!tid) return;
    if (!payloadReady) return;

    const key = `${tid}:${unreadEpoch}`;
    if (computedKeyRef.current === key) return; // ya congelado para este (tid,epoch)

    const list = messagesChrono;
    let cutoffId: number | null = null;
    let count = 0;

    for (const m of list) {
      const sys =
        !!m.isSystem ||
        (m.createdByName || "").toLowerCase() === "system" ||
        (m.createdByName || "").toLowerCase() === "sistema";
      if (sys || isMine(m)) continue;
      const delivery =
        (m.meta?.localDelivery as DeliveryState | undefined) ?? "sent";
      if (delivery !== "read") {
        if (cutoffId == null) cutoffId = (m.id as number) ?? null;
        count++;
      }
    }

    if (cutoffId != null && count > 0) {
      setFrozenUnread({
        tid,
        epoch: unreadEpoch,
        cutoffId,
        count,
        label: `Mensajes no leídos (${count})`,
      });
    } else {
      setFrozenUnread(null);
    }

    computedKeyRef.current = key;
  }, [activeThread?.id, payloadReady, messagesChrono, isMine, unreadEpoch]);

  // ========= Read receipts (después de fijar divisor) =========
  const idsToRead = useMemo(() => {
    const out: number[] = [];
    const list = messagesChrono;
    if (!activeThread?.id || !list.length) return out;
    for (const m of list) {
      const sys =
        !!m.isSystem ||
        (m.createdByName || "").toLowerCase() === "system" ||
        (m.createdByName || "").toLowerCase() === "sistema";
      if (sys || isMine(m)) continue;
      const delivery =
        (m.meta?.localDelivery as DeliveryState | undefined) ?? "sent";
      if (delivery !== "read") {
        const mid = (m.id as number) ?? -1;
        if (Number.isFinite(mid) && mid >= 0) out.push(mid);
      }
    }
    return out;
  }, [activeThread?.id, messagesChrono, isMine]);

  useEffect(() => {
    const tid = activeThread?.id;
    if (!tid) return;
    // No armes recibos hasta haber fijado el divisor (o su ausencia) para este (tid,epoch)
    if (computedKeyRef.current !== `${tid}:${unreadEpoch}`) return;
    if (!idsToRead.length) return;

    (async () => {
      try {
        await fetch("/api/messages/receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: idsToRead, mark: "read" }),
        });
      } catch (e) {
        toastError(e, {
          title: "No se pudo confirmar la lectura",
          fallback: "Reintentaremos automáticamente.",
        });
      }
    })();
  }, [activeThread?.id, idsToRead, unreadEpoch]);

  type Row =
    | { kind: "divider"; key: string; label: string }
    | { kind: "unread"; key: string; label: string; cutoffId: number | null }
    | { kind: "msg"; msg: ThreadMessage };

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    let lastKey: string | null = null;
    const list = messagesChrono;

    const cutId =
      frozenUnread && frozenUnread.tid === activeThread.id
        ? frozenUnread.cutoffId
        : null;
    const unreadLabel =
      frozenUnread && frozenUnread.tid === activeThread.id
        ? frozenUnread.label
        : "Mensajes no leídos";

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
  }, [activeThread?.id, messagesChrono, frozenUnread]);

  // Autoscroll inicial: espera payload; si hay divisor, no baja al fondo
  const didInitialBottomRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const container = listRef.current;
    const tid = activeThread?.id;
    if (!container || tid == null) return;
    if (didInitialBottomRef.current.has(tid)) return;

    if (!payloadReady) return;

    const hasFrozen =
      !!frozenUnread &&
      frozenUnread.tid === tid &&
      frozenUnread.cutoffId != null;

    if (!hasFrozen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = listRef.current;
          if (el) el.scrollTop = el.scrollHeight;
          didInitialBottomRef.current.add(tid);
        });
      });
    } else {
      didInitialBottomRef.current.add(tid);
    }
  }, [activeThread?.id, frozenUnread, payloadReady]);

  // Autoscroll con mensajes entrantes (si son míos o estamos cerca del fondo)
  const lastMsgKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const list = messagesChrono;
    const last = list[list.length - 1];
    const currentKey = last
      ? `${last.id}|${last.createdAt}|${list.length}`
      : null;
    const prevKey = lastMsgKeyRef.current;
    lastMsgKeyRef.current = currentKey;
    if (!prevKey || !currentKey || prevKey === currentKey) return;
    const mine = last ? isMine(last) : false;

    if (mine || isNearBottom(listRef.current, NEAR_BOTTOM_PX)) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = listRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      });
    }
  }, [messagesChrono, isMine]);

  const prevDeliveryRef = useRef<Map<number, DeliveryState>>(new Map());
  const toggleLabel = useCallback(
    (s: ThreadStatus) =>
      s === "corrected" ? "Reabrir hilo" : "Validar correcciones",
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

      <div ref={listRef} className={styles.chatList} data-chat-list>
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
                key={`unread-thread-${activeThread.id}-${
                  row.cutoffId ?? "none"
                }`}
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
          const delivery =
            (meta.localDelivery as DeliveryState | undefined) ?? "sent";
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
          const justDelivered =
            prev === "sent" &&
            (delivery === "delivered" || delivery === "read");
          const justRead = prev !== "read" && delivery === "read";
          prevDeliveryRef.current.set(m.id as number, delivery);

          const dt = new Date(m.createdAt);
          const hhmm = timeHHmm(dt);

          const idNum = typeof m.id === "number" ? m.id : NaN;
          const isTemp = Number.isFinite(idNum) && idNum < 0;
          const nonce = (m as any)?.meta?.clientNonce;
          const seq = (m as any)?.meta?.displaySeq;
          const nano = (m as any)?.meta?.displayNano;
          const stableKey = nonce
            ? `nonce:${nonce}${isTemp ? ":temp" : ""}`
            : seq != null && nano != null
            ? `seq:${seq}/${nano}`
            : m.id != null
            ? `id:${m.id}`
            : `idx:${i}`;

          return (
            <div
              key={stableKey}
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
                  {sys
                    ? "Sistema"
                    : mine
                    ? "Tú"
                    : m.createdByName || "Desconocido"}
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

      <div
        className={styles.composer}
        aria-disabled={composeLocked ? "true" : "false"}
      >
        <AutoGrowTextarea
          value={activeThread?.id ? getDraft(activeThread?.id) : ""}
          onChange={(v: string) =>
            activeThread.id && setDraft(activeThread.id, v)
          }
          placeholder={
            composeLocked
              ? "Creando hilo… espera un momento"
              : "Escribe un mensaje…"
          }
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
          {composeLocked ? (
            <span className={styles.spinner} aria-hidden />
          ) : (
            "Enviar"
          )}
        </button>
      </div>

      <div className={styles.changeStatusBtnWrapper}>
        <button
          className={`${styles.changeStatusBtn} ${
            styles[
              `${activeThread.status === "corrected" ? "orange" : "green"}`
            ]
          } ${statusLocked ? styles.buttonLoading : ""}`}
          onClick={() =>
            onToggleThreadStatus(
              activeThread.id,
              nextStatus(activeThread.status)
            )
          }
          title={
            activeThread.status === "corrected"
              ? "Reabrir hilo"
              : "Validar correcciones"
          }
          disabled={statusLocked}
          aria-busy={statusLocked}
        >
          {statusLocked ? (
            <>
              <span className={styles.spinner} aria-hidden /> Actualizando…
            </>
          ) : activeThread.status === "corrected" ? (
            "Reabrir hilo"
          ) : (
            "Validar correcciones"
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
