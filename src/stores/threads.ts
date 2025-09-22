// src/stores/threads.ts
"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ThreadStatus,ThreadRow } from "@/types/review";
import { useMessagesStore } from "@/stores/messages";

export type Thread = {
  id: number;
  x: number;
  y: number;
  status: ThreadStatus;
  messageIds?: number[];
};

type ByImage = Record<string, Thread[]>; // key: imageName

const round3 = (n: number) => Math.round(+n * 1000) / 1000;
const keyOf = (image: string, x: number, y: number) =>
  `${image}|${round3(x)}|${round3(y)}`;

type State = {
  byImage: ByImage;
  threadToImage: Map<number, string>;
  /** mapa para casar realtime con optimistas por coords */
  pendingByKey: Map<string, number>; // key -> tempId
};

type Actions = {
  hydrateForImage: (imageName: string, rows: Thread[]) => void;

  /** Crea hilo optimista y DEVUELVE el tempId (negativo) */
  createOptimistic: (imageName: string, x: number, y: number) => number;

  /** Cambia tempId -> realId y limpia pending */
  confirmCreate: (tempId: number, real: ThreadRow) => void;

  /** Elimina optimista (fallback si falla el insert) */
  rollbackCreate: (tempId: number) => void;

  // realtime
  upsertFromRealtime: (row: ThreadRow) => void;
  removeFromRealtime: (row: ThreadRow) => void;

  setStatus: (threadId: number, status: ThreadStatus) => void;
  setMessageIds: (threadId: number, ids: number[]) => void;
};

export const useThreadsStore = create<State & Actions>()(
  subscribeWithSelector((set, get) => ({
    byImage: {},
    threadToImage: new Map(),
    pendingByKey: new Map(),

    hydrateForImage: (image, rows) =>
      set((s) => {
        const list: Thread[] = rows.map((r) => ({
          id: r.id,
          x: round3(r.x),
          y: round3(r.y),
          status: r.status as ThreadStatus,
        }));
        const next = { ...s.byImage, [image]: list };
        const m = new Map(s.threadToImage);
        list.forEach((t) => m.set(t.id, image));
        return { byImage: next, threadToImage: m };
      }),

    // ========= creación optimista =========
    createOptimistic: (image, x, y) => {
      const tempId = -Date.now() - Math.floor(Math.random() * 1e6);
      set((s) => {
        const list = s.byImage[image] || [];
        const next: Thread[] = [
          ...list,
          { id: tempId, x: round3(x), y: round3(y), status: "pending" },
        ];

        const byImage = { ...s.byImage, [image]: next };

        const m = new Map(s.threadToImage);
        m.set(tempId, image);

        const p = new Map(s.pendingByKey);
        p.set(keyOf(image, x, y), tempId);

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
          messageIds: list[idx]?.messageIds, // conserva posibles ids cacheados
        };

        const nextList =
          idx >= 0
            ? [...list.slice(0, idx), newThread, ...list.slice(idx + 1)]
            : // si por lo que sea ya no está el temp (lo sustituyó el realtime),
              // garantizamos que exista el real
              (() => {
                const exists = list.some((t) => t.id === real.id);
                return exists ? list : [...list, newThread];
              })();

        const byImage = { ...s.byImage, [image]: nextList };

        const m = new Map(s.threadToImage);
        m.delete(tempId);
        m.set(real.id, image);

        // limpia pending por tempId (coords pueden variar tras normalización en backend)
        const p = new Map(s.pendingByKey);
        for (const [k, v] of p.entries()) if (v === tempId) p.delete(k);

        // 🟢 mueve los mensajes temp -> real (si hubo optimistas)
        useMessagesStore.getState().moveThreadMessages?.(tempId, real.id);

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

        // limpia cualquier pending que apunte a ese tempId
        const p = new Map(s.pendingByKey);
        for (const [k, v] of p.entries()) if (v === tempId) p.delete(k);

        return { byImage, threadToImage: m, pendingByKey: p };
      }),

    // ========= realtime =========
    upsertFromRealtime: (r) =>
      set((s) => {
        const image = r.image_name;
        const list = s.byImage[image] || [];

        // 1) Buscar por id real
        let idx = list.findIndex((t) => t.id === r.id);

        // 2) Si no existe, casar con optimista por coordenadas (redondeadas)
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

        let nextList: Thread[];
        if (idx >= 0) {
          // Sustituye (conserva índice → “Hilo #” no cambia)
          nextList = [...list];
          nextList[idx] = updated;
        } else {
          // Alta nueva
          nextList = [...list, updated];
        }

        const byImage = { ...s.byImage, [image]: nextList };

        const m = new Map(s.threadToImage);
        m.set(r.id, image);

        const p = new Map(s.pendingByKey);
        // elimina entradas de pending que apunten a estas coords o a un id temp ya sustituido
        const k = keyOf(image, r.x, r.y);
        p.delete(k);
        for (const [kk, vv] of p.entries()) {
          if (vv < 0 && !list.some((t) => t.id === vv)) p.delete(kk);
        }

        // mueve mensajes si por cualquier motivo aún quedan bajo tempId con esas coords
        const tempIdMaybe = get().pendingByKey.get(k);
        if (tempIdMaybe != null && tempIdMaybe < 0) {
          useMessagesStore.getState().moveThreadMessages?.(tempIdMaybe, r.id);
        }

        return { byImage, threadToImage: m, pendingByKey: p };
      }),

    removeFromRealtime: (r) =>
      set((s) => {
        const image = s.threadToImage.get(r.id) || r.image_name;
        if (!image) return {};
        const nextList = (s.byImage[image] || []).filter((t) => t.id !== r.id);
        const byImage = { ...s.byImage, [image]: nextList };

        const m = new Map(s.threadToImage);
        m.delete(r.id);

        return { byImage, threadToImage: m };
      }),

    setStatus: (threadId, status) =>
      set((s) => {
        const image = s.threadToImage.get(threadId);
        if (!image) return {};
        const nextList = (s.byImage[image] || []).map((t) =>
          t.id === threadId ? { ...t, status } : t
        );
        return { byImage: { ...s.byImage, [image]: nextList} };
      }),

    setMessageIds: (threadId, ids) =>
      set((s) => {
        const image = s.threadToImage.get(threadId);
        if (!image) return {};
        const nextList = (s.byImage[image] || []).map((t) =>
          t.id === threadId ? { ...t, messageIds: ids } : t
        );
        return { byImage: { ...s.byImage, [image]: nextList}};
      }),
  }))
);
