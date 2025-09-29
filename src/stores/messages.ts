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
   Types and Base Utilities
   ========================= */

type LocalDelivery = "sending" | "sent" | "delivered" | "read";

export type Msg = MessageRow & {
  meta?: {
    localDelivery?: LocalDelivery;
    isMine?: boolean;
    /** Immutable visual order per thread. */
    displaySeq?: number;
    /** Ultra-fine tiebreaker, assigned once on creation (anti-collision). */
    displayNano?: number;
    /** Client-server correlation for optimistic reconciliation. */
    clientNonce?: string;
    /** Decorative timestamp (does not affect order). */
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

/** Thread sequencers for displaySeq (in memory). */
const seqPerThread = new Map<number, number>();

/** Ensures internal counter is synced with the visible maximum. */
function ensureSeqBase(threadId: number, currentList: Msg[]): void {
  const maxVisible = currentList.reduce(
    (max, m) => Math.max(max, m.meta?.displaySeq ?? 0),
    0
  );
  const current = seqPerThread.get(threadId) ?? 0;
  if (current < maxVisible) {
    seqPerThread.set(threadId, maxVisible);
  }
}

// === Dedupe fuerte por clientNonce (prefiere real vs optimista, mejor delivery, fecha más nueva)
function dedupeByClientNonce(list: Msg[]): Msg[] {
  const byNonce = new Map<string, Msg>();
  const noNonce: Msg[] = [];

  const rank = (x?: LocalDelivery) =>
    DELIVERY_RANK[(x ?? "sent") as LocalDelivery];

  for (const m of list) {
    const nonce = m.meta?.clientNonce;
    if (!nonce) {
      noNonce.push(m);
      continue;
    }

    const prev = byNonce.get(nonce);
    if (!prev) {
      byNonce.set(nonce, m);
      continue;
    }

    const prevId = prev.id ?? -Infinity;
    const curId = m.id ?? -Infinity;

    // preferencias: real (id>=0) > optimista; luego delivery más alta; luego fecha más nueva
    const winner =
      curId >= 0 && prevId < 0
        ? m
        : curId < 0 && prevId >= 0
        ? prev
        : rank(m.meta?.localDelivery) > rank(prev.meta?.localDelivery)
        ? m
        : new Date((m as any).created_at ?? 0).getTime() >=
          new Date((prev as any).created_at ?? 0).getTime()
        ? m
        : prev;

    byNonce.set(nonce, winner);
  }
  return [...noNonce, ...byNonce.values()];
}

const nextSeq = (threadId: number): number => {
  const n = (seqPerThread.get(threadId) ?? 0) + 1;
  seqPerThread.set(threadId, n);
  return n;
};

const nextNano = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? (performance.now() % 1) / 1e6
    : Math.random() / 1e6;

/** Ensures immutable display* metadata preserving existing values. */
function sealDisplayMeta(
  threadId: number,
  incoming: Msg,
  preserved?: Msg["meta"]
): Msg["meta"] {
  const meta = { ...(incoming.meta || {}) };

  // IMPORTANT: displaySeq is NOT recalculated if it already existed.
  if (typeof meta.displaySeq !== "number") {
    meta.displaySeq =
      typeof preserved?.displaySeq === "number"
        ? preserved.displaySeq
        : nextSeq(threadId);
  }

  if (typeof meta.displayNano !== "number") {
    meta.displayNano =
      typeof preserved?.displayNano === "number"
        ? preserved.displayNano
        : nextNano();
  }

  if (!meta.displayAt) {
    meta.displayAt =
      preserved?.displayAt ??
      (incoming as any).meta?.displayAt ??
      (incoming as any).created_at ??
      (incoming as any).createdAt ??
      new Date().toISOString();
  }

  if (preserved?.clientNonce && !meta.clientNonce) {
    meta.clientNonce = preserved.clientNonce;
  }

  if (
    typeof preserved?.isMine === "boolean" &&
    typeof meta.isMine !== "boolean"
  ) {
    meta.isMine = preserved.isMine;
  }

  return meta;
}

/** Ultra-stable comparator: 1st displaySeq, 2nd displayNano, 3rd id. (created_at does NOT affect) */
const sortByDisplayStable = (a: Msg, b: Msg): number => {
  const ds = (a.meta?.displaySeq ?? 0) - (b.meta?.displaySeq ?? 0);
  if (ds) return ds;

  const dn = (a.meta?.displayNano ?? 0) - (b.meta?.displayNano ?? 0);
  if (dn) return dn;

  return (a.id ?? 0) - (b.id ?? 0);
};

/* =========================
   SWR Cache (localStorage) per thread
   ========================= */

const MSGS_CACHE_VER = 6;
const msgsCache = createVersionedCacheNS<{ rows: Msg[] }>(
  "rev_msgs",
  MSGS_CACHE_VER
);

const loadMessagesCache = (threadId: number): Msg[] | null => {
  if (typeof window === "undefined") return null;
  try {
    const payload = msgsCache.load(String(threadId));
    return payload?.rows ?? null;
  } catch (error) {
    console.warn(`Failed to load cache for thread ${threadId}:`, error);
    return null;
  }
};

// Idle/debounced save to prevent jank
const saveMessagesCacheIdle = (() => {
  const pending = new Map<number, Msg[]>();
  let scheduled = false;

  const run = () => {
    scheduled = false;
    for (const [tid, rows] of pending) {
      const stableRows = rows.filter((m) => (m.id ?? -1) >= 0);
      try {
        msgsCache.save(String(tid), { rows: stableRows });
      } catch (error) {
        console.warn(`Failed to save cache for thread ${tid}:`, error);
      }
    }
    pending.clear();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;

    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void) => number)
      | undefined;
    if (ric) {
      ric(run);
    } else {
      setTimeout(run, 50);
    }
  };

  return (threadId: number, rows: Msg[]) => {
    pending.set(threadId, rows);
    schedule();
  };
})();

const saveMessagesCache = (threadId: number, rows: Msg[]): void => {
  saveMessagesCacheIdle(threadId, rows);
};

const clearMessagesCache = (threadId: number): void => {
  if (typeof window === "undefined") return;
  try {
    msgsCache.clear(String(threadId));
  } catch (error) {
    console.warn(`Failed to clear cache for thread ${threadId}:`, error);
  }
};

export const messagesCache = {
  load: loadMessagesCache,
  save: saveMessagesCache,
  clear: clearMessagesCache,
};

/* =========================
   Helpers (nuevos) para eliminar duplicación
   ========================= */

type PendingReceipt = {
  status: Exclude<LocalDelivery, "sending" | "sent">;
  fromSelf: boolean;
};

const mergeLocalDelivery = (
  prev?: LocalDelivery,
  incoming?: LocalDelivery
): LocalDelivery => preferHigher(prev ?? "sent", incoming ?? "sent");

const normalizeText = (text?: string | null): string =>
  (text ?? "").replace(/\s+/g, " ").trim();

const getDisplayIso = (row: any): string =>
  row?.meta?.displayAt ??
  row?.created_at ??
  row?.createdAt ??
  new Date().toISOString();

const buildPrevById = (list: Msg[]): Map<number, Msg> => {
  const map = new Map<number, Msg>();
  for (const m of list) if (m.id != null) map.set(m.id, m);
  return map;
};

const indexMessagesInThread = (
  baseMap: Map<number, number>,
  threadId: number,
  msgs: Msg[]
): Map<number, number> => {
  const map = new Map(baseMap);
  for (const m of msgs) if (m.id != null) map.set(m.id, threadId);
  return map;
};

function mergePendingReceipt(
  existing: PendingReceipt | undefined,
  wanted: PendingReceipt
): PendingReceipt {
  if (!existing) return wanted;
  const higher =
    DELIVERY_RANK[existing.status] >= DELIVERY_RANK[wanted.status]
      ? existing.status
      : wanted.status;
  // Si cambia el “fromSelf” a true en algún momento, lo preservamos (es la condición más restrictiva).
  return { status: higher, fromSelf: existing.fromSelf || wanted.fromSelf };
}

function applyAndConsumeReceipt(
  msg: Msg,
  pendingReceipts: Map<number, PendingReceipt>,
  selfId: string | null
): Msg {
  const id = msg.id;
  if (id == null || !selfId) return msg;
  const receipt = pendingReceipts.get(id);
  if (!receipt) return msg;

  const isMine = (msg as any).created_by === selfId;
  const applicable = isMine ? !receipt.fromSelf : receipt.fromSelf;

  if (!applicable) {
    // Consumimos igualmente para evitar reciclar un recibo ya inválido para esta dirección.
    pendingReceipts.delete(id);
    return msg;
  }

  const current = (msg.meta?.localDelivery ?? "sent") as LocalDelivery;
  const next = preferHigher(current, receipt.status);
  pendingReceipts.delete(id);

  if (next === current) return msg;
  return { ...msg, meta: { ...msg.meta, localDelivery: next } };
}

const createMessage = (
  incoming: Partial<Msg>,
  threadId: number,
  preservedMeta?: Msg["meta"]
): Msg => ({
  ...(incoming as Msg),
  thread_id: threadId,
  meta: sealDisplayMeta(threadId, incoming as Msg, preservedMeta),
});

/* =========================
   State + Actions
   ========================= */

type MsgHydrationSrc = "cache" | "live" | "realtime";

export type MessagesStoreState = {
  byThread: Record<number, Msg[]>;
  messageToThread: Map<number, number>;
  selfAuthId: string | null;
  pendingReceipts: Map<number, PendingReceipt>;

  // NUEVO: tracking de hidratación por hilo y epoch de no leídos
  hydrationByThread: Map<number, MsgHydrationSrc>;
  unreadEpochByThread: Map<number, number>;
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
  upsertFromRealtime: (
    row: MessageRow & { client_nonce?: string | null }
  ) => void;
  removeFromRealtime: (row: MessageRow) => void;
  upsertReceipt: (
    messageId: number,
    userId: string,
    readAt?: string | null
  ) => void;
  moveThreadMessages: (fromThreadId: number, toThreadId: number) => void;
  markDeliveredLocalIfSent: (messageIds: number[]) => void;
  quickStateByMessageId: (id: number) => QuickState;

  // NUEVO
  markThreadMessagesHydrated: (threadId: number, src: MsgHydrationSrc) => void;
  bumpUnreadEpoch: (threadId: number) => void;
  getUnreadEpoch: (threadId: number) => number;
};

const readFlag = makeSessionFlag("ack:read:v1");

export const useMessagesStore = create<MessagesStoreState & Actions>()(
  subscribeWithSelector((set, get) => ({
    byThread: {},
    messageToThread: new Map(),
    selfAuthId: null,
    pendingReceipts: new Map(),

    // NUEVO
    hydrationByThread: new Map(),
    unreadEpochByThread: new Map(),

    setSelfAuthId: (id) => set({ selfAuthId: id }),

    setForThread: (threadId, rows) =>
      set((state) => {
        const prevList = state.byThread[threadId] || [];
        ensureSeqBase(threadId, prevList);

        const prevById = buildPrevById(prevList);
        const pendingReceipts = new Map(state.pendingReceipts);
        const { selfAuthId } = state;

        const mapped = rows.map((incoming) => {
          const prev =
            incoming.id != null ? prevById.get(incoming.id) : undefined;
          const mergedDelivery = mergeLocalDelivery(
            prev?.meta?.localDelivery as LocalDelivery | undefined,
            incoming.meta?.localDelivery as LocalDelivery | undefined
          );

          let msg = createMessage(
            {
              ...incoming,
              meta: {
                ...incoming.meta,
                localDelivery: mergedDelivery,
                isMine: prev?.meta?.isMine ?? incoming.meta?.isMine,
              },
            },
            threadId,
            prev?.meta
          );

          msg = applyAndConsumeReceipt(msg, pendingReceipts, selfAuthId);
          return msg;
        });

        const deDuped = dedupeByClientNonce(mapped);
        const sorted = deDuped.sort(sortByDisplayStable);

        const newByThread = { ...state.byThread, [threadId]: sorted };
        const newMessageToThread = indexMessagesInThread(
          state.messageToThread,
          threadId,
          sorted
        );

        saveMessagesCache(threadId, sorted);

        return {
          byThread: newByThread,
          messageToThread: newMessageToThread,
          pendingReceipts,
        };
      }),

    addOptimistic: (threadId, tempId, partial) =>
      set((state) => {
        const prevList = state.byThread[threadId] || [];
        ensureSeqBase(threadId, prevList);

        const nowIso = new Date().toISOString();
        const clientNonce =
          partial.meta?.clientNonce ||
          (typeof crypto !== "undefined" && "randomUUID" in crypto
            ? (crypto as any).randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

        const optimistic = createMessage(
          {
            ...(partial as any),
            id: tempId,
            meta: {
              ...(partial.meta || {}),
              clientNonce,
              localDelivery: "sending",
              isMine: true,
              displayAt: (partial as any).created_at ?? nowIso,
              displaySeq: nextSeq(threadId),
              displayNano: nextNano(),
            },
          },
          threadId
        );

        const updated = [...prevList, optimistic].sort(sortByDisplayStable);
        const newByThread = { ...state.byThread, [threadId]: updated };
        const newMessageToThread = new Map(state.messageToThread);
        newMessageToThread.set(tempId, threadId);

        return { byThread: newByThread, messageToThread: newMessageToThread };
      }),

    confirmMessage: (threadId, tempId, real) =>
      set((state) => {
        const pendingReceipts = new Map(state.pendingReceipts);
        const list = state.byThread[threadId] || [];
        const { selfAuthId } = state;

        ensureSeqBase(threadId, list);

        const idxOptimistic = list.findIndex((m) => m.id === tempId);
        const idxByRealId = list.findIndex((m) => m.id === (real as any).id);

        if (idxOptimistic >= 0) {
          // Sustituir optimista por real (preservando meta display*)
          const preserved = { ...list[idxOptimistic].meta };
          const updated = [...list];

          let msg = createMessage(
            {
              ...real,
              meta: {
                ...real.meta,
                localDelivery: mergeLocalDelivery(
                  "sent",
                  preserved.localDelivery as LocalDelivery
                ),
                isMine: preserved.isMine ?? true,
              },
            },
            threadId,
            preserved
          );

          msg = applyAndConsumeReceipt(msg, pendingReceipts, selfAuthId);
          updated[idxOptimistic] = msg;

          const newMessageToThread = new Map(state.messageToThread);
          newMessageToThread.delete(tempId);
          if ((real as any).id != null)
            newMessageToThread.set((real as any).id, threadId);

          const cleaned = dedupeByClientNonce(updated);
          saveMessagesCache(threadId, cleaned);

          return {
            byThread: { ...state.byThread, [threadId]: cleaned },
            messageToThread: newMessageToThread,
            pendingReceipts,
          };
        }

        // Ya entró por realtime: si existe por id real → actualizar, NO insertar
        if (idxByRealId >= 0) {
          const prev = list[idxByRealId];
          const updated = [...list];

          let msg = createMessage(
            {
              ...prev,
              ...real,
              meta: {
                ...prev.meta,
                ...real.meta,
                localDelivery: mergeLocalDelivery(
                  prev.meta?.localDelivery as LocalDelivery | undefined,
                  real.meta?.localDelivery as LocalDelivery | undefined
                ),
                isMine:
                  (prev.meta?.isMine ?? false) ||
                  (!!selfAuthId && (real as any).created_by === selfAuthId),
              },
            },
            threadId,
            { ...prev.meta }
          );

          msg = applyAndConsumeReceipt(msg, pendingReceipts, selfAuthId);
          updated[idxByRealId] = msg;

          const cleaned = dedupeByClientNonce(updated);
          saveMessagesCache(threadId, cleaned);

          return {
            byThread: { ...state.byThread, [threadId]: cleaned },
            pendingReceipts,
          };
        }

        // Caso normal: insertar real
        let msg = createMessage(
          {
            ...real,
            meta: { ...real.meta, localDelivery: "sent", isMine: true },
          },
          threadId
        );
        msg = applyAndConsumeReceipt(msg, pendingReceipts, selfAuthId);

        const updated = [...list, msg];
        const cleaned = dedupeByClientNonce(updated).sort(sortByDisplayStable);

        const newMessageToThread =
          (real as any).id != null
            ? indexMessagesInThread(state.messageToThread, threadId, [msg])
            : new Map(state.messageToThread);

        saveMessagesCache(threadId, cleaned);

        return {
          byThread: { ...state.byThread, [threadId]: cleaned },
          messageToThread: newMessageToThread,
          pendingReceipts,
        };
      }),

    markThreadRead: async (threadId) => {
      const { byThread, selfAuthId } = get();
      if (!selfAuthId) return;

      const messages = byThread[threadId] || [];
      if (!messages.length) return;

      const toMark = messages
        .filter((m) => {
          const isSystem = (m as any).is_system;
          if (isSystem || m.id == null || (m as any).created_by === selfAuthId)
            return false;

          const delivery = (m.meta?.localDelivery ?? "sent") as LocalDelivery;
          return delivery !== "sending" && !readFlag.has(m.id as number);
        })
        .map((m) => m.id as number);

      if (!toMark.length) return;

      try {
        await fetch("/api/messages/receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: toMark, mark: "read" }),
        });
        for (const id of toMark) readFlag.mark(id);
      } catch (error) {
        toastError(error, {
          title: "No se pudo confirmar lectura",
          fallback: "Seguiremos intentando más tarde.",
        });
      }
    },

    upsertFromRealtime: (row) =>
      set((state) => {
        const threadId = row.thread_id;
        const list = state.byThread[threadId] || [];
        ensureSeqBase(threadId, list);

        const isSystem = !!(row as any).is_system;
        const clientNonce =
          (row as any).client_nonce ?? (row as any).clientNonce ?? null;

        let preservedMeta: Msg["meta"] | null = null;
        let working = list;

        // Dedupe preferente por clientNonce (optimistas)
        if (clientNonce) {
          const idx = working.findIndex(
            (m) => (m.id ?? 0) < 0 && m.meta?.clientNonce === clientNonce
          );
          if (idx >= 0) {
            preservedMeta = { ...working[idx].meta };
            working = [...working.slice(0, idx), ...working.slice(idx + 1)];
          }
        }

        // Fallback: dedupe por texto (una sola vez)
        if (!preservedMeta) {
          let removed = false;
          const targetText = normalizeText((row as any).text);
          working = working.filter((m: any) => {
            if ((m.id ?? 0) >= 0 || removed) return true;
            const isSys = !!m.is_system;
            const isSystemMatch = isSys === isSystem;
            const textMatch = normalizeText(m.text) === targetText;
            if (isSystemMatch && textMatch) {
              preservedMeta = { ...m.meta };
              removed = true;
              return false;
            }
            return true;
          });
        }

        const pendingReceipts = new Map(state.pendingReceipts);
        const { selfAuthId } = state;

        const existingIdx = working.findIndex((m) => m.id === (row as any).id);
        if (existingIdx >= 0) {
          // Update existente
          const prev = working[existingIdx];
          const updated = [...working];

          let msg = createMessage(
            {
              ...(row as any),
              meta: {
                ...((row as any).meta || {}),
                localDelivery:
                  prev.meta?.localDelivery === "sending"
                    ? "sent"
                    : prev.meta?.localDelivery ?? "sent",
                isMine:
                  prev.meta?.isMine ??
                  preservedMeta?.isMine ??
                  (!!selfAuthId && (row as any).created_by === selfAuthId),
                clientNonce:
                  clientNonce ??
                  preservedMeta?.clientNonce ??
                  prev.meta?.clientNonce,
              },
            },
            threadId,
            { ...prev.meta, ...preservedMeta }
          );

          msg = applyAndConsumeReceipt(msg, pendingReceipts, selfAuthId);
          updated[existingIdx] = msg;

          const cleaned = dedupeByClientNonce(updated);
          const newMessageToThread = (row as any).id
            ? indexMessagesInThread(state.messageToThread, threadId, [msg])
            : new Map(state.messageToThread);

          saveMessagesCache(threadId, cleaned);

          return {
            byThread: { ...state.byThread, [threadId]: cleaned },
            messageToThread: newMessageToThread,
            pendingReceipts,
          };
        }

        // Insert nuevo
        let msg = createMessage(
          {
            ...(row as any),
            meta: {
              ...((row as any).meta || {}),
              localDelivery: "sent",
              isMine:
                preservedMeta?.isMine ??
                (!!selfAuthId && (row as any).created_by === selfAuthId),
              clientNonce: clientNonce ?? preservedMeta?.clientNonce,
              displayAt: getDisplayIso(row),
            },
          },
          threadId,
          preservedMeta || undefined
        );

        msg = applyAndConsumeReceipt(msg, pendingReceipts, selfAuthId);

        const updated = [...working, msg];
        const cleaned = dedupeByClientNonce(updated).sort(sortByDisplayStable);
        const newMessageToThread =
          (row as any).id != null
            ? indexMessagesInThread(state.messageToThread, threadId, [msg])
            : new Map(state.messageToThread);

        saveMessagesCache(threadId, cleaned);

        return {
          byThread: { ...state.byThread, [threadId]: cleaned },
          messageToThread: newMessageToThread,
          pendingReceipts,
        };
      }),

    removeFromRealtime: (row) =>
      set((state) => {
        const threadId = row.thread_id;
        const list = state.byThread[threadId] || [];
        const filtered = list.filter((m) => m.id !== (row as any).id);

        const newMessageToThread = new Map(state.messageToThread);
        if ((row as any).id != null) newMessageToThread.delete((row as any).id);

        if (filtered.length) saveMessagesCache(threadId, filtered);
        else clearMessagesCache(threadId);

        return {
          byThread: { ...state.byThread, [threadId]: filtered },
          messageToThread: newMessageToThread,
        };
      }),

    upsertReceipt: (messageId, userId, readAt) =>
      set((state) => {
        const { selfAuthId } = state;
        const wantedStatus: Exclude<LocalDelivery, "sending" | "sent"> = readAt
          ? "read"
          : "delivered";
        const fromSelf = !!selfAuthId && userId === selfAuthId;

        // Resolver threadId (índice o búsqueda)
        let threadId = state.messageToThread.get(messageId);
        if (!threadId) {
          for (const [tidStr, messages] of Object.entries(state.byThread)) {
            if (messages.some((m) => m.id === messageId)) {
              threadId = Number(tidStr);
              break;
            }
          }
        }

        // Si seguimos sin thread, guardar como pendiente
        if (!threadId) {
          const pendingReceipts = new Map(state.pendingReceipts);
          const merged = mergePendingReceipt(pendingReceipts.get(messageId), {
            status: wantedStatus,
            fromSelf,
          });
          pendingReceipts.set(messageId, merged);
          return { pendingReceipts };
        }

        const list = state.byThread[threadId] || [];
        const idx = list.findIndex((m) => m.id === messageId);

        // No está aún el mensaje → guardar pendiente
        if (idx < 0) {
          const pendingReceipts = new Map(state.pendingReceipts);
          const merged = mergePendingReceipt(pendingReceipts.get(messageId), {
            status: wantedStatus,
            fromSelf,
          });
          pendingReceipts.set(messageId, merged);
          return { pendingReceipts };
        }

        const msg = list[idx];
        const isMine = !!selfAuthId && (msg as any).created_by === selfAuthId;

        // Solo aplicamos si tiene sentido (mis mensajes: recibo de otros; sus mensajes: recibo mío)
        if ((isMine && fromSelf) || (!isMine && !fromSelf)) {
          return {};
        }

        const current = (msg.meta?.localDelivery ?? "sent") as LocalDelivery;
        const next = preferHigher(current, wantedStatus);
        if (next === current) return {};

        const updated = [...list];
        updated[idx] = { ...msg, meta: { ...msg.meta, localDelivery: next } };

        saveMessagesCache(threadId, updated);

        const pendingReceipts = new Map(state.pendingReceipts);
        pendingReceipts.delete(messageId);

        return {
          byThread: { ...state.byThread, [threadId]: updated },
          pendingReceipts,
        };
      }),

    moveThreadMessages: (fromThreadId, toThreadId) =>
      set((state) => {
        if (fromThreadId === toThreadId) return {};

        const fromMessages = state.byThread[fromThreadId] || [];
        if (!fromMessages.length) {
          if (state.byThread[fromThreadId]) {
            const newByThread = { ...state.byThread };
            delete newByThread[fromThreadId];
            clearMessagesCache(fromThreadId);
            return { byThread: newByThread };
          }
          return {};
        }

        const toMessages = state.byThread[toThreadId] || [];
        ensureSeqBase(toThreadId, toMessages);

        // Preservamos meta/orden; no “re-asignamos” displaySeq.
        const migrated = fromMessages.map((m) => ({
          ...m,
          thread_id: toThreadId,
        }));

        // Merge: para ids >=0 dedupe por id; para negativos (optimistas) los preservamos.
        const byId = new Map<number, Msg>();
        for (const m of toMessages)
          if (m.id != null && m.id >= 0) byId.set(m.id, m);
        for (const m of migrated)
          if (m.id != null && m.id >= 0) byId.set(m.id, m);

        const positives = Array.from(byId.values());
        const negatives = [...toMessages, ...migrated].filter(
          (m) => (m.id ?? 0) < 0
        );

        const merged = [...positives, ...negatives].sort(sortByDisplayStable);

        const newByThread = { ...state.byThread };
        delete newByThread[fromThreadId];
        newByThread[toThreadId] = merged;

        const newMessageToThread = new Map(state.messageToThread);
        for (const m of migrated)
          if (m.id != null && m.id >= 0)
            newMessageToThread.set(m.id, toThreadId);

        clearMessagesCache(fromThreadId);
        saveMessagesCache(toThreadId, merged);

        return { byThread: newByThread, messageToThread: newMessageToThread };
      }),

    markDeliveredLocalIfSent: (messageIds: number[]) =>
      set((state) => {
        if (!messageIds?.length || !state.selfAuthId) return {};

        const changedThreads = new Set<number>();
        const newByThread = { ...state.byThread };

        for (const messageId of messageIds) {
          const threadId = state.messageToThread.get(messageId);
          if (!threadId) continue;

          const messages = newByThread[threadId] || [];
          const idx = messages.findIndex((m) => m.id === messageId);
          if (idx < 0) continue;

          const msg = messages[idx];
          const isSystem = (msg as any).is_system;
          const isMine = (msg as any).created_by === state.selfAuthId;
          const current = (msg.meta?.localDelivery ?? "sent") as LocalDelivery;

          if (!isSystem && !isMine && current === "sent") {
            const updated = [...messages];
            updated[idx] = {
              ...msg,
              meta: { ...msg.meta, localDelivery: "delivered" },
            };
            newByThread[threadId] = updated;
            changedThreads.add(threadId);
          }
        }

        if (!changedThreads.size) return {};

        for (const threadId of changedThreads)
          saveMessagesCache(threadId, newByThread[threadId]);
        return { byThread: newByThread };
      }),

    quickStateByMessageId: (id: number) => internalQuickState(get(), id),

    // ===== NUEVO: hidratación y epoch =====
    markThreadMessagesHydrated: (threadId, src) =>
      set((state) => {
        const map = new Map(state.hydrationByThread);
        const prev = map.get(threadId);
        // No degradar (realtime > live > cache)
        if (prev === "realtime") return {};
        if (prev === "live" && src === "cache") return {};
        if (prev === src) return {};
        map.set(threadId, src);
        return { hydrationByThread: map };
      }),

    bumpUnreadEpoch: (threadId) =>
      set((state) => {
        const m = new Map(state.unreadEpochByThread);
        const next = (m.get(threadId) ?? 0) + 1;
        m.set(threadId, next);
        return { unreadEpochByThread: m };
      }),

    getUnreadEpoch: (threadId) => get().unreadEpochByThread.get(threadId) ?? 0,
  }))
);

/* ===================================================
   Quick State Utilities
   =================================================== */

export type QuickState =
  | "unknown"
  | "system"
  | "mine"
  | "read"
  | "delivered"
  | "sent";

function internalQuickState(state: MessagesStoreState, id: number): QuickState {
  const threadId = state.messageToThread.get(id);
  if (!threadId) return "unknown";

  const messages = state.byThread[threadId] || [];
  const message = messages.find((m) => m.id === id);

  if (!message) return "unknown";
  if ((message as any).is_system) return "system";
  if (state.selfAuthId && (message as any).created_by === state.selfAuthId)
    return "mine";

  const delivery = (message.meta?.localDelivery ?? "sent") as LocalDelivery;
  switch (delivery) {
    case "read":
      return "read";
    case "delivered":
      return "delivered";
    default:
      return "sent";
  }
}
