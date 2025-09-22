"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { MessageRow } from "@/types/review";

// Unificamos el tipo local de delivery
type LocalDelivery = "sending" | "sent" | "delivered" | "read";

export type Msg = MessageRow & {
  meta?: {
    localDelivery?: LocalDelivery;
    // Flag para evitar flicker: lo ponemos a true en optimistas y lo preservamos
    isMine?: boolean;
  };
};

type State = {
  byThread: Record<number, Msg[]>;
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
        const curr = s.byThread[threadId] || [];

        // si ya entró por realtime, elimina el optimista y asegura meta preservada
        if (curr.some((m) => m.id === real.id)) {
          const optim = curr.find((m) => m.id === tempId);
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
          return { byThread: { ...s.byThread, [threadId]: filtered }, messageToThread: map };
        }

        // reemplazo normal del optimista por real
        const idx = curr.findIndex((m) => m.id === tempId);
        if (idx < 0) {
          const list = [
            ...curr,
            { ...real, thread_id: threadId, meta: { localDelivery: "sent", isMine: true } } as Msg,
          ].sort(sortByCreatedAt);
          const map = new Map(s.messageToThread);
          map.set(real.id, threadId);
          map.delete(tempId);
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
        return { byThread: { ...s.byThread, [threadId]: copy }, messageToThread: map };
      }),

    // Marca lectura local y la persiste (sin depender de username)
    markThreadRead: async (threadId) => {
      // 1) snapshot antes del set
      const { byThread } = get();
      const list = byThread[threadId] || [];

      const toMark = list
        .filter((m) => {
          // ignora system
          if ((m as any).is_system) return false;
          // ignora si no tiene id aún
          if (m.id == null) return false;
          const ld = (m.meta?.localDelivery ?? "sent") as LocalDelivery;
          // no marcamos los que aún están enviándose
          if (ld === "sending") return false;
          // si ya está en read, no hace falta marcar
          if (ld === "read") return false;
          return true;
        })
        .map((m) => m.id as number);

      if (toMark.length === 0) return;

      // 2) optimista SOLO para esos ids
      set((s) => {
        const curr = s.byThread[threadId] || [];
        const idSet = new Set(toMark);
        const nextList = curr.map((m) => {
          if (!idSet.has(m.id as number)) return m;
          return { ...m, meta: { ...(m.meta || {}), localDelivery: "read" as LocalDelivery } };
        });
        return { byThread: { ...s.byThread, [threadId]: nextList } };
      });

      // 3) persistir en backend
      try {
        const resp = await fetch("/api/messages/receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: toMark, mark: "read" }),
        });
        if (!resp.ok) {
          // si falla, opcionalmente podríamos revertir a 'delivered' o 'sent'
          // pero lo normal es que llegue el realtime de receipts y re-sincronice
          console.error("markThreadRead failed", await resp.text());
        }
      } catch (e) {
        console.error("markThreadRead network error", e);
      }
    },


    upsertFromRealtime: (row) =>
      set((s) => {
        const threadId = row.thread_id;
        const curr = s.byThread[threadId] || [];
        const normTxt = (x?: string | null) => (x ?? "").replace(/\s+/g, " ").trim();
        const isSystem = !!row.is_system;

        // preserva meta del optimista coincidente (mismo texto y tipo de mensaje)
        let preservedMeta: any = null;
        const cleaned = curr.filter((m: any) => {
          if (m.id >= 0) return true;
          if (!!m.is_system !== isSystem) return true;
          if (normTxt(m.text) !== normTxt(row.text)) return true;
          preservedMeta = { ...(m.meta || {}) };
          return false; // eliminar duplicado optimista
        });

        // upsert por id
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
          return { byThread: { ...s.byThread, [threadId]: copy }, messageToThread: map };
        }

        // insert nuevo
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
        return { byThread: { ...s.byThread, [threadId]: added }, messageToThread: map };
      }),

    removeFromRealtime: (row) =>
      set((s) => {
        const threadId = row.thread_id;
        const curr = s.byThread[threadId] || [];
        const filtered = curr.filter((m) => m.id !== row.id);
        const map = new Map(s.messageToThread);
        map.delete(row.id);
        return { byThread: { ...s.byThread, [threadId]: filtered }, messageToThread: map };
      }),

    upsertReceipt: (messageId, _userId, readAt) =>
      set((s) => {
        let threadId = s.messageToThread.get(messageId);
        console.log(threadId)

        // fallback: busca el mensaje si aún no tenemos el índice
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
