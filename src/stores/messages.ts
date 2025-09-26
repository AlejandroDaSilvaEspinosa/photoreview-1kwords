// src/stores/messages.ts
"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { MessageRow } from "@/types/review";
import { emitToast, toastError } from "@/hooks/useToast";
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
  };
};

const DELIVERY_RANK: Record<LocalDelivery, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

const preferHigher = preferByRank<LocalDelivery>(DELIVERY_RANK);
const sortByCreatedAt = (a: Msg, b: Msg) => (a.created_at || "").localeCompare(b.created_at || "");

/* =========================
   Cache SWR (localStorage) por thread
   ========================= */

const MSGS_CACHE_VER = 2;
const msgsCache = createVersionedCacheNS<{ rows: Msg[] }>("rev_msgs", MSGS_CACHE_VER);

const loadMessagesCache = (threadId: number): Msg[] | null => {
  if (typeof window === "undefined") return null;
  const payload = msgsCache.load(String(threadId));
  return payload?.rows ?? null;
};

const saveMessagesCache = (threadId: number, rows: Msg[]) => {
  if (typeof window === "undefined") return;
  const rowsStable = rows.filter((m) => (m.id ?? -1) >= 0);
  msgsCache.save(String(threadId), { rows: rowsStable });
};

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
  upsertFromRealtime: (row: MessageRow) => void;
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
        const prevById = new Map<number, Msg>();
        for (const m of prevList) if (m.id != null) prevById.set(m.id, m);

        const pend = new Map(s.pendingReceipts);
        const selfId = s.selfAuthId;

        const list = [...rows]
          .map((incoming) => {
            const prev = incoming.id != null ? prevById.get(incoming.id) : null;

            const incomingLD = (incoming.meta?.localDelivery ?? "sent") as LocalDelivery;
            const prevLD = (prev?.meta?.localDelivery ?? "sent") as LocalDelivery;
            const mergedLD = preferHigher(prevLD, incomingLD);

            const base: Msg = {
              ...incoming,
              thread_id: threadId,
              meta: {
                ...(incoming.meta || {}),
                localDelivery: mergedLD,
                isMine: prev?.meta?.isMine ?? incoming.meta?.isMine ?? undefined,
              },
            };

            if (incoming.id != null) {
              const pr = pend.get(incoming.id);
              if (pr && selfId) {
                const isMine = incoming.created_by === selfId;
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
          })
          .sort(sortByCreatedAt);

        const next = { ...s.byThread, [threadId]: list };
        const map = new Map(s.messageToThread);
        for (const m of list) if (m.id != null) map.set(m.id, threadId);

        saveMessagesCache(threadId, list);
        return { byThread: next, messageToThread: map, pendingReceipts: pend };
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
        return { byThread: next, messageToThread: map };
      }),

    confirmMessage: (threadId, tempId, real) =>
      set((s) => {
        const pend = new Map(s.pendingReceipts);
        const curr = s.byThread[threadId] || [];
        const selfId = s.selfAuthId;

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
                      localDelivery: preferHigher(m.meta?.localDelivery as LocalDelivery, "sent"),
                      isMine: (m.meta as any)?.isMine ?? true,
                    },
                  }
                : m
            )
            .sort(sortByCreatedAt);

          const pr = pend.get(real.id!);
          if (pr && selfId) {
            const isMine = real.created_by === selfId;
            const applicable = isMine ? !pr.fromSelf : pr.fromSelf;
            if (applicable) {
              const idx = filtered.findIndex((x) => x.id === real.id);
              if (idx >= 0) {
                const prevLD = (filtered[idx].meta?.localDelivery ?? "sent") as LocalDelivery;
                filtered[idx] = {
                  ...filtered[idx],
                  meta: { ...(filtered[idx].meta || {}), localDelivery: preferHigher(prevLD, pr.status) },
                };
                pend.delete(real.id!);
              }
            }
          }

          const map = new Map(s.messageToThread);
          map.delete(tempId);
          map.set(real.id!, threadId);
          saveMessagesCache(threadId, filtered);

          return { byThread: { ...s.byThread, [threadId]: filtered }, messageToThread: map, pendingReceipts: pend };
        }

        const idx = curr.findIndex((m) => m.id === tempId);
        if (idx < 0) {
          const list = [
            ...curr,
            { ...real, thread_id: threadId, meta: { localDelivery: "sent", isMine: true } } as Msg,
          ].sort(sortByCreatedAt);

          const pr = pend.get(real.id!);
          if (pr && selfId) {
            const isMine = real.created_by === selfId;
            const applicable = isMine ? !pr.fromSelf : pr.fromSelf;
            if (applicable) {
              const j = list.findIndex((x) => x.id === real.id);
              if (j >= 0) {
                const prevLD = (list[j].meta?.localDelivery ?? "sent") as LocalDelivery;
                list[j] = {
                  ...list[j],
                  meta: { ...(list[j].meta || {}), localDelivery: preferHigher(prevLD, pr.status) },
                };
                pend.delete(real.id!);
              }
            }
          }

          const map = new Map(s.messageToThread);
          map.set(real.id!, threadId);
          map.delete(tempId);
          saveMessagesCache(threadId, list);
          return { byThread: { ...s.byThread, [threadId]: list }, messageToThread: map, pendingReceipts: pend };
        }

        const preservedMeta = { ...(curr[idx].meta || {}) };
        const copy = curr.slice();
        copy[idx] = {
          ...copy[idx],
          ...real,
          id: real.id,
          meta: {
            ...preservedMeta,
            localDelivery: preferHigher("sent", preservedMeta.localDelivery as LocalDelivery),
            isMine: preservedMeta.isMine ?? true,
          },
        };
        copy.sort(sortByCreatedAt);

        const pr = pend.get(real.id!);
        if (pr && selfId) {
          const isMine = real.created_by === selfId;
          const applicable = isMine ? !pr.fromSelf : pr.fromSelf;
          if (applicable) {
            const prevLD = (copy[idx].meta?.localDelivery ?? "sent") as LocalDelivery;
            copy[idx] = { ...copy[idx], meta: { ...(copy[idx].meta || {}), localDelivery: preferHigher(prevLD, pr.status) } };
            pend.delete(real.id!);
          }
        }

        const map = new Map(s.messageToThread);
        map.delete(tempId);
        map.set(real.id!, threadId);
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
          if (m.created_by === selfAuthId) return false;
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
        const pend = new Map(s.pendingReceipts);
        const selfId = s.selfAuthId;

        if (idx >= 0) {
          const copy = cleaned.slice();
          const prevLD = (copy[idx].meta?.localDelivery ?? "sent") as LocalDelivery;
          const baseLD: LocalDelivery = prevLD === "sending" ? "sent" : prevLD;

          copy[idx] = {
            ...copy[idx],
            ...(row as any),
            meta: {
              ...(copy[idx].meta || {}),
              ...(preservedMeta || {}),
              localDelivery: baseLD,
              isMine: (copy[idx].meta as any)?.isMine ?? (preservedMeta?.isMine ?? false),
            },
          };

          const pr = pend.get(row.id!);
          if (pr && selfId) {
            const isMine = row.created_by === selfId;
            const applicable = isMine ? !pr.fromSelf : pr.fromSelf;
            if (applicable) {
              const prev = (copy[idx].meta?.localDelivery ?? "sent") as LocalDelivery;
              copy[idx].meta!.localDelivery = preferHigher(prev, pr.status);
              pend.delete(row.id!);
            }
          }

          copy.sort(sortByCreatedAt);
          const map = new Map(s.messageToThread);
          map.set(row.id!, threadId);
          saveMessagesCache(threadId, copy);
          return { byThread: { ...s.byThread, [threadId]: copy }, messageToThread: map, pendingReceipts: pend };
        }

        const baseLD: LocalDelivery = "sent";
        const nextLD: LocalDelivery = preservedMeta?.localDelivery
          ? preferHigher(preservedMeta.localDelivery as LocalDelivery, baseLD)
          : baseLD;

        const added = [
          ...cleaned,
          {
            ...(row as any),
            meta: {
              ...(row as any).meta,
              ...(preservedMeta || {}),
              localDelivery: nextLD,
              isMine: preservedMeta?.isMine ?? false,
            },
          },
        ].sort(sortByCreatedAt);

        const pr = pend.get(row.id!);
        if (pr && selfId) {
          const i = added.findIndex((m: any) => m.id === row.id);
          if (i >= 0) {
            const isMine = row.created_by === selfId;
            const applicable = isMine ? !pr.fromSelf : pr.fromSelf;
            if (applicable) {
              const prev = (added[i].meta?.localDelivery ?? "sent") as LocalDelivery;
              added[i].meta!.localDelivery = preferHigher(prev, pr.status);
              pend.delete(row.id!);
            }
          }
        }

        const map = new Map(s.messageToThread);
        map.set(row.id!, threadId);
        saveMessagesCache(threadId, added);
        return { byThread: { ...s.byThread, [threadId]: added }, messageToThread: map, pendingReceipts: pend };
      }),

    removeFromRealtime: (row) =>
      set((s) => {
        const threadId = row.thread_id;
        const curr = s.byThread[threadId] || [];
        const filtered = curr.filter((m) => m.id !== row.id);
        const map = new Map(s.messageToThread);
        map.delete(row.id!);
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
          const nextStatus = !prev ? want : (DELIVERY_RANK[prev.status] >= DELIVERY_RANK[want] ? prev.status : want);
          pend.set(messageId, { status: nextStatus, fromSelf });
          return { pendingReceipts: pend };
        }

        const curr = s.byThread[threadId] || [];
        const idx = curr.findIndex((m) => m.id === messageId);
        if (idx < 0) {
          const pend = new Map(s.pendingReceipts);
          const prev = pend.get(messageId);
          const nextStatus = !prev ? want : (DELIVERY_RANK[prev.status] >= DELIVERY_RANK[want] ? prev.status : want);
          pend.set(messageId, { status: nextStatus, fromSelf });
          return { pendingReceipts: pend };
        }

        const copy = curr.slice();
        const msg = copy[idx];
        const isMine = !!selfId && msg.created_by === selfId;

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
        const migrated = from.map((m) => ({ ...m, thread_id: toThreadId }));
        const mapById = new Map<number, Msg>();
        for (const m of dest) mapById.set(m.id!, m);
        for (const m of migrated) mapById.set(m.id!, m);
        const merged = Array.from(mapById.values()).sort(sortByCreatedAt);
        const byThread = { ...s.byThread };
        delete byThread[fromThreadId];
        byThread[toThreadId] = merged;
        const messageToThread = new Map(s.messageToThread);
        for (const m of migrated) messageToThread.set(m.id!, toThreadId);
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
          const isMine = msg.created_by === selfAuthId;
          const curr = (msg.meta?.localDelivery ?? "sent") as LocalDelivery;

          if (!isSystem && !isMine && curr === "sent") {
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
  if (s.selfAuthId && msg.created_by === s.selfAuthId) return "mine";
  const ld = (msg.meta?.localDelivery ?? "sent") as LocalDelivery;
  if (ld === "read") return "read";
  if (ld === "delivered") return "delivered";
  return "sent";
}
