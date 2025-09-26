// src/stores/messages.ts
"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { MessageRow } from "@/types/review";
import { toastError } from "@/hooks/useToast";
import { createVersionedCacheNS } from "@/lib/cache/versioned";
import { makeSessionFlag } from "@/lib/session/flags";
import { preferByRank } from "@/lib/common/rank";

/* =========================
   Tipos y utilidades base
   ========================= */

type LocalDelivery = "sending" | "sent" | "delivered" | "read";

export type Msg = MessageRow & {
  meta?: {
    localDelivery?: LocalDelivery;
    isMine?: boolean;

    /** Orden visual inmutable por hilo. */
    displaySeq?: number;

    /** Desempate ultrafino, asignado una vez al crear (anti-colisiones raras). */
    displayNano?: number;

    /** Correlación cliente-servidor para reconciliar optimistas. */
    clientNonce?: string;

    /** Timestamp decorativo (no afecta al orden). */
    displayAt?: string;
  };
};

const DELIVERY_RANK: Record<LocalDelivery, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

const preferHigher = preferByRank<LocalDelivery>(DELIVERY_RANK);

/** Secuenciadores por hilo para displaySeq (en memoria). */
const seqPerThread = new Map<number, number>();

/** Asegura que el contador interno esté sincronizado con el máximo visible. */
function ensureSeqBase(threadId: number, currentList: Msg[]) {
  const maxVisible = currentList.reduce((mx, m) => Math.max(mx, m.meta?.displaySeq ?? 0), 0);
  const curr = seqPerThread.get(threadId) ?? 0;
  if (curr < maxVisible) seqPerThread.set(threadId, maxVisible);
}

const nextSeq = (threadId: number) => {
  const n = (seqPerThread.get(threadId) ?? 0) + 1;
  seqPerThread.set(threadId, n);
  return n;
};

const nextNano = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? (performance.now() % 1) / 1e6
    : Math.random() / 1e6;

/** Asegura display* inmutables preservando si existía. */
function sealDisplayMeta(threadId: number, incoming: Msg, preserved?: Msg["meta"]) {
  const meta = { ...(incoming.meta || {}) };

  // IMPORTANTE: displaySeq NO se recalcula si ya existía.
  if (typeof meta.displaySeq !== "number") {
    meta.displaySeq =
      typeof preserved?.displaySeq === "number" ? preserved!.displaySeq : nextSeq(threadId);
  }

  if (typeof meta.displayNano !== "number") {
    meta.displayNano =
      typeof preserved?.displayNano === "number" ? preserved!.displayNano : nextNano();
  }

  if (!meta.displayAt) {
    meta.displayAt =
      preserved?.displayAt ??
      incoming.created_at ??
      (incoming as any).createdAt ??
      new Date().toISOString();
  }

  if (preserved?.clientNonce && !meta.clientNonce) meta.clientNonce = preserved.clientNonce;
  if (typeof preserved?.isMine === "boolean" && typeof meta.isMine !== "boolean") {
    meta.isMine = preserved.isMine;
  }
  return meta;
}

/** Comparador ultraestable: 1º displaySeq, 2º displayNano, 3º id. (created_at NO afecta) */
const sortByDisplayStable = (a: Msg, b: Msg) => {
  const ds = (a.meta?.displaySeq ?? 0) - (b.meta?.displaySeq ?? 0);
  if (ds) return ds;
  const dn = (a.meta?.displayNano ?? 0) - (b.meta?.displayNano ?? 0);
  if (dn) return dn;
  return (a.id ?? 0) - (b.id ?? 0);
};

/* =========================
   Cache SWR (localStorage) por thread
   ========================= */

const MSGS_CACHE_VER = 6; // bump: sort solo por seq + nano
const msgsCache = createVersionedCacheNS<{ rows: Msg[] }>("rev_msgs", MSGS_CACHE_VER);

const loadMessagesCache = (threadId: number): Msg[] | null => {
  if (typeof window === "undefined") return null;
  const payload = msgsCache.load(String(threadId));
  return payload?.rows ?? null;
};

// Guardado idle/debounced para evitar jank
const saveMessagesCacheIdle = (() => {
  const pending = new Map<number, Msg[]>();
  let scheduled = false;

  const run = () => {
    scheduled = false;
    for (const [tid, rows] of pending) {
      const rowsStable = rows.filter((m) => (m.id ?? -1) >= 0);
      try {
        msgsCache.save(String(tid), { rows: rowsStable });
      } catch {}
    }
    pending.clear();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void) => number)
      | undefined;
    if (ric) ric(run);
    else setTimeout(run, 50);
  };

  return (threadId: number, rows: Msg[]) => {
    pending.set(threadId, rows);
    schedule();
  };
})();

const saveMessagesCache = (threadId: number, rows: Msg[]) =>
  saveMessagesCacheIdle(threadId, rows);

const clearMessagesCache = (threadId: number) => {
  if (typeof window === "undefined") return;
  msgsCache.clear(String(threadId));
};

export const messagesCache = { load: loadMessagesCache, save: saveMessagesCache, clear: clearMessagesCache };

/* =========================
   Estado + acciones
   ========================= */

type PendingReceipt = { status: Exclude<LocalDelivery, "sending" | "sent">; fromSelf: boolean };

export type MessagesStoreState = {
  byThread: Record<number, Msg[]>;
  messageToThread: Map<number, number>;
  selfAuthId: string | null;
  pendingReceipts: Map<number, PendingReceipt>;
};

type Actions = {
  setForThread: (threadId: number, rows: Msg[]) => void;
  setSelfAuthId: (id: string | null) => void;
  addOptimistic: (
    threadId: number,
    tempId: number,
    partial: Omit<Msg, "id" | "thread_id"> & Partial<Pick<Msg, "id">>
  ) => void;
  confirmMessage: (threadId: number, tempId: number, real: Msg) => void;
  markThreadRead: (threadId: number) => Promise<void>;
  upsertFromRealtime: (row: MessageRow & { client_nonce?: string | null }) => void;
  removeFromRealtime: (row: MessageRow) => void;
  upsertReceipt: (messageId: number, userId: string, readAt?: string | null) => void;
  moveThreadMessages: (fromThreadId: number, toThreadId: number) => void;

  markDeliveredLocalIfSent: (messageIds: number[]) => void;

  quickStateByMessageId: (id: number) => QuickState;
};

const readFlag = makeSessionFlag("ack:read:v1");

export const useMessagesStore = create<MessagesStoreState & Actions>()(
  subscribeWithSelector((set, get) => ({
    byThread: {},
    messageToThread: new Map(),
    selfAuthId: null,
    pendingReceipts: new Map(),

    setSelfAuthId: (id) => set({ selfAuthId: id }),

    setForThread: (threadId, rows) =>
      set((s) => {
        const prevList = s.byThread[threadId] || [];
        ensureSeqBase(threadId, prevList);

        const prevById = new Map<number, Msg>();
        for (const m of prevList) if (m.id != null) prevById.set(m.id, m);

        const pend = new Map(s.pendingReceipts);
        const selfId = s.selfAuthId;

        // Asignamos displaySeq a los nuevos según el orden recibido (preservando los existentes)
        const mapped = rows.map((incoming) => {
          const prev = incoming.id != null ? prevById.get(incoming.id) : null;

          const incomingLD = (incoming.meta?.localDelivery ?? "sent") as LocalDelivery;
          const prevLD = (prev?.meta?.localDelivery ?? "sent") as LocalDelivery;
          const mergedLD = preferHigher(prevLD, incomingLD);

          const base: Msg = {
            ...incoming,
            thread_id: threadId,
            meta: {
              ...sealDisplayMeta(threadId, incoming as Msg, prev?.meta),
              localDelivery: mergedLD,
              isMine: prev?.meta?.isMine ?? incoming.meta?.isMine ?? undefined,
            },
          };

          if (incoming.id != null) {
            const pr = pend.get(incoming.id);
            if (pr && selfId) {
              const isMine = (incoming as any).created_by === selfId;
              const applicable = isMine ? !pr.fromSelf : pr.fromSelf;
              if (applicable) {
                base.meta!.localDelivery = preferHigher(
                  (base.meta!.localDelivery ?? "sent") as LocalDelivery,
                  pr.status
                );
                pend.delete(incoming.id);
              }
            }
          }
          return base;
        });

        const list = mapped.sort(sortByDisplayStable);

        const next = { ...s.byThread, [threadId]: list };
        const map = new Map(s.messageToThread);
        for (const m of list) if (m.id != null) map.set(m.id, threadId);

        saveMessagesCache(threadId, list);
        return { byThread: next, messageToThread: map, pendingReceipts: pend };
      }),

    addOptimistic: (threadId, tempId, partial) =>
      set((s) => {
        const prevList = s.byThread[threadId] || [];
        ensureSeqBase(threadId, prevList);

        const nowIso = new Date().toISOString();
        const list = prevList.slice();

        const clientNonce =
          partial.meta?.clientNonce ||
          (typeof crypto !== "undefined" && "randomUUID" in crypto
            ? (crypto as any).randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

        const base: Msg = {
          ...(partial as any),
          id: tempId,
          thread_id: threadId,
          meta: {
            ...(partial.meta || {}),
            clientNonce,
            localDelivery: "sending",
            isMine: true,
            displayAt: partial.created_at ?? nowIso,
            displaySeq: nextSeq(threadId),
            displayNano: nextNano(),
          },
        };
        list.push(base);

        // Ordenar por si la lista previa no estaba perfectamente ordenada.
        list.sort(sortByDisplayStable);

        const next = { ...s.byThread, [threadId]: list };
        const map = new Map(s.messageToThread);
        map.set(tempId, threadId);
        return { byThread: next, messageToThread: map };
      }),

    confirmMessage: (threadId, tempId, real) =>
      set((s) => {
        const pend = new Map(s.pendingReceipts);
        const curr = s.byThread[threadId] || [];
        const selfId = s.selfAuthId;
        ensureSeqBase(threadId, curr);

        // Si ya existe real (p.ej. por realtime antes): sustituye y preserva display*
        if (curr.some((m) => m.id === real.id)) {
          const filtered = curr.filter((m) => m.id !== tempId);
          const idxReal = filtered.findIndex((m) => m.id === real.id);
          if (idxReal >= 0) {
            const prevItem = filtered[idxReal];
            const prevSeq = prevItem.meta?.displaySeq;
            const replaced: Msg = {
              ...prevItem,
              ...(real as any),
              meta: {
                ...(sealDisplayMeta(threadId, real as any, prevItem.meta)),
                localDelivery: preferHigher(prevItem.meta?.localDelivery as LocalDelivery, "sent"),
                isMine: (prevItem.meta as any)?.isMine ?? true,
              },
            };
            const arr = filtered.slice();
            arr[idxReal] = replaced;

            // Solo resort si cambiara el seq (no debería)
            const needSort = replaced.meta?.displaySeq !== prevSeq;
            if (needSort) arr.sort(sortByDisplayStable);

            const pr = real.id ? pend.get(real.id) : undefined;
            if (pr && selfId) {
              const isMine = (real as any).created_by === selfId;
              const applicable = isMine ? !pr.fromSelf : pr.fromSelf;
              if (applicable) {
                const prevLD = (arr[idxReal].meta?.localDelivery ?? "sent") as LocalDelivery;
                arr[idxReal] = {
                  ...arr[idxReal],
                  meta: {
                    ...(arr[idxReal].meta || {}),
                    localDelivery: preferHigher(prevLD, pr.status),
                  },
                };
                pend.delete(real.id!);
              }
            }

            const map = new Map(s.messageToThread);
            map.delete(tempId);
            if (real.id != null) map.set(real.id!, threadId);
            saveMessagesCache(threadId, arr);

            return {
              byThread: { ...s.byThread, [threadId]: arr },
              messageToThread: map,
              pendingReceipts: pend,
            };
          }
        }

        // Si no existe real y tampoco está el tempId → insertar real (asignando display* preservado si había por nonce)
        const idxTemp = curr.findIndex((m) => m.id === tempId);
        if (idxTemp < 0) {
          const item: Msg = {
            ...real,
            thread_id: threadId,
            meta: {
              ...(sealDisplayMeta(threadId, real as any)),
              localDelivery: "sent",
              isMine: true,
            },
          };
          const list = [...curr, item];
          list.sort(sortByDisplayStable);

          const pr = real.id ? pend.get(real.id) : undefined;
          if (pr && selfId) {
            const j = list.findIndex((x) => x.id === real.id);
            if (j >= 0) {
              const prevLD = (list[j].meta?.localDelivery ?? "sent") as LocalDelivery;
              list[j] = {
                ...list[j],
                meta: {
                  ...(list[j].meta || {}),
                  localDelivery: preferHigher(prevLD, pr.status),
                },
              };
              if (real.id != null) pend.delete(real.id!);
            }
          }

          const map = new Map(s.messageToThread);
          if (real.id != null) map.set(real.id!, threadId);
          map.delete(tempId);
          saveMessagesCache(threadId, list);
          return { byThread: { ...s.byThread, [threadId]: list }, messageToThread: map, pendingReceipts: pend };
        }

        // Reemplazar tempId in-place: preservar display*
        const preservedMeta = { ...(curr[idxTemp].meta || {}) };
        const prevSeq = preservedMeta.displaySeq;
        const copy = curr.slice();
        copy[idxTemp] = {
          ...copy[idxTemp],
          ...real,
          id: real.id,
          meta: {
            ...(sealDisplayMeta(threadId, real as any, preservedMeta)),
            localDelivery: preferHigher("sent", preservedMeta.localDelivery as LocalDelivery),
            isMine: preservedMeta.isMine ?? true,
          },
        };

        if (copy[idxTemp].meta?.displaySeq !== prevSeq) {
          copy.sort(sortByDisplayStable);
        }

        const pr = real.id ? pend.get(real.id) : undefined;
        if (pr && selfId) {
          const isMine = (real as any).created_by === selfId;
          const applicable = isMine ? !pr.fromSelf : pr.fromSelf;
          if (applicable) {
            const prevLD = (copy[idxTemp].meta?.localDelivery ?? "sent") as LocalDelivery;
            copy[idxTemp] = {
              ...copy[idxTemp],
              meta: { ...(copy[idxTemp].meta || {}), localDelivery: preferHigher(prevLD, pr.status) },
            };
            if (real.id != null) pend.delete(real.id!);
          }
        }

        const map = new Map(s.messageToThread);
        map.delete(tempId);
        if (real.id != null) map.set(real.id!, threadId);
        saveMessagesCache(threadId, copy);
        return { byThread: { ...s.byThread, [threadId]: copy }, messageToThread: map, pendingReceipts: pend };
      }),

    markThreadRead: async (threadId) => {
      const { byThread, selfAuthId } = get();
      if (!selfAuthId) return;

      const list = byThread[threadId] || [];
      if (!list.length) return;

      const toMark = list
        .filter((m) => {
          const isSystem = (m as any).is_system;
          if (isSystem) return false;
          if (m.id == null) return false;
          if ((m as any).created_by === selfAuthId) return false;
          const ld = (m.meta?.localDelivery ?? "sent") as LocalDelivery;
          if (ld === "sending") return false;
          return !readFlag.has(m.id as number);
        })
        .map((m) => m.id as number);

      if (!toMark.length) return;

      try {
        await fetch("/api/messages/receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: toMark, mark: "read" }),
        }).catch((e) => {
          toastError(e, { title: "No se pudo confirmar lectura", fallback: "Seguiremos intentando más tarde." });
        });
      } finally {
        for (const id of toMark) readFlag.mark(id);
      }
    },

    upsertFromRealtime: (row) =>
      set((s) => {
        const threadId = row.thread_id;
        const curr = s.byThread[threadId] || [];
        ensureSeqBase(threadId, curr);

        const normTxt = (x?: string | null) => (x ?? "").replace(/\s+/g, " ").trim();
        const isSystem = !!(row as any).is_system;

        // Dedupe optimista por clientNonce (preferente)
        let preservedMeta: any = null;
        let cleaned = curr;
        const clientNonce = (row as any).client_nonce ?? (row as any).clientNonce ?? null;

        if (clientNonce) {
          const idxByNonce = curr.findIndex(
            (m: any) => (m.id ?? 0) < 0 && m.meta?.clientNonce && m.meta.clientNonce === clientNonce
          );
          if (idxByNonce >= 0) {
            preservedMeta = { ...(curr[idxByNonce].meta || {}) };
            cleaned = [...curr.slice(0, idxByNonce), ...curr.slice(idxByNonce + 1)];
          }
        }

        // Fallback: dedupe por texto eliminando SOLO un optimista equivalente
        if (!preservedMeta) {
          let removed = false;
          cleaned = curr.filter((m: any) => {
            if ((m.id ?? 0) >= 0) return true;
            if (removed) return true;
            const mIsSystem = !!m.is_system;
            const isSystemMatch = mIsSystem === isSystem;
            const textMatch = normTxt(m.text) === normTxt((row as any).text);
            if (isSystemMatch && textMatch) {
              preservedMeta = { ...(m.meta || {}) };
              removed = true; // ✅ solo uno
              return false;
            }
            return true;
          });
        }

        const idx = cleaned.findIndex((m: any) => m.id === (row as any).id);
        const pend = new Map(s.pendingReceipts);
        const selfId = s.selfAuthId;

        if (idx >= 0) {
          // Update in-place (no degradar LD)
          const copy = cleaned.slice();
          const prevItem = copy[idx];
          const prevSeq = prevItem.meta?.displaySeq;
          copy[idx] = {
            ...prevItem,
            ...(row as any),
            meta: {
              ...(sealDisplayMeta(threadId, row as any, { ...prevItem.meta, ...preservedMeta })),
              localDelivery:
                (prevItem.meta?.localDelivery ?? "sent") === "sending"
                  ? "sent"
                  : (prevItem.meta?.localDelivery ?? "sent"),
              isMine:
                (prevItem.meta as any)?.isMine ??
                (preservedMeta?.isMine ??
                  (!!selfId && ((row as any).created_by === selfId ? true : false))),
            },
          };

          if (copy[idx].meta?.displaySeq !== prevSeq) {
            copy.sort(sortByDisplayStable);
          }

          const pr = (row as any).id ? pend.get((row as any).id) : undefined;
          if (pr && selfId) {
            const isMine = (row as any).created_by === selfId;
            const applicable = isMine ? !pr.fromSelf : pr.fromSelf;
            if (applicable) {
              const prev = (copy[idx].meta?.localDelivery ?? "sent") as LocalDelivery;
              copy[idx].meta!.localDelivery = preferHigher(prev, pr.status);
              pend.delete((row as any).id!);
            }
          }

          const map = new Map(s.messageToThread);
          if ((row as any).id != null) map.set((row as any).id!, threadId);
          saveMessagesCache(threadId, copy);
          return { byThread: { ...s.byThread, [threadId]: copy }, messageToThread: map, pendingReceipts: pend };
        }

        // Nuevo entrante (preserva si había meta de optimista)
        const inserted: Msg = {
          ...(row as any),
          meta: {
            ...(sealDisplayMeta(threadId, row as any, preservedMeta)),
            localDelivery: "sent",
            isMine:
              preservedMeta?.isMine ??
              (!!selfId && ((row as any).created_by === selfId ? true : false)),
            clientNonce: clientNonce ?? preservedMeta?.clientNonce,
          },
        };

        const added = [...cleaned, inserted];
        // Resort para asegurar orden por seq (aunque inserte al final)
        added.sort(sortByDisplayStable);

        const pr = (row as any).id ? pend.get((row as any).id) : undefined;
        if (pr && selfId) {
          const i = added.findIndex((m: any) => m.id === (row as any).id);
          if (i >= 0) {
            const isMine = (row as any).created_by === selfId;
            const applicable = isMine ? !pr.fromSelf : pr.fromSelf;
            if (applicable) {
              const prev = (added[i].meta?.localDelivery ?? "sent") as LocalDelivery;
              added[i].meta!.localDelivery = preferHigher(prev, pr.status);
              pend.delete((row as any).id!);
            }
          }
        }

        const map = new Map(s.messageToThread);
        if ((row as any).id != null) map.set((row as any).id!, threadId);
        saveMessagesCache(threadId, added);
        return { byThread: { ...s.byThread, [threadId]: added }, messageToThread: map, pendingReceipts: pend };
      }),

    removeFromRealtime: (row) =>
      set((s) => {
        const threadId = row.thread_id;
        const curr = s.byThread[threadId] || [];
        const filtered = curr.filter((m) => m.id !== (row as any).id);
        const map = new Map(s.messageToThread);
        if ((row as any).id != null) map.delete((row as any).id!);
        if (filtered.length) saveMessagesCache(threadId, filtered);
        else clearMessagesCache(threadId);
        return { byThread: { ...s.byThread, [threadId]: filtered }, messageToThread: map };
      }),

    upsertReceipt: (messageId, userId, readAt) =>
      set((s) => {
        const selfId = s.selfAuthId;
        const want: Exclude<LocalDelivery, "sending" | "sent"> = readAt ? "read" : "delivered";
        const fromSelf = !!selfId && userId === selfId;

        let threadId = s.messageToThread.get(messageId);
        if (!threadId) {
          for (const [tidStr, list] of Object.entries(s.byThread)) {
            if (list.some((m) => m.id === messageId)) {
              threadId = Number(tidStr);
              s.messageToThread.set(messageId, threadId);
              break;
            }
          }
        }
        if (!threadId) {
          const pend = new Map(s.pendingReceipts);
          const prev = pend.get(messageId);
          const nextStatus =
            !prev ? want : DELIVERY_RANK[prev.status] >= DELIVERY_RANK[want] ? prev.status : want;
          pend.set(messageId, { status: nextStatus, fromSelf });
          return { pendingReceipts: pend };
        }

        const curr = s.byThread[threadId] || [];
        const idx = curr.findIndex((m) => m.id === messageId);
        if (idx < 0) {
          const pend = new Map(s.pendingReceipts);
          const prev = pend.get(messageId);
          const nextStatus =
            !prev ? want : DELIVERY_RANK[prev.status] >= DELIVERY_RANK[want] ? prev.status : want;
          pend.set(messageId, { status: nextStatus, fromSelf });
          return { pendingReceipts: pend };
        }

        const copy = curr.slice();
        const msg = copy[idx];
        const isMine = !!selfId && (msg as any).created_by === selfId;

        if ((isMine && fromSelf) || (!isMine && !fromSelf)) return {};

        const prevLD = (msg.meta?.localDelivery ?? "sent") as LocalDelivery;
        const nextLD = preferHigher(prevLD, want);
        if (nextLD === prevLD) return {};

        copy[idx] = { ...msg, meta: { ...(msg.meta || {}), localDelivery: nextLD } };
        saveMessagesCache(threadId, copy);
        const pend = new Map(s.pendingReceipts);
        pend.delete(messageId);
        return { byThread: { ...s.byThread, [threadId]: copy }, pendingReceipts: pend };
      }),

    moveThreadMessages: (fromThreadId, toThreadId) =>
      set((s) => {
        if (fromThreadId === toThreadId) return {};
        const from = s.byThread[fromThreadId] || [];
        if (!from.length) {
          if (s.byThread[fromThreadId]) {
            const byThread = { ...s.byThread };
            delete byThread[fromThreadId];
            clearMessagesCache(fromThreadId);
            return { byThread };
          }
          return {};
        }
        const dest = s.byThread[toThreadId] || [];

        // Inicializa secuencia destino con el máximo actual
        ensureSeqBase(toThreadId, dest);

        // Migra preservando display*
        const migrated = from.map((m) => ({
          ...m,
          thread_id: toThreadId,
          meta: {
            ...(m.meta || {}),
          },
        }));

        const mapById = new Map<number, Msg>();
        for (const m of dest) if (m.id != null) mapById.set(m.id!, m);
        for (const m of migrated) if (m.id != null) mapById.set(m.id!, m);
        const merged = Array.from(mapById.values()).sort(sortByDisplayStable);

        const byThread = { ...s.byThread };
        delete byThread[fromThreadId];
        byThread[toThreadId] = merged;

        const messageToThread = new Map(s.messageToThread);
        for (const m of migrated) if (m.id != null) messageToThread.set(m.id!, toThreadId);

        clearMessagesCache(fromThreadId);
        saveMessagesCache(toThreadId, merged);
        return { byThread, messageToThread };
      }),

    markDeliveredLocalIfSent: (messageIds: number[]) =>
      set((s) => {
        if (!messageIds?.length) return {};
        const { selfAuthId } = s;
        if (!selfAuthId) return {};

        const changedThreads = new Set<number>();
        for (const mid of messageIds) {
          const tid = s.messageToThread.get(mid);
          if (!tid) continue;
          const list = s.byThread[tid] || [];
          const idx = list.findIndex((m) => m.id === mid);
          if (idx < 0) continue;

          const msg = list[idx];
          const isSystem = (msg as any).is_system;
          const isMine = (msg as any).created_by === selfAuthId;
          const currLD = (msg.meta?.localDelivery ?? "sent") as LocalDelivery;

          if (!isSystem && !isMine && currLD === "sent") {
            const next = list.slice();
            next[idx] = { ...msg, meta: { ...(msg.meta || {}), localDelivery: "delivered" } };
            s.byThread[tid] = next;
            changedThreads.add(tid);
          }
        }

        if (!changedThreads.size) return {};
        for (const tid of changedThreads) saveMessagesCache(tid, s.byThread[tid]);
        return { byThread: { ...s.byThread } };
      }),

    quickStateByMessageId: (id: number) => internalQuickState(get(), id),
  }))
);

/* ===================================================
   Utilidades de estado rápido
   =================================================== */

export type QuickState = "unknown" | "system" | "mine" | "read" | "delivered" | "sent";

function internalQuickState(s: MessagesStoreState, id: number): QuickState {
  const tid = s.messageToThread.get(id);
  if (!tid) return "unknown";
  const list = s.byThread[tid] || [];
  const msg = list.find((m) => m.id === id);
  if (!msg) return "unknown";
  if ((msg as any).is_system) return "system";
  if (s.selfAuthId && (msg as any).created_by === s.selfAuthId) return "mine";
  const ld = (msg.meta?.localDelivery ?? "sent") as LocalDelivery;
  if (ld === "read") return "read";
  if (ld === "delivered") return "delivered";
  return "sent";
}
