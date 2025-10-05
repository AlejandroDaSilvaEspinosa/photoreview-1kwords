// File: src/components/ThreadsPanel.tsx
"use client";

import React, { useMemo, useState } from "react";
import styles from "./ThreadsPanel.module.css";
import ThreadChat from "./ThreadChat";
import AppModal from "./ui/Modal";
import DeleteIcon from "@/icons/delete.svg";
import Check from "@/icons/check.svg";
import UndoIcon from "@/icons/undo.svg";
import ChatIcon from "@/icons/chat.svg";
import type { Thread, ThreadStatus } from "@/types/review";
import { colorByThreadStatus } from "@/lib/ui/status";
import { useMessagesStore, hasUnreadInThread } from "@/stores/messages";
import { useDotNumbers } from "@/contexts/DotNumbersProvider";

type Props = {
  threads: Thread[];
  activeThreadId: number | null;

  /** Locks / estado global */
  validationLock?: boolean;
  pendingStatusIds?: Set<number>;
  composeLocked?: boolean;
  statusLockedForActive?: boolean;

  /** Callbacks */
  onAddThreadMessage: (threadId: number, text: string) => Promise<void> | void;
  onFocusThread: (threadId: number | null) => void;
  centerToThread?: (thread: Thread) => void;
  onToggleThreadStatus: (
    threadId: number,
    next: ThreadStatus
  ) => Promise<void> | void;
  onDeleteThread: (threadId: number) => Promise<void> | void;

  /** Empty copy */
  emptyTitle?: string;
  emptySubtitle?: string;
};

const STATUS_LABEL: Record<ThreadStatus, string> = {
  pending: "Pendiente",
  corrected: "Corregido",
  reopened: "Reabierto",
  deleted: "Eliminado",
};

const nextStatus = (s: ThreadStatus): ThreadStatus =>
  s === "corrected" ? "reopened" : "corrected";

const toggleLabel = (s: ThreadStatus) =>
  s === "corrected" ? "Reabrir hilo" : "Validar correcciones";

const toggleIcon = (s: ThreadStatus) =>
  s === "corrected" ? <UndoIcon /> : <Check />;

export default function ThreadsPanel({
  threads,
  activeThreadId,
  validationLock = false,
  pendingStatusIds,
  composeLocked = false,
  statusLockedForActive = false,
  onAddThreadMessage,
  onFocusThread,
  centerToThread,
  onToggleThreadStatus,
  onDeleteThread,
  emptyTitle = "Aún no hay hilos",
  emptySubtitle = "Crea un hilo en la imagen para empezar el chat.",
}: Props) {
  const dot = useDotNumbers();

  useMessagesStore((s) => s.byThread);
  useMessagesStore((s) => s.selfAuthId);

  // ====== Vista activa (chat si hay hilo seleccionado) ======
  const activeThread = useMemo(
    () =>
      activeThreadId != null
        ? threads.find((t) => t.id === activeThreadId) ?? null
        : null,
    [threads, activeThreadId]
  );

  // Número estable para el hilo activo
  const threadIndex =
    useMemo(
      () =>
        activeThread ? dot?.getNumber(activeThread.x, activeThread.y) ?? 0 : 0,
      // dot?.version asegura recomputar cuando el provider reenumere
      [activeThread, dot?.version]
    ) || 0;

  // ====== pending local (fallback si no se gestiona desde arriba) ======
  const [localPending, setLocalPending] = useState<Set<number>>(new Set());
  const isPending = (id: number) =>
    (pendingStatusIds && pendingStatusIds.has(id)) || localPending.has(id);

  const setPending = (id: number, v: boolean) =>
    setLocalPending((prev) => {
      const next = new Set(prev);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });

  // ====== borrar con confirmación ======
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const handleConfirmDelete = async () => {
    if (confirmDeleteId == null) return;
    const id = confirmDeleteId;
    setPending(id, true);
    try {
      await Promise.resolve(onDeleteThread(id));
    } finally {
      setPending(id, false);
      setConfirmDeleteId(null);
    }
  };

  // ====== acciones ======
  const handleToggle = async (t: Thread) => {
    const id = t.id;
    const next = nextStatus(t.status);
    setPending(id, true);
    try {
      await Promise.resolve(onToggleThreadStatus(id, next));
    } finally {
      setPending(id, false);
    }
  };

  // ====== Render: lista de hilos ======
  const list = useMemo(
    () => threads.filter((t) => t.status !== "deleted"),
    [threads]
  );

  // ====== Render: si hay hilo activo, mostramos el chat ======
  if (activeThread) {
    const lockedActive =
      statusLockedForActive ||
      (activeThreadId != null && isPending(activeThreadId));

    return (
      <div className={styles.panel}>
        <ThreadChat
          activeThread={activeThread}
          threadIndex={threadIndex}
          composeLocked={composeLocked}
          statusLocked={lockedActive}
          validationLock={validationLock}
          onAddThreadMessage={onAddThreadMessage}
          onFocusThread={onFocusThread}
          onToggleThreadStatus={onToggleThreadStatus}
          onDeleteThread={onDeleteThread}
        />
      </div>
    );
  }

  return (
    <section className={styles.panel} aria-label="Lista de hilos">
      <div className={styles.header}>
        <h3 className={styles.title}>Hilos</h3>
        <span className={styles.count}>{list.length}</span>
      </div>

      {list.length === 0 ? (
        <div className={styles.emptyCard}>
          <div className={styles.emptyTitle}>{emptyTitle}</div>
          <div className={styles.emptySubtitle}>{emptySubtitle}</div>
        </div>
      ) : (
        <ul className={styles.list}>
          {list.map((t, i) => {
            const isLocked = isPending(t.id);
            const variant = t.status === "corrected" ? "orange" : "green";
            const willGo = toggleLabel(t.status);
            const willGoIcon = toggleIcon(t.status);
            const hasUnread = hasUnreadInThread(t.id);
            const n = dot?.getNumber(t.x, t.y) ?? i + 1;

            return (
              <li key={t.id} className={styles.row}>
                <button
                  className={styles.rowMain}
                  onClick={() =>
                    centerToThread ? centerToThread(t) : onFocusThread(t.id)
                  }
                  title={`Hilo #${n} — ${STATUS_LABEL[t.status]}`}
                >
                  {hasUnread && (
                    <span
                      title="Mensajes sin leer"
                      aria-label="Mensajes sin leer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        marginLeft: 8,
                      }}
                    >
                      <ChatIcon style={{ width: 14, height: 14 }} />
                    </span>
                  )}
                  <span
                    className={styles.dot}
                    style={{ background: colorByThreadStatus(t.status) }}
                    aria-hidden
                  />
                  <span className={styles.threadTitle}>Hilo #{n}</span>
                  <span className={styles.threadStatus}>
                    {STATUS_LABEL[t.status]}
                  </span>
                </button>

                <div className={styles.actions}>
                  <button
                    className={`${styles.changeStatusBtn} ${styles[variant]} ${
                      isLocked ? styles.buttonLoading : ""
                    } ${validationLock ? styles.disabled : ""}`}
                    onClick={() =>
                      !isLocked && !validationLock ? handleToggle(t) : undefined
                    }
                    disabled={isLocked || validationLock}
                    aria-busy={isLocked}
                    title={willGo}
                  >
                    {isLocked ? (
                      <>
                        <span className={styles.spinner} aria-hidden />{" "}
                        {/* Actualizando… */}
                      </>
                    ) : (
                      willGoIcon
                    )}
                  </button>

                  <button
                    className={`${styles.deleteThreadBtn} ${styles.red} ${
                      validationLock ? styles.disabled : ""
                    }`}
                    title="Borrar hilo"
                    onClick={() =>
                      !validationLock ? setConfirmDeleteId(t.id) : undefined
                    }
                    disabled={validationLock}
                  >
                    <DeleteIcon />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AppModal
        open={confirmDeleteId != null}
        onClose={() => setConfirmDeleteId(null)}
        title="Eliminar hilo"
        subtitle="¿Estás seguro de que deseas eliminar este hilo? Esta acción no se puede deshacer."
        actions={[
          {
            label: "Cancelar",
            type: "cancel",
            onClick: () => setConfirmDeleteId(null),
          },
          { label: "Eliminar", type: "danger", onClick: handleConfirmDelete },
        ]}
      />
    </section>
  );
}
