// src/stores/threads.ts
"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ThreadStatus, ThreadRow } from "@/types/review";
import { useMessagesStore } from "@/stores/messages";
import { createVersionedCacheNS } from "@/lib/cache/versioned";
import { roundTo, pointKey } from "@/lib/common/coords";

export type Thread = {
  id: number;
  x: number;
  y: number;
  status: ThreadStatus;
  messageIds?: number[];
};

type ByImage = Record<string, Thread[]>;

type PendingStatus = { from: ThreadStatus; to: ThreadStatus; at: number };

type State = {
  byImage: ByImage;
  threadToImage: Map<number, string>;
  pendingByKey: Map<string, number>;
  activeThreadId: number | null;
  pendingStatus: Map<number, PendingStatus>;
};

const THREADS_CACHE_VER = 2;
const threadsCache = createVersionedCacheNS<{ rows: Thread[] }>(
  "rev_threads",
  THREADS_CACHE_VER,
);

const loadThreadsCache = (image: string): Thread[] | null => {
  if (typeof window === "undefined") return null;
  const payload = threadsCache.load(image);
  return payload?.rows ?? null;
};

const saveThreadsCache = (image: string, rows: Thread[]) => {
  if (typeof window === "undefined") return;
  threadsCache.save(image, { rows });
};

const clearThreadsCache = (image: string) => {
  if (typeof window === "undefined") return;
  threadsCache.clear(image);
};

export const threadsCacheApi = {
  load: loadThreadsCache,
  save: saveThreadsCache,
  clear: clearThreadsCache,
};

// === Helpers de diff/reconciliación ===
const eqArr = (a?: number[], b?: number[]) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const sameThread = (a: Thread, b: Thread) =>
  a.id === b.id &&
  a.status === b.status &&
  a.x === b.x &&
  a.y === b.y &&
  eqArr(a.messageIds, b.messageIds);

const defer = (fn: () => void) =>
  (window as any)?.requestIdleCallback?.(fn) ?? setTimeout(fn, 0);

type Actions = {
  hydrateForImage: (imageName: string, rows: Thread[]) => void;

  createOptimistic: (imageName: string, x: number, y: number) => number;
  confirmCreate: (tempId: number, real: ThreadRow) => void;
  rollbackCreate: (tempId: number) => void;

  upsertFromRealtime: (row: ThreadRow) => void;
  removeFromRealtime: (row: ThreadRow) => void;

  setStatus: (threadId: number, status: ThreadStatus) => void;
  setMessageIds: (threadId: number, ids: number[]) => void;

  setActiveThreadId: (id: number | null) => void;

  beginStatusOptimistic: (
    threadId: number,
    from: ThreadStatus,
    to: ThreadStatus,
  ) => void;
  clearPendingStatus: (threadId: number) => void;
};

export const useThreadsStore = create<State & Actions>()(
  subscribeWithSelector((set, get) => ({
    byImage: {},
    threadToImage: new Map(),
    pendingByKey: new Map(),
    activeThreadId: null,
    pendingStatus: new Map(),

    setActiveThreadId: (id) => set({ activeThreadId: id }),

    hydrateForImage: (image, rows) => {
      const incoming: Thread[] = rows.map((r) => ({
        id: r.id,
        x: roundTo(r.x, 3),
        y: roundTo(r.y, 3),
        status: r.status as ThreadStatus,
      }));

      const sNow = useThreadsStore.getState();
      const prev = sNow.byImage[image] || [];

      const optimistic = prev.filter((t) => t.id < 0);

      const prevById = new Map(prev.map((t) => [t.id, t]));
      let changed = false;

      const nextBase: Thread[] = incoming.map((t) => {
        const old = prevById.get(t.id);
        if (!old) {
          changed = true;
          return t;
        }
        const merged: Thread = { ...old, x: t.x, y: t.y, status: t.status };
        if (!sameThread(old, merged)) changed = true;
        return sameThread(old, merged) ? old : merged;
      });

      if (!changed) {
        const incomingIds = new Set(incoming.map((t) => t.id));
        for (const old of prev) {
          if (old.id >= 0 && !incomingIds.has(old.id)) {
            changed = true;
            break;
          }
        }
      }

      const nextCombined = optimistic.length
        ? [
            ...nextBase,
            ...optimistic.filter((o) => !nextBase.some((t) => t.id === o.id)),
          ]
        : nextBase;

      if (!changed) {
        saveThreadsCache(image, nextCombined);
        return;
      }

      defer(() => {
        useThreadsStore.setState((s) => {
          const prevLatest = s.byImage[image] || [];
          let stillSame = prevLatest.length === nextCombined.length;
          if (stillSame) {
            for (let i = 0; i < prevLatest.length; i++) {
              if (!sameThread(prevLatest[i], nextCombined[i])) {
                stillSame = false;
                break;
              }
            }
          }
          if (stillSame) return {};

          const byImage = { ...s.byImage, [image]: nextCombined };
          const m = new Map(s.threadToImage);
          nextCombined.forEach((t) => m.set(t.id, image));

          saveThreadsCache(image, nextCombined);
          return { byImage, threadToImage: m };
        }, false);
      });
    },

    createOptimistic: (image, x, y) => {
      const tempId = -Date.now() - Math.floor(Math.random() * 1e6);
      set((s) => {
        const list = s.byImage[image] || [];
        const next: Thread[] = [
          ...list,
          { id: tempId, x: roundTo(x, 3), y: roundTo(y, 3), status: "pending" },
        ];

        const byImage = { ...s.byImage, [image]: next };
        const m = new Map(s.threadToImage);
        m.set(tempId, image);

        const p = new Map(s.pendingByKey);
        p.set(pointKey(image, x, y), tempId);

        saveThreadsCache(image, next);
        return { byImage, threadToImage: m, pendingByKey: p };
      });
      return tempId;
    },

    confirmCreate: (tempId, real) =>
      set((s) => {
        const image = s.threadToImage.get(tempId) || real.image_name;
        if (!image) return {};
        const list = s.byImage[image] || [];
        const idx = list.findIndex((t) => t.id === tempId);

        const newThread: Thread = {
          id: real.id,
          x: roundTo(real.x, 3),
          y: roundTo(real.y, 3),
          status: real.status as ThreadStatus,
          messageIds: list[idx]?.messageIds,
        };

        const nextList =
          idx >= 0
            ? [...list.slice(0, idx), newThread, ...list.slice(idx + 1)]
            : list.some((t) => t.id === real.id)
              ? list
              : [...list, newThread];

        const byImage = { ...s.byImage, [image]: nextList };
        const m = new Map(s.threadToImage);
        m.delete(tempId);
        m.set(real.id, image);

        const p = new Map(s.pendingByKey);
        for (const [k, v] of p.entries()) if (v === tempId) p.delete(k);

        useMessagesStore.getState().moveThreadMessages?.(tempId, real.id);

        if (s.activeThreadId === tempId) {
          get().setActiveThreadId(real.id);
        }

        saveThreadsCache(image, nextList);
        return { byImage, threadToImage: m, pendingByKey: p };
      }),

    rollbackCreate: (tempId) =>
      set((s) => {
        const image = s.threadToImage.get(tempId);
        if (!image) return {};
        const list = s.byImage[image] || [];
        const nextList = list.filter((t) => t.id !== tempId);
        const byImage = { ...s.byImage, [image]: nextList };

        const m = new Map(s.threadToImage);
        m.delete(tempId);

        const p = new Map(s.pendingByKey);
        for (const [k, v] of p.entries()) if (v === tempId) p.delete(k);

        if (s.activeThreadId === tempId) get().setActiveThreadId(null);

        nextList.length
          ? saveThreadsCache(image, nextList)
          : clearThreadsCache(image);
        return { byImage, threadToImage: m, pendingByKey: p };
      }),

    upsertFromRealtime: (r) =>
      set((s) => {
        const image = r.image_name;
        const list = s.byImage[image] || [];

        const pending = s.pendingStatus.get(r.id);
        if (pending) {
          const incoming = r.status as ThreadStatus;
          if (incoming === pending.from) return {};
        }

        let idx = list.findIndex((t) => t.id === r.id);
        if (idx < 0) {
          const key = pointKey(image, r.x, r.y);
          const tempId = s.pendingByKey.get(key);
          if (tempId != null) {
            const i2 = list.findIndex((t) => t.id === tempId);
            if (i2 >= 0) idx = i2;
          }
        }

        const updated: Thread = {
          id: r.id,
          x: roundTo(r.x, 3),
          y: roundTo(r.y, 3),
          status: r.status as ThreadStatus,
          messageIds: list[idx]?.messageIds,
        };

        const nextList =
          idx >= 0
            ? [...list.slice(0, idx), updated, ...list.slice(idx + 1)]
            : [...list, updated];
        const byImage = { ...s.byImage, [image]: nextList };

        const m = new Map(s.threadToImage);
        m.set(r.id, image);

        const p = new Map(s.pendingByKey);
        const k = pointKey(image, r.x, r.y);
        p.delete(k);
        for (const [kk, vv] of p.entries()) {
          if (vv < 0 && !list.some((t) => t.id === vv)) p.delete(kk);
        }

        const ps = new Map(s.pendingStatus);
        if (pending) ps.delete(r.id);

        saveThreadsCache(image, nextList);
        return {
          byImage,
          threadToImage: m,
          pendingByKey: p,
          pendingStatus: ps,
        };
      }),

    removeFromRealtime: (r) =>
      set((s) => {
        const image = s.threadToImage.get(r.id) || r.image_name;
        if (!image) return {};
        const nextList = (s.byImage[image] || []).filter((t) => t.id !== r.id);
        const byImage = { ...s.byImage, [image]: nextList };

        const m = new Map(s.threadToImage);
        m.delete(r.id);

        const ps = new Map(s.pendingStatus);
        ps.delete(r.id);

        if (s.activeThreadId === r.id) get().setActiveThreadId(null);

        nextList.length
          ? saveThreadsCache(image, nextList)
          : clearThreadsCache(image);
        return { byImage, threadToImage: m, pendingStatus: ps };
      }),

    setStatus: (threadId, status) =>
      set((s) => {
        const image = s.threadToImage.get(threadId);
        if (!image) return {};
        const nextList = (s.byImage[image] || []).map((t) =>
          t.id === threadId ? { ...t, status } : t,
        );
        saveThreadsCache(image, nextList);
        return { byImage: { ...s.byImage, [image]: nextList } };
      }),

    setMessageIds: (threadId, ids) =>
      set((s) => {
        const image = s.threadToImage.get(threadId);
        if (!image) return {};
        const nextList = (s.byImage[image] || []).map((t) =>
          t.id === threadId ? { ...t, messageIds: ids } : t,
        );
        saveThreadsCache(image, nextList);
        return { byImage: { ...s.byImage, [image]: nextList } };
      }),

    beginStatusOptimistic: (threadId, from, to) =>
      set((s) => {
        const ps = new Map(s.pendingStatus);
        ps.set(threadId, { from, to, at: Date.now() });
        return { pendingStatus: ps };
      }),

    clearPendingStatus: (threadId) =>
      set((s) => {
        const ps = new Map(s.pendingStatus);
        ps.delete(threadId);
        return { pendingStatus: ps };
      }),
  })),
);
