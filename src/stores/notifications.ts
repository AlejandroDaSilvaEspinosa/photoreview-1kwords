"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export type NotificationType =
  | "new_message"
  | "new_thread"
  | "thread_status_changed"
  | "image_status_changed"
  | "sku_status_changed";

export type NotificationRow = {
  id: number;
  user_id: string;
  author_id: string | null;
  author_username?: string | null;
  type: "new_message" | "new_thread" | "thread_status_changed" | "image_status_changed" | "sku_status_changed";
  sku: string | null;
  image_name: string | null;
  thread_id: number | null;
  message_id?: number | null;
  message: string;
  excerpt?: string | null;
  viewed: boolean;
  created_at: string;
};


type State = {
  items: NotificationRow[];
  unseen: number;
  selfAuthId: string | null;
};

type Actions = {
  setSelfAuthId: (uid: string | null) => void;
  hydrate: (items: NotificationRow[], unseen?: number) => void;
  upsert: (row: NotificationRow) => void;
  appendOlder: (rows: NotificationRow[]) => void;
  markViewedLocal: (ids: number[]) => void;
  reset: () => void;
};

/* ---------- Helpers ---------- */
const sortDesc = (a: NotificationRow, b: NotificationRow) =>
  (b.created_at || "").localeCompare(a.created_at || "") || (b.id - a.id);

const sameNotif = (a: NotificationRow, b: NotificationRow) =>
  a.id === b.id &&
  a.viewed === b.viewed &&
  a.message === b.message &&
  a.excerpt === b.excerpt &&
  a.author_username === b.author_username &&
  a.type === b.type &&
  a.sku === b.sku &&
  a.image_name === b.image_name &&
  a.thread_id === b.thread_id &&
  a.message_id === b.message_id && // ⬅️ compara también el message_id
  a.created_at === b.created_at;

const defer = (fn: () => void) => {
  const ric = (globalThis as any)?.requestIdleCallback as undefined | ((cb: () => void) => any);
  if (typeof ric === "function") ric(fn);
  else setTimeout(fn, 0);
};

/* ---------- Cache SWR (localStorage) ---------- */
const NOTIFS_CACHE_VER = 3; // ⬆️ bump por nuevo campo message_id
const NOTIFS_CACHE_KEY = `rev_notifs:v${NOTIFS_CACHE_VER}`;

type NotifsCachePayload = { v: number; at: number; rows: NotificationRow[]; unseen: number };

const safeParse = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
};

const loadCache = (): { rows: NotificationRow[]; unseen: number } | null => {
  if (typeof window === "undefined") return null;
  const payload = safeParse<NotifsCachePayload>(localStorage.getItem(NOTIFS_CACHE_KEY));
  if (!payload) return null;
  return { rows: payload.rows ?? [], unseen: payload.unseen ?? 0 };
};

const saveCache = (rows: NotificationRow[], unseen: number) => {
  if (typeof window === "undefined") return;
  try {
    const payload: NotifsCachePayload = { v: NOTIFS_CACHE_VER, at: Date.now(), rows, unseen };
    localStorage.setItem(NOTIFS_CACHE_KEY, JSON.stringify(payload));
  } catch {}
};

/* ---------- Store ---------- */
const MAX_ITEMS = 1000;

export const useNotificationsStore = create<State & Actions>()(
  subscribeWithSelector((set, get) => ({
    items: [],
    unseen: 0,
    selfAuthId: null,

    setSelfAuthId: (uid) => set({ selfAuthId: uid }),

    hydrate: (rows, unseenArg) => {
      const sNow = get();
      const prev = sNow.items;
      const map = new Map<number, NotificationRow>();
      for (const r of rows) map.set(r.id, r);
      const next = Array.from(map.values()).sort(sortDesc);

      let changed = next.length !== prev.length;
      if (!changed) {
        for (let i = 0; i < next.length; i++) {
          if (!sameNotif(prev[i], next[i])) { changed = true; break; }
        }
      }
      if (!changed) {
        saveCache(prev, typeof unseenArg === "number" ? unseenArg : sNow.unseen);
        return;
      }

      defer(() => {
        useNotificationsStore.setState((s) => {
          const items = next.slice(0, MAX_ITEMS);
          const unseen =
            typeof unseenArg === "number"
              ? unseenArg
              : items.filter((x) => !x.viewed).length;
          saveCache(items, unseen);
          return { items, unseen };
        }, false);
      });
    },

    upsert: (row) =>
      set((s) => {
        const map = new Map<number, NotificationRow>();
        for (const it of s.items) map.set(it.id, it);
        const prev = map.get(row.id);
        const merged = { ...(prev || {}), ...row };
        if (prev && sameNotif(prev, merged)) return {};
        map.set(row.id, merged);
        const items = Array.from(map.values()).sort(sortDesc).slice(0, MAX_ITEMS);

        let unseen = s.unseen;
        if (!prev && !row.viewed) unseen += 1;
        if (prev && !prev.viewed && row.viewed) unseen = Math.max(0, unseen - 1);

        saveCache(items, unseen);
        return { items, unseen };
      }),

    appendOlder: (rows) =>
      set((s) => {
        if (!rows.length) return {};
        const map = new Map<number, NotificationRow>();
        for (const it of s.items) map.set(it.id, it);
        for (const r of rows) {
          const prev = map.get(r.id);
          if (!prev || !sameNotif(prev, r)) map.set(r.id, r);
        }
        const items = Array.from(map.values()).sort(sortDesc).slice(0, MAX_ITEMS);
        const unseen = items.filter((x) => !x.viewed).length;
        saveCache(items, unseen);
        return { items, unseen };
      }),

    markViewedLocal: (ids) =>
      set((s) => {
        if (!ids.length) return {};
        const idSet = new Set(ids);
        let unseen = s.unseen;
        const items = s.items.map((n) => {
          if (!idSet.has(n.id)) return n;
          if (!n.viewed) unseen = Math.max(0, unseen - 1);
          return { ...n, viewed: true };
        });
        saveCache(items, unseen);
        return { items, unseen };
      }),

    reset: () => {
      saveCache([], 0);
      return { items: [], unseen: 0 };
    },
  }))
);

export const notificationsCache = { load: loadCache, save: saveCache };
