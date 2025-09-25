"use client";

import React, { useRef, useEffect, useState, useMemo, useLayoutEffect } from "react";
import styles from "./ThreadChat.module.css";
import ReactMarkdown from "react-markdown";
import { Thread, ThreadMessage, ThreadStatus } from "@/types/review";
import AutoGrowTextarea from "../AutoGrowTextarea";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useMessagesStore } from "@/stores/messages";

type Props = {
  activeThread: Thread;
  threads: Thread[];
  onAddThreadMessage: (threadId: number, text: string) => Promise<void> | void;
  onFocusThread: (threadId: number | null) => void;
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => void;
  onDeleteThread: (id: number) => void;
  composeLocked?: boolean;
  statusLocked?: boolean;
};

type DeliveryState = "sending" | "sent" | "delivered" | "read";

export default function ThreadChat({
  activeThread,
  threads,
  onAddThreadMessage,
  onFocusThread,
  onToggleThreadStatus,
  onDeleteThread,
  composeLocked = false,
  statusLocked = false,
}: Props) {
  // ===== Draft local por hilo
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const setDraft = (threadId: number, value: string | ((prev: string) => string)) => {
    setDrafts((prev) => ({
      ...prev,
      [threadId]: typeof value === "function" ? (value as any)(prev[threadId] ?? "") : value,
    }));
  };
  const getDraft = (threadId: number) => drafts[threadId] ?? "";
  const clearDraft = (threadId: number) => {
    setDrafts((prev) => {
      const { [threadId]: _omit, ...rest } = prev;
      return rest;
    });
  };

  // ===== Scroll container
  const listRef = useRef<HTMLDivElement | null>(null);

  // ===== Auth uid (auth.users.id) local
  const [selfAuthId, setSelfAuthId] = useState<string | null>(null);
  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => setSelfAuthId(data.user?.id ?? null))
      .catch(() => setSelfAuthId(null));
  }, []);

  // ===== Helpers status
  const nextStatus = (s: ThreadStatus): ThreadStatus => (s === "corrected" ? "reopened" : "corrected");
  const toggleLabel = (s: ThreadStatus) => (s === "corrected" ? "Reabrir hilo" : "Validar correcciones");
  const colorByNextStatus = (s: ThreadStatus) => (s === "corrected" ? "orange" : "green");
  const colorByStatus = (s: ThreadStatus) =>
    s === "corrected" ? "#0FA958" : s === "reopened" ? "#FFB000" : s === "deleted" ? "#666" : "#FF0040";

  // ===== isMine
  const isMine = (m: ThreadMessage) => {
    const meta = (m.meta || {}) as any;
    if (meta.isMine === true) return true;
    if ((meta.localDelivery as DeliveryState | undefined) === "sending") return true;
    const createdByAuthId = (m as any).createdByAuthId as string | null | undefined;
    return !!selfAuthId && !!createdByAuthId && createdByAuthId === selfAuthId;
  };

  // ===== Enviar
  const handleSend = async () => {
    if (composeLocked) return;
    const id = activeThread?.id;
    if (!id) return;
    const draft = getDraft(id);
    if (!draft.trim()) return;
    clearDraft(id);
    await onAddThreadMessage(id, draft.trim());
  };

  // ===== Fechas y etiquetas
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
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  };
  const timeHHmm = (d: Date) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false });

  // ===== MARCA DE CORTE “MENSAJES NO LEÍDOS (N)” — snapshot robusto
  const [unreadCutoffId, setUnreadCutoffId] = useState<number | null>(null);
  const [unreadSnapshot, setUnreadSnapshot] = useState<number>(0);
  const didSnapshotForRef = useRef<number | null>(null);

  // Marcado de leído (después del scroll); obtenemos selfId del store para reintento
  const markThreadRead = useMessagesStore((s) => s.markThreadRead);
  const storeSelfId = useMessagesStore((s) => s.selfAuthId);

  // Reset al cambiar de hilo
  useEffect(() => {
    didSnapshotForRef.current = null;
    setUnreadCutoffId(null);
    setUnreadSnapshot(0);
  }, [activeThread?.id]);

  // Snapshot cuando cambia la referencia del array o sabemos quién soy
  useLayoutEffect(() => {
    const list = activeThread?.messages ?? [];
    if (!activeThread?.id) return;
    if (!list.length) return;

    if (didSnapshotForRef.current === activeThread.id) return;

    let count = 0;
    for (const m of list) {
      const sys =
        !!m.isSystem ||
        (m.createdByName || "").toLowerCase() === "system" ||
        (m.createdByName || "").toLowerCase() === "sistema";
      if (sys) continue;
      if (isMine(m)) continue;
      const delivery = (m.meta?.localDelivery ?? "sent") as DeliveryState;
      if (delivery !== "read") count++;
    }

    let firstUnreadId: number | null = null;
    for (const m of list) {
      const sys =
        !!m.isSystem ||
        (m.createdByName || "").toLowerCase() === "system" ||
        (m.createdByName || "").toLowerCase() === "sistema";
      if (sys) continue;
      if (isMine(m)) continue;
      const delivery = (m.meta?.localDelivery ?? "sent") as DeliveryState;
      if (delivery !== "read") {
        const mid = (m.id as number) ?? null;
        if (typeof mid === "number") {
          firstUnreadId = mid;
          break;
        }
      }
    }

    setUnreadSnapshot(count);
    setUnreadCutoffId(firstUnreadId);
    didSnapshotForRef.current = activeThread.id;
  }, [activeThread?.id, activeThread?.messages, selfAuthId]);

  // ===== Filas con separadores + “Mensajes no leídos (N)”
  type Row =
    | { kind: "divider"; key: string; label: string }
    | { kind: "unread"; key: string; label: string }
    | { kind: "msg"; msg: ThreadMessage };

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    let lastKey: string | null = null;
    const list = activeThread?.messages ?? [];
    for (const m of list) {
      const dt = new Date(m.createdAt);
      const k = dateKey(dt);
      if (k !== lastKey) {
        out.push({ kind: "divider", key: k, label: labelFor(dt) });
        lastKey = k;
      }
      if (unreadSnapshot > 0 && unreadCutoffId != null && m.id === unreadCutoffId) {
        out.push({
          kind: "unread",
          key: `unread-${m.id}`,
          label: `Mensajes no leídos (${unreadSnapshot})`,
        });
      }
      out.push({ kind: "msg", msg: m });
    }
    return out;
  }, [activeThread?.messages, unreadCutoffId, unreadSnapshot]);

  // ===== Auto-scroll inicial con reintentos y marcado leído (cuando haya selfId)
  const didInitialScrollForThread = useRef<number | null>(null);

  useEffect(() => {
    const container = listRef.current;
    const threadId = activeThread?.id;
    if (!container || !threadId) return;

    // esperar a snapshot
    if (didSnapshotForRef.current !== threadId) return;

    // ya realizado
    if (didInitialScrollForThread.current === threadId) return;

    let cancelled = false;

    const finish = () => {
      if (cancelled) return;
      didInitialScrollForThread.current = threadId;
      if (storeSelfId) {
        requestAnimationFrame(() => {
          markThreadRead(threadId).catch(() => {});
        });
      }
    };

    const scrollToSeparator = () => {
      const sep = container.querySelector<HTMLElement>('[data-unread-cutoff="true"]');
      if (!sep) return false;
      const contRect = container.getBoundingClientRect();
      const sepRect = sep.getBoundingClientRect();
      const delta = sepRect.top - contRect.top;
      container.scrollTop += delta;
      return true;
    };

    const doAccurateScroll = () => {
      if (unreadSnapshot > 0 && unreadCutoffId != null) {
        // intentar ubicar separador con reintentos
        let tries = 0;
        const MAX_TRIES = 16;

        const tryAlign = () => {
          if (cancelled) return;
          const ok = scrollToSeparator();
          if (ok) {
            requestAnimationFrame(() => {
              scrollToSeparator();
              finish();
            });
          } else if (++tries < MAX_TRIES) {
            requestAnimationFrame(tryAlign);
          } else {
            container.scrollTop = container.scrollHeight;
            finish();
          }
        };

        requestAnimationFrame(tryAlign);
      } else {
        // sin no-leídos → al final (doble RAF para asegurar layout)
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
          requestAnimationFrame(finish);
        });
      }
    };

    requestAnimationFrame(doAccurateScroll);

    return () => {
      cancelled = true;
    };
  }, [activeThread?.id, rows, unreadSnapshot, unreadCutoffId, markThreadRead, storeSelfId]);

  // 🔁 Reintento de marcado leído cuando el store obtiene selfAuthId (después del scroll)
  useEffect(() => {
    const tid = activeThread?.id;
    if (!tid) return;
    if (didInitialScrollForThread.current === tid && storeSelfId) {
      markThreadRead(tid).catch(() => {});
    }
  }, [storeSelfId, activeThread?.id, markThreadRead]);

  // ===== Auto-scroll al FINAL cuando llega un MENSAJE NUEVO
  const lastMsgKeyRef = useRef<string | null>(null);
  useEffect(() => {
    lastMsgKeyRef.current = null;
  }, [activeThread?.id]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const list = activeThread?.messages ?? [];
    const last = list[list.length - 1];
    const currentKey = last ? `${last.id}|${last.createdAt}` : null;
    const prevKey = lastMsgKeyRef.current;
    lastMsgKeyRef.current = currentKey;
    if (!prevKey || !currentKey) return;
    if (prevKey !== currentKey) {
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      });
    }
  }, [activeThread?.messages]);

  // ===== Ajuste extra: si no hay no-leídos, asegura estar al fondo ante reflows
  useEffect(() => {
    const container = listRef.current;
    const tid = activeThread?.id;
    if (!container || !tid) return;
    if (unreadSnapshot > 0) return;
    if (didInitialScrollForThread.current !== tid) return;
    const raf = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [activeThread?.id, rows.length, unreadSnapshot]);

  // ===== render
  const prevDeliveryRef = useRef<Map<number, DeliveryState>>(new Map());

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
        {rows.map((row, i) => {
          if (row.kind === "divider") {
            return (
              <div key={`div-${row.key}-${i}`} className={styles.dayDivider} role="separator" aria-label={row.label}>
                <span className={styles.dayDividerLabel}>{row.label}</span>
              </div>
            );
          }

          if (row.kind === "unread") {
            return (
              <div
                key={row.key}
                className={styles.unreadDivider}
                role="separator"
                aria-label={row.label}
                title={row.label}
                data-unread-cutoff="true"
              >
                <span className={styles.unreadDividerLine} />
                <span className={styles.unreadDividerLabel}>{row.label}</span>
                <span className={styles.unreadDividerLine} />
              </div>
            );
          }

          const m = row.msg;
          const mine = isMine(m);
          const meta = (m.meta || {}) as any;
          const delivery = (meta.localDelivery as DeliveryState | undefined) ?? "sent";
          const sys =
            !!m.isSystem ||
            (m.createdByName || "").toLowerCase() === "system" ||
            (m.createdByName || "").toLowerCase() === "sistema";

          const ticks =
            delivery === "sending" ? "⏳" : delivery === "read" ? "✓✓" : delivery === "delivered" ? "✓✓" : "✓";

          const prev = prevDeliveryRef.current.get(m.id as number);
          const justDelivered = prev === "sent" && (delivery === "delivered" || delivery === "read");
          const justRead = prev !== "read" && delivery === "read";
          prevDeliveryRef.current.set(m.id as number, delivery);

          const dt = new Date(m.createdAt);
          const hhmm = timeHHmm(dt);

          return (
            <div
              key={m.id}
              className={sys ? `${styles.bubble} ${styles.system}` : `${styles.bubble} ${mine ? styles.mine : styles.theirs}`}
            >
              <div lang="es" className={styles.bubbleText}>
                <ReactMarkdown>{m.text}</ReactMarkdown>
              </div>
              <div className={styles.bubbleMeta}>
                <span className={styles.author}>{sys ? "Sistema" : mine ? "Tú" : m.createdByName || "Desconocido"}</span>
                <span className={styles.messageMeta}>
                  <span className={styles.time}>{hhmm}</span>
                  {!sys && mine && (
                    <span
                      className={`${styles.ticks} ${delivery === "read" ? styles.read : ""} ${
                        justDelivered ? styles.justDelivered : ""
                      } ${justRead ? styles.justRead : ""}`}
                      aria-live="polite"
                      aria-label={
                        delivery === "read" ? "Leído" : delivery === "delivered" ? "Entregado" : delivery === "sent" ? "Enviado" : "Enviando"
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
          className={`${styles.changeStatusBtn} ${styles[`${colorByNextStatus(activeThread.status)}`]} ${
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
          onClick={() => onDeleteThread(activeThread.id)}
        >
          🗑
        </button>
      </div>
    </div>
  );
}
