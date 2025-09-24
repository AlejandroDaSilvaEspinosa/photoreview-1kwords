"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ThreadStatus, ThreadRow } from "@/types/review";
import { useMessagesStore } from "@/stores/messages";

export type Thread = {
  id: number;
  x: number;
  y: number;
  status: ThreadStatus;
  messageIds?: number[];
};

type ByImage = Record<string, Thread[]>;

const round3 = (n: number) => Math.round(+n * 1000) / 1000;
const keyOf = (image: string, x: number, y: number) => `${image}|${round3(x)}|${round3(y)}`;

// 🟩 estado optimista de status por hilo
type PendingStatus = { from: ThreadStatus; to: ThreadStatus; at: number };

type State = {
  byImage: ByImage;
  threadToImage: Map<number, string>;
  pendingByKey: Map<string, number>;
  activeThreadId: number | null;

  // 🟩 mapa de cambios de estado pendientes
  pendingStatus: Map<number, PendingStatus>;
};

// 🗄️ LocalStorage – Stale-While-Revalidate helpers
const THREADS_CACHE_VER = 2;
const threadsCacheKey = (image: string) => `rev_threads:v${THREADS_CACHE_VER}:${image}`;

type ThreadsCachePayload = {
  v: number;
  at: number;
  rows: Thread[];
};

const safeParse = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
};

const loadThreadsCache = (image: string): Thread[] | null => {
  if (typeof window === "undefined") return null;
  const payload = safeParse<ThreadsCachePayload>(localStorage.getItem(threadsCacheKey(image)));
  return payload?.rows ?? null;
};

const saveThreadsCache = (image: string, rows: Thread[]) => {
  if (typeof window === "undefined") return;
  try {
    const payload: ThreadsCachePayload = { v: THREADS_CACHE_VER, at: Date.now(), rows };
    localStorage.setItem(threadsCacheKey(image), JSON.stringify(payload));
  } catch { console.log("error")}
};

const clearThreadsCache = (image: string) => {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(threadsCacheKey(image)); } catch { console.log("error")}
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

// Defer: usa requestIdleCallback si existe, si no setTimeout(0)
const defer = (fn: () => void) => {
  const ric = (globalThis as any)?.requestIdleCallback as undefined | ((cb: () => void) => any);
  if (typeof ric === "function") ric(fn);
  else setTimeout(fn, 0);
};


// Si quieres usarlo desde otros componentes:
export const threadsCache = {
  load: loadThreadsCache,
  save: saveThreadsCache,
  clear: clearThreadsCache,
};


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

  // 🟩 helpers para marcar/limpiar optimismo
  beginStatusOptimistic: (threadId: number, from: ThreadStatus, to: ThreadStatus) => void;
  clearPendingStatus: (threadId: number) => void;
};

export const useThreadsStore = create<State & Actions>()(
  subscribeWithSelector((set, get) => ({
    byImage: {},
    threadToImage: new Map(),
    pendingByKey: new Map(),
    activeThreadId: null,
    pendingStatus: new Map(), // 🟩

    setActiveThreadId: (id) => set({ activeThreadId: id }),

    hydrateForImage: (image, rows) => {
      // Normaliza entrada → Thread[]
      const incoming: Thread[] = rows.map((r) => ({
        id: r.id,
        x: round3(r.x),
        y: round3(r.y),
        status: r.status as ThreadStatus,
        // messageIds no viene en rows, pero si existían en store se preservan abajo
      }));

      // Lee estado actual fuera de set() para calcular el diff sin bloquear
      const sNow = useThreadsStore.getState();
      const prev = sNow.byImage[image] || [];

      // Mantén optimistas (ids negativos) que aún estén en UI
      const optimistic = prev.filter((t) => t.id < 0);

      // Mapa previo por id para preservar identidad y messageIds
      const prevById = new Map(prev.map((t) => [t.id, t]));

      let changed = false;
      const nextBase: Thread[] = incoming.map((t) => {
        const old = prevById.get(t.id);
        if (!old) {
          changed = true;
          return t;
        }
        // Compara incluyendo messageIds; si no cambió, conserva la misma referencia
        const merged: Thread = {
          ...old, // preserva messageIds y cualquier otro campo previo
          x: t.x,
          y: t.y,
          status: t.status,
        };
        if (!sameThread(old, merged)) changed = true;
        return sameThread(old, merged) ? old : merged;
      });

      // Remociones: si había hilos prev (id >= 0) que ya no llegan
      if (!changed) {
        const incomingIds = new Set(incoming.map((t) => t.id));
        for (const old of prev) {
          if (old.id >= 0 && !incomingIds.has(old.id)) {
            changed = true;
            break;
          }
        }
      }

      // Combina base + optimistas no duplicadas
      const nextCombined =
        optimistic.length
          ? [
              ...nextBase,
              ...optimistic.filter((o) => !nextBase.some((t) => t.id === o.id)),
            ]
          : nextBase;

      // Si no hay cambios materiales, no dispares set() (evita re-render)
      if (!changed) {
        // Si quieres refrescar sólo el caché, puedes hacerlo aquí sin tocar el estado:
        saveThreadsCache(image, nextCombined);
        return;
      }

      // Actualiza estado y caché en “idle” para no bloquear la UI
      defer(() => {
        // Re-lee dentro por si cambió algo entre tanto
        useThreadsStore.setState((s) => {
          const prevLatest = s.byImage[image] || [];
          // Si ya quedó igual, no hagas nada
          if (prevLatest === prev || prevLatest.length === prev.length) {
            // Reconfirma igualdad profunda rápida
            let stillSame = prevLatest.length === nextCombined.length;
            if (stillSame) {
              for (let i = 0; i < prevLatest.length; i++) {
                if (!sameThread(prevLatest[i], nextCombined[i])) { stillSame = false; break; }
              }
            }
            if (stillSame) return {};
          }

          const byImage = { ...s.byImage, [image]: nextCombined };
          const m = new Map(s.threadToImage);
          nextCombined.forEach((t) => m.set(t.id, image));

          // Persistencia
          saveThreadsCache(image, nextCombined);

          return { byImage, threadToImage: m };
        }, false);
      });
    },

    createOptimistic: (image, x, y) => {
      const tempId = -Date.now() - Math.floor(Math.random() * 1e6);
      set((s) => {
        const list = s.byImage[image] || [];
        const next: Thread[] = [...list, { id: tempId, x: round3(x), y: round3(y), status: "pending" }];

        const byImage = { ...s.byImage, [image]: next };

        const m = new Map(s.threadToImage);
        m.set(tempId, image);

        const p = new Map(s.pendingByKey);
        p.set(keyOf(image, x, y), tempId);

        saveThreadsCache(image, next); // 🗄️ persist

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
          x: round3(real.x),
          y: round3(real.y),
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
          (get().setActiveThreadId)(real.id);
        }

        saveThreadsCache(image, nextList); // 🗄️ persist

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

        if (s.activeThreadId === tempId) (get().setActiveThreadId)(null);

        // Si queda vacío, limpia el caché
        nextList.length ? saveThreadsCache(image, nextList) : clearThreadsCache(image); // 🗄️ persist

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
          const key = keyOf(image, r.x, r.y);
          const tempId = s.pendingByKey.get(key);
          if (tempId != null) {
            const i2 = list.findIndex((t) => t.id === tempId);
            if (i2 >= 0) idx = i2;
          }
        }

        const updated: Thread = {
          id: r.id,
          x: round3(r.x),
          y: round3(r.y),
          status: r.status as ThreadStatus,
          messageIds: list[idx]?.messageIds,
        };

        const nextList = idx >= 0 ? [...list.slice(0, idx), updated, ...list.slice(idx + 1)] : [...list, updated];
        const byImage = { ...s.byImage, [image]: nextList };

        const m = new Map(s.threadToImage);
        m.set(r.id, image);

        const p = new Map(s.pendingByKey);
        const k = keyOf(image, r.x, r.y);
        p.delete(k);
        for (const [kk, vv] of p.entries()) {
          if (vv < 0 && !list.some((t) => t.id === vv)) p.delete(kk);
        }

        const ps = new Map(s.pendingStatus);
        if (pending) ps.delete(r.id);

        saveThreadsCache(image, nextList); // 🗄️ persist

        return { byImage, threadToImage: m, pendingByKey: p, pendingStatus: ps };
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

        if (s.activeThreadId === r.id) (get().setActiveThreadId)(null);

        nextList.length ? saveThreadsCache(image, nextList) : clearThreadsCache(image); // 🗄️ persist

        return { byImage, threadToImage: m, pendingStatus: ps };
      }),


    setStatus: (threadId, status) =>
      set((s) => {
        const image = s.threadToImage.get(threadId);
        if (!image) return {};
        const nextList = (s.byImage[image] || []).map((t) => (t.id === threadId ? { ...t, status } : t));

        saveThreadsCache(image, nextList); // 🗄️ persist

        return { byImage: { ...s.byImage, [image]: nextList } };
      }),

    setMessageIds: (threadId, ids) =>
      set((s) => {
        const image = s.threadToImage.get(threadId);
        if (!image) return {};
        const nextList = (s.byImage[image] || []).map((t) => (t.id === threadId ? { ...t, messageIds: ids } : t));

        // opcional: también persistir messageIds en el caché
        saveThreadsCache(image, nextList); // 🗄️ persist

        return { byImage: { ...s.byImage, [image]: nextList } };
      }),


    // 🟩 marcar inicio del optimismo de status
    beginStatusOptimistic: (threadId, from, to) =>
      set((s) => {
        const ps = new Map(s.pendingStatus);
        ps.set(threadId, { from, to, at: Date.now() });
        return { pendingStatus: ps };
      }),

    // 🟩 limpiar optimismo de status
    clearPendingStatus: (threadId) =>
      set((s) => {
        const ps = new Map(s.pendingStatus);
        ps.delete(threadId);
        return { pendingStatus: ps };
      }),
  }))
);
