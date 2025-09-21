// src/stores/messages.ts
"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { MessageRow } from "@/lib/supabase";

/** Estados locales de entrega/lectura */
type LocalDelivery = "sending" | "sent" | "delivered" | "read";

/** Mensaje enriquecido (añadimos meta local) */
export type Msg = MessageRow & {
  meta?: {
    localDelivery?: LocalDelivery;
  };
};

type State = {
  /** thread_id -> lista de mensajes (ordenados) */
  byThread: Record<number, Msg[]>;
  /** message_id -> thread_id (para recibos) */
  messageToThread: Map<number, number>;
};

type Actions = {
  setForThread: (threadId: number, rows: Msg[]) => void;

  addOptimistic: (
    threadId: number,
    tempId: number,
    partial: Omit<Msg, "id" | "thread_id"> & Partial<Pick<Msg, "id">>
  ) => void;

  confirmMessage: (threadId: number, tempId: number, real: Msg) => void;

  markThreadRead: (threadId: number, currentUser: string) => Promise<void>;

  upsertFromRealtime: (row: MessageRow) => void;
  removeFromRealtime: (row: MessageRow) => void;
  upsertReceipt: (messageId: number, userId: string, readAt?: string | null) => void;

  /** mover los mensajes de un hilo a otro (p.ej. tempId -> realId) */
  moveThreadMessages: (fromThreadId: number, toThreadId: number) => void;
};

const sortByCreatedAt = (a: Msg, b: Msg) =>
  (a.created_at || "").localeCompare(b.created_at || "");

export const useMessagesStore = create<State & Actions>()(
  subscribeWithSelector((set, get) => ({
    byThread: {},
    messageToThread: new Map(),

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
        return { byThread: next, messageToThread: map };
      }),

    addOptimistic: (threadId, tempId, partial) =>
      set((s) => {
        const list = (s.byThread[threadId] || []).slice();
        list.push({
          ...(partial as any),
          id: tempId,
          thread_id: threadId,
          meta: { ...(partial.meta || {}), localDelivery: "sending" as const },
        });
        list.sort(sortByCreatedAt);
        const next = { ...s.byThread, [threadId]: list };

        const map = new Map(s.messageToThread);
        map.set(tempId, threadId);

        return { byThread: next, messageToThread: map };
      }),

    confirmMessage: (threadId, tempId, real) =>
      set((s) => {
        const curr = s.byThread[threadId] || [];
        // si ya entró por realtime, elimina el optimista duplicado
        if (curr.some((m) => m.id === real.id)) {
          const filtered = curr.filter((m) => m.id !== tempId).sort(sortByCreatedAt);
          const next = { ...s.byThread, [threadId]: filtered };
          const map = new Map(s.messageToThread);
          map.delete(tempId);
          map.set(real.id, threadId);
          return { byThread: next, messageToThread: map };
        }
        const idx = curr.findIndex((m) => m.id === tempId);
        if (idx < 0) {
          const list = [
            ...curr,
            { ...real, thread_id: threadId, meta: { localDelivery: "sent" as const } },
          ].sort(sortByCreatedAt);
          const next = { ...s.byThread, [threadId]: list };
          const map = new Map(s.messageToThread);
          map.set(real.id, threadId);
          map.delete(tempId);
          return { byThread: next, messageToThread: map };
        }
        const copy = curr.slice();
        copy[idx] = { ...copy[idx], ...real, id: real.id, meta: { localDelivery: "sent" as const } };
        copy.sort(sortByCreatedAt);

        const next = { ...s.byThread, [threadId]: copy };
        const map = new Map(s.messageToThread);
        map.delete(tempId);
        map.set(real.id, threadId);
        return { byThread: next, messageToThread: map };
      }),

    markThreadRead: async (threadId, currentUser) => {
      set((s) => {
        const list = (s.byThread[threadId] || []).map((m) => {
          const mine =
            (m.created_by_display_name || m.created_by_username || "").toLowerCase() ===
            (currentUser || "").toLowerCase();
          return mine ? m : { ...m, meta: { ...(m.meta || {}), localDelivery: "read" as const } };
        });
        return { byThread: { ...s.byThread, [threadId]: list } };
      });
    },

    upsertFromRealtime: (row) =>
      set((s) => {
        const threadId = row.thread_id;
        const curr = s.byThread[threadId] || [];

        const normTxt = (x?: string | null) => (x ?? "").replace(/\s+/g, " ").trim();
        const aId = (m: any) =>
          (m.created_by ??
            m.created_by_username ??
            m.created_by_display_name ??
            "")
            .toString()
            .toLowerCase();
        const isSystem = !!row.is_system;

        // 1) Limpia optimistas duplicados
        const cleaned = curr.filter((m: any) => {
          if (m.id >= 0) return true;
          if (!!m.is_system !== isSystem) return true;
          if (normTxt(m.text) !== normTxt(row.text)) return true;
          if (isSystem) return false;
          const a = aId(m);
          const b = aId(row as any);
          if (a && b && a === b) return false;
          return true;
        });

        // 2) Upsert por id
        const idx = cleaned.findIndex((m: any) => m.id === row.id);
        if (idx >= 0) {
          const copy = cleaned.slice();
          copy[idx] = {
            ...copy[idx],
            ...(row as any),
            meta: { ...(copy[idx].meta || {}), localDelivery: "sent" as const },
          };
          copy.sort(sortByCreatedAt);
          const next = { ...s.byThread, [threadId]: copy };

          const map = new Map(s.messageToThread);
          map.set(row.id, threadId);

          return { byThread: next, messageToThread: map };
        }

        // 3) Insert nuevo
        const added = [
          ...cleaned,
          { ...(row as any), meta: { ...(row as any).meta, localDelivery: "sent" as const } },
        ].sort(sortByCreatedAt);

        const next = { ...s.byThread, [threadId]: added };
        const map = new Map(s.messageToThread);
        map.set(row.id, threadId);

        return { byThread: next, messageToThread: map };
      }),

    removeFromRealtime: (row) =>
      set((s) => {
        const threadId = row.thread_id;
        const curr = s.byThread[threadId] || [];
        const filtered = curr.filter((m) => m.id !== row.id);
        const next = { ...s.byThread, [threadId]: filtered };
        const map = new Map(s.messageToThread);
        map.delete(row.id);
        return { byThread: next, messageToThread: map };
      }),

    upsertReceipt: (messageId, _userId, readAt) =>
      set((s) => {
        const threadId = s.messageToThread.get(messageId);
        if (!threadId) return {};
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
        return { byThread: { ...s.byThread, [threadId]: copy } };
      }),

    moveThreadMessages: (fromThreadId, toThreadId) =>
      set((s) => {
        if (fromThreadId === toThreadId) return {};
        const from = s.byThread[fromThreadId] || [];
        if (from.length === 0) {
          if (s.byThread[fromThreadId]) {
            const byThread = { ...s.byThread };
            delete byThread[fromThreadId];
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

        return { byThread, messageToThread };
      }),
  }))
);
