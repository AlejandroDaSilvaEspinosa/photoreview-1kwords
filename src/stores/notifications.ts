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
  type: NotificationType;
  sku: string | null;
  image_name: string | null;
  thread_id: number | null;
  message: string;
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

  prependMany: (rows: NotificationRow[]) => void;

  markViewedLocal: (ids: number[]) => void;

  reset: () => void;
};

const sortDesc = (a: NotificationRow, b: NotificationRow) =>
  (b.created_at || "").localeCompare(a.created_at || "") || (b.id - a.id);

export const useNotificationsStore = create<State & Actions>()(
  subscribeWithSelector((set, get) => ({
    items: [],
    unseen: 0,
    selfAuthId: null,

    setSelfAuthId: (uid) => set({ selfAuthId: uid }),

    hydrate: (rows, unseen) =>
      set(() => {
        const unique = new Map<number, NotificationRow>();
        for (const r of rows) unique.set(r.id, r);
        const items = Array.from(unique.values()).sort(sortDesc).slice(0, 100);
        return { items, unseen: typeof unseen === "number" ? unseen : items.filter((x) => !x.viewed).length };
      }),

    upsert: (row) =>
      set((s) => {
        const map = new Map<number, NotificationRow>();
        for (const it of s.items) map.set(it.id, it);
        const prev = map.get(row.id);
        map.set(row.id, { ...(prev || {}), ...row });
        const items = Array.from(map.values()).sort(sortDesc).slice(0, 100);

        let unseen = s.unseen;
        // Ajuste de unseen con transición false -> true
        if (!prev && !row.viewed) unseen += 1;
        if (prev && !prev.viewed && row.viewed) unseen = Math.max(0, unseen - 1);

        return { items, unseen };
      }),

    prependMany: (rows) =>
      set((s) => {
        const map = new Map<number, NotificationRow>();
        for (const it of s.items) map.set(it.id, it);
        for (const r of rows) map.set(r.id, r);
        const items = Array.from(map.values()).sort(sortDesc).slice(0, 100);
        const unseen = items.filter((x) => !x.viewed).length;
        return { items, unseen };
      }),

    markViewedLocal: (ids) =>
      set((s) => {
        const idSet = new Set(ids);
        let unseen = s.unseen;
        const items = s.items.map((n) => {
          if (!idSet.has(n.id)) return n;
          if (!n.viewed) unseen = Math.max(0, unseen - 1);
          return { ...n, viewed: true };
        });
        return { items, unseen };
      }),

    reset: () => ({ items: [], unseen: 0 }),
  }))
);
