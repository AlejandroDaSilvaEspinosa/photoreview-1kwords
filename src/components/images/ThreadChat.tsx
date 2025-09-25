"use client";

import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useLayoutEffect,
} from "react";
import styles from "./ThreadChat.module.css";
import ReactMarkdown from "react-markdown";
import { Thread, ThreadMessage, ThreadStatus } from "@/types/review";
import AutoGrowTextarea from "../AutoGrowTextarea";
import { supabaseBrowser } from "@/lib/supabase/browser";

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

  // ===== Scroll container
  const listRef = useRef<HTMLDivElement | null>(null);

  // ===== Auth uid (auth.users.id)
  const [selfAuthId, setSelfAuthId] = useState<string | null>(null);
  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => setSelfAuthId(data.user?.id ?? null))
      .catch(() => setSelfAuthId(null));
  }, []);

  // ===== Helpers status
  const nextStatus = (s: ThreadStatus): ThreadStatus =>
    s === "corrected" ? "reopened" : "corrected";
  const toggleLabel = (s: ThreadStatus) =>
    s === "corrected" ? "Reabrir hilo" : "Validar correcciones";
  const colorByNextStatus = (s: ThreadStatus) => (s === "corrected" ? "orange" : "green");
  const colorByStatus = (s: ThreadStatus) =>
    s === "corrected" ? "#0FA958" : s === "reopened" ? "#FFB000" : s === "deleted" ? "#666" : "#FF0040";

  // ===== isMine: por meta.isMine OR sending OR createdByAuthId === selfAuthId
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
    return d.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  };

  const timeHHmm = (d: Date) =>
    d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false });

  // ===== MARCA DE CORTE “MENSAJES NO LEÍDOS (N)” — snapshot al abrir
  const [unreadCutoffId, setUnreadCutoffId] = useState<number | null>(null);
  const [unreadSnapshot, setUnreadSnapshot] = useState<number>(0);

  useLayoutEffect(() => {
    const list = activeThread?.messages ?? [];

    // Cuenta no leídos (no míos, no sistema, delivery != read)
    let count = 0;
    for (const m of list) {
      const sys = !!m.isSystem || (m.createdByName || "").toLowerCase() === "system";
      if (sys) continue;
      if (isMine(m)) continue;
      const delivery = (m.meta?.localDelivery ?? "sent") as DeliveryState;
      if (delivery !== "read") count++;
    }

    // Primer no leído
    const idx = list.findIndex((m) => {
      const sys = !!m.isSystem || (m.createdByName || "").toLowerCase() === "system";
      if (sys) return false;
      if (isMine(m)) return false;
      const delivery = (m.meta?.localDelivery ?? "sent") as DeliveryState;
      return delivery !== "read";
    });

    setUnreadSnapshot(count);
    setUnreadCutoffId(idx >= 0 && typeof list[idx]?.id === "number" ? (list[idx].id as number) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id, selfAuthId]); // snapshot fijo al abrir hilo

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

  // ===== Auto-scroll inicial — al separador alineado ARRIBA del contenedor
  const didInitialScrollForThread = useRef<number | null>(null);
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    if (didInitialScrollForThread.current === activeThread?.id) return;

    const doAccurateScroll = () => {
      const sep = container.querySelector<HTMLElement>('[data-unread-cutoff="true"]');
      if (!sep) {
        // Sin no leídos → baja del todo (comportamiento previo)
        container.scrollTop = container.scrollHeight;
        didInitialScrollForThread.current = activeThread?.id ?? null;
        return;
      }

      // Reintenta por si el layout sigue cambiando (imágenes/markdown)
      let tries = 0;
      const MAX_TRIES = 8;

      const tick = () => {
        if (!listRef.current || !sep) return;
        const cont = listRef.current;
        const contRect = cont.getBoundingClientRect();
        const sepRect  = sep.getBoundingClientRect();

        // Delta para alinear la parte superior del separador con la parte superior del contenedor
        const delta = sepRect.top - contRect.top;
        cont.scrollTop += delta;

        // Si ya está prácticamente alineado (< 1px) o agotamos intentos, terminamos
        const newSepRect = sep.getBoundingClientRect();
        const newDelta = newSepRect.top - cont.getBoundingClientRect().top;

        if (Math.abs(newDelta) <= 1 || ++tries >= MAX_TRIES) {
          didInitialScrollForThread.current = activeThread?.id ?? null;
        } else {
          requestAnimationFrame(tick);
        }
      };

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(doAccurateScroll);
  }, [activeThread?.id, rows]); // rows garantiza que el separador ya existe en el DOM

  // ===== Auto-scroll al FINAL cuando llega un MENSAJE NUEVO
  const lastMsgKeyRef = useRef<string | null>(null);

  // Reset del tracker al cambiar de hilo
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

    // Actualiza el tracker para próximas comparaciones
    lastMsgKeyRef.current = currentKey;

    // Si no había anterior (primer render del hilo) → no forcemos scroll aquí
    if (!prevKey || !currentKey) return;

    // Si cambió el último mensaje → hay mensaje nuevo → baja al final
    if (prevKey !== currentKey) {
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      });
    }
  }, [activeThread?.messages]); // cualquier cambio en mensajes reevalúa

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
              <div
                key={row.key}
                className={styles.unreadDivider}
                role="separator"
                aria-label={row.label}
                title={row.label}
                data-unread-cutoff="true"
              >
                <span className={styles.unreadDividerLine} />
                <span className={styles.unreadDividerLabel}>
                  {row.label}
                </span>
                <span className={styles.unreadDividerLine} />
              </div>
            );
          }

          const m = row.msg;
          const mine = isMine(m);
          const meta = (m.meta || {}) as any;
          const delivery = meta.localDelivery as DeliveryState | undefined;
          const sys = !!m.isSystem || (m.createdByName || "").toLowerCase() === "system";

          const ticks =
            delivery === "sending"   ? "⏳" :
            delivery === "read"      ? "✓✓" :
            delivery === "delivered" ? "✓✓"  :
                                       "✓"; // "sent" → ✓

          const dt = new Date(m.createdAt);
          const hhmm = timeHHmm(dt);

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
                  <span className={styles.time}>{hhmm}</span>
                  {!sys && mine && (
                    <span className={`${styles.ticks} ${delivery === "read" && styles.read}`}>{ticks}</span>
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
          className={`${styles.changeStatusBtn} ${styles[`${colorByNextStatus(activeThread.status)}`]} ${statusLocked ? styles.buttonLoading : ""}`}
          onClick={() => onToggleThreadStatus(activeThread.id, nextStatus(activeThread.status))}
          title={toggleLabel(activeThread.status)}
          disabled={statusLocked}
          aria-busy={statusLocked}
        >
          {statusLocked ? (<><span className={styles.spinner} aria-hidden /> Actualizando…</>) : (toggleLabel(activeThread.status))}
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
