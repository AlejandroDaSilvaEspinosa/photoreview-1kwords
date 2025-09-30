"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { MessageRow } from "@/types/review";
import { toastError } from "@/hooks/useToast";
import { createVersionedCacheNS } from "@/lib/cache/versioned";
import { makeSessionFlag } from "@/lib/session/flags";
import { preferByRank } from "@/lib/common/rank";

/**
 * Store de mensajes por hilo con:
 * - conciliación optimista por clientNonce
 * - orden estable (displaySeq/displayNano)
 * - cache por hilo (localStorage)
 * - markThreadRead que envía recibos sólo cuando se invoca (desde ImageViewer con handshake)
 * - upsertReceipt que aplica delivered/read al estado local
 */

type LocalDelivery = "sending" | "sent" | "delivered" | "read";

export type Msg = MessageRow & {
  meta?: {
    localDelivery?: LocalDelivery;
    isMine?: boolean;
    displaySeq?: number;
    displayNano?: number;
    clientNonce?: string;
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

const seqPerThread = new Map<number, number>();
function ensureSeqBase(threadId: number, currentList: Msg[]): void {
  const maxVisible = currentList.reduce(
    (max, m) => Math.max(max, m.meta?.displaySeq ?? 0),
    0
  );
  const current = seqPerThread.get(threadId) ?? 0;
  if (current < maxVisible) seqPerThread.set(threadId, maxVisible);
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

function sealDisplayMeta(
  threadId: number,
  incoming: Msg,
  preserved?: Msg["meta"]
): Msg["meta"] {
  const meta = { ...(incoming.meta || {}) };
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
const sortByDisplayStable = (a: Msg, b: Msg): number => {
  const ds = (a.meta?.displaySeq ?? 0) - (b.meta?.displaySeq ?? 0);
  if (ds) return ds;
  const dn = (a.meta?.displayNano ?? 0) - (b.meta?.displayNano ?? 0);
  if (dn) return dn;
  return (a.id ?? 0) - (b.id ?? 0);
};
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
const createMessage = (
  incoming: Partial<Msg>,
  threadId: number,
  preservedMeta?: Msg["meta"]
): Msg => ({
  ...(incoming as Msg),
  thread_id: threadId,
  meta: sealDisplayMeta(threadId, incoming as Msg, preservedMeta),
});
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

type PendingReceipt = {
  status: Exclude<LocalDelivery, "sending" | "sent">;
  fromSelf: boolean;
};
const mergePendingReceipt = (
  existing: PendingReceipt | undefined,
  wanted: PendingReceipt
): PendingReceipt => {
  if (!existing) return wanted;
  const higher =
    DELIVERY_RANK[existing.status] >= DELIVERY_RANK[wanted.status]
      ? existing.status
      : wanted.status;
  return { status: higher, fromSelf: existing.fromSelf || wanted.fromSelf };
};

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

  if (!applicable) return msg; // <-- ya NO borramos nada si no aplica

  // Solo cuando aplicamos eliminamos la entrada
  pendingReceipts.delete(id);

  const current = (msg.meta?.localDelivery ?? "sent") as LocalDelivery;
  const next = preferHigher(current, receipt.status);
  if (next === current) return msg;

  return { ...msg, meta: { ...msg.meta, localDelivery: next } };
}

/* ===== Cache ===== */
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
  } catch {
    return null;
  }
};
// Idle save
const saveMessagesCacheIdle = (() => {
  const pending = new Map<number, Msg[]>();
  let scheduled = false;
  const run = () => {
    scheduled = false;
    for (const [tid, rows] of pending) {
      const stableRows = rows.filter((m) => (m.id ?? -1) >= 0);
      try {
        msgsCache.save(String(tid), { rows: stableRows });
      } catch {
        //TODO: TOAST DEBUG
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
    if (ric) ric(run);
    else setTimeout(run, 30);
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
  } catch {
    //todo: toast debug
  }
};
export const messagesCache = {
  load: loadMessagesCache,
  save: saveMessagesCache,
  clear: clearMessagesCache,
};

/* ===== Store ===== */
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
      set((state) => {
        const prevList = state.byThread[threadId] || [];
        ensureSeqBase(threadId, prevList);

        const prevById = buildPrevById(prevList);
        const pendingReceipts = new Map(state.pendingReceipts);
        const { selfAuthId } = state;

        const mapped = rows.map((incoming) => {
          const prev =
            incoming.id != null ? prevById.get(incoming.id) : undefined;
          const mergedDelivery = preferHigher(
            (prev?.meta?.localDelivery as LocalDelivery | undefined) ?? "sent",
            (incoming.meta?.localDelivery as LocalDelivery | undefined) ??
              "sent"
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

        const deDuped = dedupeByClientNonce(mapped).sort(sortByDisplayStable);

        const newByThread = { ...state.byThread, [threadId]: deDuped };
        const newMessageToThread = indexMessagesInThread(
          state.messageToThread,
          threadId,
          deDuped
        );

        saveMessagesCache(threadId, deDuped);

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
          const preserved = { ...list[idxOptimistic].meta };
          const updated = [...list];

          let msg = createMessage(
            {
              ...real,
              meta: {
                ...real.meta,
                localDelivery: preferHigher(
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
                localDelivery: preferHigher(
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

        // Inserción directa
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

      // Optimismo local + marca de "ya enviado" por sesión
      for (const id of toMark) {
        readFlag.mark(id);
      }
      // Encola read en el outbox de recibos (batch+debounce)
      try {
        const { enqueueRead } = await import("@/lib/net/receiptsOutbox");
        enqueueRead(toMark);
      } catch (error) {
        toastError(error, {
          title: "No se pudo encolar lectura",
          fallback: "Reintentaremos en segundo plano.",
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

        // Dedupe por clientNonce (optimistas)
        if (clientNonce) {
          const idx = working.findIndex(
            (m) => (m.id ?? 0) < 0 && m.meta?.clientNonce === clientNonce
          );
          if (idx >= 0) {
            preservedMeta = { ...working[idx].meta };
            working = [...working.slice(0, idx), ...working.slice(idx + 1)];
          }
        }

        // Fallback dedupe simple por texto para 1º reemplazo
        if (!preservedMeta) {
          let removed = false;
          const targetText = (row as any).text
            ? String((row as any).text)
                .replace(/\s+/g, " ")
                .trim()
            : "";
          working = working.filter((m: any) => {
            if ((m.id ?? 0) >= 0 || removed) return true;
            const isSys = !!m.is_system;
            const isSystemMatch = isSys === isSystem;
            const textMatch =
              (m.text || "").replace(/\s+/g, " ").trim() === targetText;
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
              displayAt:
                (row as any)?.meta?.displayAt ??
                (row as any)?.created_at ??
                new Date().toISOString(),
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

        // resolver threadId
        let threadId = state.messageToThread.get(messageId);
        if (!threadId) {
          for (const [tidStr, messages] of Object.entries(state.byThread)) {
            if (messages.some((m) => m.id === messageId)) {
              threadId = Number(tidStr);
              break;
            }
          }
        }
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

        // Aplicar solo si tiene sentido (mis mensajes reciben recibos de otros; los suyos, recibos míos)
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

        const migrated = fromMessages.map((m) => ({
          ...m,
          thread_id: toThreadId,
        }));

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
  }))
);

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

export function inspectMessageById(id: number): {
  ld: LocalDelivery | null;
  isMine: boolean;
} {
  const st = useMessagesStore.getState();
  const tid = st.messageToThread.get(id);
  if (!tid) return { ld: null, isMine: false };
  const list = st.byThread[tid] || [];
  const m = list.find((x) => x.id === id);
  if (!m) return { ld: null, isMine: false };
  const ld = (m.meta?.localDelivery ?? null) as LocalDelivery | null;
  const isMine = !!st.selfAuthId && (m as any).created_by === st.selfAuthId;
  return { ld, isMine };
}

export const hasUnreadInThread = (threadId: number): boolean => {
  const st = useMessagesStore.getState();
  if (!st.selfAuthId) return false;
  const list = st.byThread[threadId] || [];

  return list.some(
    (m) =>
      !(m as any).is_system &&
      m.id != null &&
      (m as any).created_by != "me" &&
      (m as any).created_by != null &&
      (m as any).created_by !== st.selfAuthId &&
      (m.meta?.localDelivery ?? "sent") !== "read" &&
      (m.meta?.localDelivery ?? "sent") !== "sent"
  );
};
