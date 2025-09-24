// src/stores/messages.ts
"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { MessageRow } from "@/types/review";

type LocalDelivery = "sending" | "sent" | "delivered" | "read";

export type Msg = MessageRow & {
  meta?: {
    localDelivery?: LocalDelivery;
    isMine?: boolean;
  };
};

/* 🗄️ LocalStorage – SWR helpers (mensajes por thread) */
const MSGS_CACHE_VER = 1;
const msgsCacheKey = (threadId: number) => `rev_msgs:v${MSGS_CACHE_VER}:${threadId}`;

type MessagesCachePayload = {
  v: number;
  at: number;
  rows: Msg[];
};

const safeParse = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
};

const loadMessagesCache = (threadId: number): Msg[] | null => {
  if (typeof window === "undefined") return null;
  const payload = safeParse<MessagesCachePayload>(localStorage.getItem(msgsCacheKey(threadId)));
  return payload?.rows ?? null;
};

// No persistimos mensajes con id negativo (optimistas) para no “fijarlos”
const saveMessagesCache = (threadId: number, rows: Msg[]) => {
  if (typeof window === "undefined") return;
  try {
    const rowsStable = rows.filter((m) => (m.id ?? -1) >= 0);
    const payload: MessagesCachePayload = { v: MSGS_CACHE_VER, at: Date.now(), rows: rowsStable };
    localStorage.setItem(msgsCacheKey(threadId), JSON.stringify(payload));
  } catch {console.log("error")}
};

const clearMessagesCache = (threadId: number) => {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(msgsCacheKey(threadId));} catch {console.log("error")}
};

export const messagesCache = {
  load: loadMessagesCache,
  save: saveMessagesCache,
  clear: clearMessagesCache,
};
/* 🗄️ fin helpers caché */

type State = {
  byThread: Record<number, Msg[]>;
  messageToThread: Map<number, number>;
  /** 🔸 auth user id actual */
  selfAuthId: string | null;
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

  upsertFromRealtime: (row: MessageRow) => void;
  removeFromRealtime: (row: MessageRow) => void;
  upsertReceipt: (messageId: number, userId: string, readAt?: string | null) => void;

  moveThreadMessages: (fromThreadId: number, toThreadId: number) => void;
};

const sortByCreatedAt = (a: Msg, b: Msg) =>
  (a.created_at || "").localeCompare(b.created_at || "");

export const useMessagesStore = create<State & Actions>()(
  subscribeWithSelector((set, get) => ({
    byThread: {},
    messageToThread: new Map(),
    selfAuthId: null,

    setSelfAuthId: (id) => set({ selfAuthId: id }),

    setForThread: (threadId, rows) =>
      set((s) => {
        const list = [...rows]
          .map((m) => ({
            ...m,
            thread_id: threadId,
            meta: {
              ...(m.meta || {}),
              localDelivery: (m.meta?.localDelivery ?? "sent") as LocalDelivery,
            },
          }))
          .sort(sortByCreatedAt);

        const next = { ...s.byThread, [threadId]: list };
        const map = new Map(s.messageToThread);
        for (const m of list) if (m.id != null) map.set(m.id, threadId);

        saveMessagesCache(threadId, list); // 🗄️ persist

        return { byThread: next, messageToThread: map };
      }),

    addOptimistic: (threadId, tempId, partial) =>
      set((s) => {
        const list = (s.byThread[threadId] || []).slice();
        list.push({
          ...(partial as any),
          id: tempId,
          thread_id: threadId,
          meta: { ...(partial.meta || {}), localDelivery: "sending", isMine: true },
        });
        list.sort(sortByCreatedAt);
        const next = { ...s.byThread, [threadId]: list };
        const map = new Map(s.messageToThread);
        map.set(tempId, threadId);

        // NO persistimos “sending” con id negativo (no tiene sentido en cache)
        return { byThread: next, messageToThread: map };
      }),

    confirmMessage: (threadId, tempId, real) =>
      set((s) => {
        const curr = s.byThread[threadId] || [];

        if (curr.some((m) => m.id === real.id)) {
          const filtered = curr
            .filter((m) => m.id !== tempId)
            .map((m) =>
              m.id === real.id
                ? {
                    ...m,
                    ...(real as any),
                    meta: {
                      ...(m.meta || {}),
                      localDelivery: "sent",
                      isMine: (m.meta as any)?.isMine ?? true,
                    },
                  }
                : m
            )
            .sort(sortByCreatedAt);

          const map = new Map(s.messageToThread);
          map.delete(tempId);
          map.set(real.id, threadId);

          saveMessagesCache(threadId, filtered); // 🗄️ persist

          return { byThread: { ...s.byThread, [threadId]: filtered }, messageToThread: map };
        }

        const idx = curr.findIndex((m) => m.id === tempId);
        if (idx < 0) {
          const list = [
            ...curr,
            { ...real, thread_id: threadId, meta: { localDelivery: "sent", isMine: true } } as Msg,
          ].sort(sortByCreatedAt);
          const map = new Map(s.messageToThread);
          map.set(real.id, threadId);
          map.delete(tempId);

          saveMessagesCache(threadId, list); // 🗄️ persist

          return { byThread: { ...s.byThread, [threadId]: list }, messageToThread: map };
        }
        const preservedMeta = { ...(curr[idx].meta || {}) };
        const copy = curr.slice();
        copy[idx] = {
          ...copy[idx],
          ...real,
          id: real.id,
          meta: { ...preservedMeta, localDelivery: "sent", isMine: preservedMeta.isMine ?? true },
        };
        copy.sort(sortByCreatedAt);

        const map = new Map(s.messageToThread);
        map.delete(tempId);
        map.set(real.id, threadId);

        saveMessagesCache(threadId, copy); // 🗄️ persist

        return { byThread: { ...s.byThread, [threadId]: copy }, messageToThread: map };
      }),

    // sólo mensajes NO míos + no 'sending' + no 'read'
    markThreadRead: async (threadId) => {
      const { byThread, selfAuthId } = get();
      const list = byThread[threadId] || [];

      const toMark = list
        .filter((m) => {
          if ((m as any).is_system) return false;
          if (m.id == null) return false;
          if (m.created_by === selfAuthId) return false;
          const ld = (m.meta?.localDelivery ?? "sent") as LocalDelivery;
          if (ld === "sending" || ld === "read") return false;
          return true;
        })
        .map((m) => m.id as number);

      if (!toMark.length) return;

      set((s) => {
        const idSet = new Set(toMark);
        const nextList = (s.byThread[threadId] || []).map((m) =>
          !idSet.has(m.id as number)
            ? m
            : { ...m, meta: { ...(m.meta || {}), localDelivery: "read" as LocalDelivery } }
        );

        saveMessagesCache(threadId, nextList); // 🗄️ persist

        return { byThread: { ...s.byThread, [threadId]: nextList } };
      });

      try {
        await fetch("/api/messages/receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: toMark, mark: "read" }),
        });
      } catch { console.log("error"); }
    },

    upsertFromRealtime: (row) =>
      set((s) => {
        const threadId = row.thread_id;
        const curr = s.byThread[threadId] || [];
        const normTxt = (x?: string | null) => (x ?? "").replace(/\s+/g, " ").trim();
        const isSystem = !!row.is_system;

        let preservedMeta: any = null;
        const cleaned = curr.filter((m: any) => {
          if (m.id >= 0) return true;
          if (!!m.is_system !== isSystem) return true;
          if (normTxt(m.text) !== normTxt(row.text)) return true;
          preservedMeta = { ...(m.meta || {}) };
          return false;
        });

        const idx = cleaned.findIndex((m: any) => m.id === row.id);
        if (idx >= 0) {
          const copy = cleaned.slice();
          copy[idx] = {
            ...copy[idx],
            ...(row as any),
            meta: {
              ...(copy[idx].meta || {}),
              ...(preservedMeta || {}),
              localDelivery: "sent",
              isMine: (copy[idx].meta as any)?.isMine ?? (preservedMeta?.isMine ?? false),
            },
          };
          copy.sort(sortByCreatedAt);
          const map = new Map(s.messageToThread);
          map.set(row.id, threadId);

          saveMessagesCache(threadId, copy); // 🗄️ persist

          return { byThread: { ...s.byThread, [threadId]: copy }, messageToThread: map };
        }

        const added = [
          ...cleaned,
          {
            ...(row as any),
            meta: {
              ...(row as any).meta,
              ...(preservedMeta || {}),
              localDelivery: "sent",
              isMine: preservedMeta?.isMine ?? false,
            },
          },
        ].sort(sortByCreatedAt);

        const map = new Map(s.messageToThread);
        map.set(row.id, threadId);

        saveMessagesCache(threadId, added); // 🗄️ persist

        return { byThread: { ...s.byThread, [threadId]: added }, messageToThread: map };
      }),

    removeFromRealtime: (row) =>
      set((s) => {
        const threadId = row.thread_id;
        const curr = s.byThread[threadId] || [];
        const filtered = curr.filter((m) => m.id !== row.id);
        const map = new Map(s.messageToThread);
        map.delete(row.id);

        if (filtered.length) saveMessagesCache(threadId, filtered); // 🗄️ persist
        else clearMessagesCache(threadId); // 🗄️ borrar caché si queda vacío

        return { byThread: { ...s.byThread, [threadId]: filtered }, messageToThread: map };
      }),

    upsertReceipt: (messageId, _userId, readAt) =>
      set((s) => {
        let threadId = s.messageToThread.get(messageId);
        if (!threadId) {
          for (const [tidStr, list] of Object.entries(s.byThread)) {
            if (list.some((m) => m.id === messageId)) {
              threadId = Number(tidStr);
              s.messageToThread.set(messageId, threadId);
              break;
            }
          }
          if (!threadId) return {};
        }

        const curr = s.byThread[threadId] || [];
        const idx = curr.findIndex((m) => m.id === messageId);
        if (idx < 0) return {};

        const copy = curr.slice();
        const prev = copy[idx];
        const nextMeta: LocalDelivery =
          readAt
            ? "read"
            : prev.meta?.localDelivery === "sending"
            ? "sending"
            : "delivered";

        copy[idx] = { ...prev, meta: { ...(prev.meta || {}), localDelivery: nextMeta } };

        saveMessagesCache(threadId, copy); // 🗄️ persist

        return { byThread: { ...s.byThread, [threadId]: copy } };
      }),

    moveThreadMessages: (fromThreadId, toThreadId) =>
      set((s) => {
        if (fromThreadId === toThreadId) return {};
        const from = s.byThread[fromThreadId] || [];
        if (!from.length) {
          if (s.byThread[fromThreadId]) {
            const byThread = { ...s.byThread };
            delete byThread[fromThreadId];
            clearMessagesCache(fromThreadId); // 🗄️
            return { byThread };
          }
          return {};
        }
        const dest = s.byThread[toThreadId] || [];
        const migrated = from.map((m) => ({ ...m, thread_id: toThreadId }));

        const mapById = new Map<number, Msg>();
        for (const m of dest) mapById.set(m.id, m);
        for (const m of migrated) mapById.set(m.id, m);
        const merged = Array.from(mapById.values()).sort(sortByCreatedAt);

        const byThread = { ...s.byThread };
        delete byThread[fromThreadId];
        byThread[toThreadId] = merged;

        const messageToThread = new Map(s.messageToThread);
        for (const m of migrated) messageToThread.set(m.id, toThreadId);

        // 🗄️ actualiza ambos cachés
        clearMessagesCache(fromThreadId);
        saveMessagesCache(toThreadId, merged);

        return { byThread, messageToThread };
      }),
  }))
);
