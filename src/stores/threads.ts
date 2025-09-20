// src/stores/threads.ts
"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ThreadStatus } from "@/types/review";
import type { ThreadRow } from "@/lib/supabase";

export type Thread = { id: number; x: number; y: number; status: ThreadStatus };

type ByImage = Record<string, Thread[]>; // key: imageName

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const keyOf = (image: string, x: number, y: number) =>
  `${image}|${round3(+x)}|${round3(+y)}`;

type State = {
  byImage: ByImage;
  threadToImage: Map<number, string>;
  pendingByKey: Map<string, number>; // key -> tempId
};

type Actions = {
  hydrateForImage: (imageName: string, rows: Thread[]) => void;

  // NUEVO: optimista
  createOptimistic: (imageName: string, x: number, y: number) => number;
  confirmCreate: (tempId: number, real: ThreadRow) => void;
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
          x: round3(+r.x),
          y: round3(+r.y),
          status: r.status as ThreadStatus,
        }));
        const next = { ...s.byImage, [image]: list };
        const m = new Map(s.threadToImage);
        list.forEach((t) => m.set(t.id, image));
        return { byImage: next, threadToImage: m };
      }),

    // ========= creación optimista =========
    createOptimistic: (image, x, y) =>
      set((s) => {
        const tempId = -Date.now() - Math.floor(Math.random() * 1e6);
        const list = s.byImage[image] || [];
        const next: Thread[] = [...list, { id: tempId, x: round3(x), y: round3(y), status: "pending" }];
        const byImage = { ...s.byImage, [image]: next };

        const m = new Map(s.threadToImage);
        m.set(tempId, image);

        const p = new Map(s.pendingByKey);
        p.set(keyOf(image, x, y), tempId);

        return { byImage, threadToImage: m, pendingByKey: p };
      }) as unknown as number, // TS no devuelve valor, lo exponemos con getState más abajo

    confirmCreate: (tempId, real) =>
      set((s) => {
        const image = s.threadToImage.get(tempId) || real.image_name;
        if (!image) return {};

        const list = s.byImage[image] || [];
        const idx = list.findIndex((t) => t.id === tempId);
        // si el temp ya no está (quizá lo sustituyó el realtime), solo garantizamos mapas
        const newThread: Thread = {
          id: real.id,
          x: round3(+real.x),
          y: round3(+real.y),
          status: real.status as ThreadStatus,
        };
        const nextList =
          idx >= 0 ? [...list.slice(0, idx), newThread, ...list.slice(idx + 1)] : list;

        const byImage = { ...s.byImage, [image]: nextList };

        const m = new Map(s.threadToImage);
        m.delete(tempId);
        m.set(real.id, image);

        const p = new Map(s.pendingByKey);
        p.delete(keyOf(image, real.x, real.y));

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

        // limpiamos cualquier pendingByKey que apunte a ese temp
        const p = new Map(s.pendingByKey);
        for (const [k, v] of p.entries()) if (v === tempId) p.delete(k);

        return { byImage, threadToImage: m, pendingByKey: p };
      }),

    // ========= realtime =========
    upsertFromRealtime: (r) =>
      set((s) => {
        const image = r.image_name;
        const list = s.byImage[image] || [];

        // 1) Buscar por id
        let idx = list.findIndex((t) => t.id === r.id);
        // 2) Si no existe, intentar casar con un optimista por coordenadas
        if (idx < 0) {
          const key = keyOf(image, r.x, r.y);
          const tempId = s.pendingByKey.get(key);
          if (tempId != null) {
            idx = list.findIndex((t) => t.id === tempId);
          }
        }

        const updated: Thread = {
          id: r.id,
          x: round3(+r.x),
          y: round3(+r.y),
          status: r.status as ThreadStatus,
        };

        let nextList: Thread[];
        if (idx >= 0) {
          // Sustituye (mantiene la posición → evita que cambie el “Hilo #”)
          nextList = [...list];
          nextList[idx] = { ...updated, /* conserva otros campos si tuvieras */ };
        } else {
          // No había temp coincidente → añadimos al final
          nextList = [...list, updated];
        }

        const byImage = { ...s.byImage, [image]: nextList };

        const m = new Map(s.threadToImage);
        m.set(r.id, image);

        const p = new Map(s.pendingByKey);
        p.delete(keyOf(image, r.x, r.y));

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
        return { byImage: { ...s.byImage, [image]: nextList } };
      }),

    setMessageIds: (threadId, ids) =>
      set((s: any) => {
        const image = s.threadToImage.get(threadId);
        if (!image) return {};
        const nextList = (s.byImage[image] || []).map((t: any) =>
          t.id === threadId ? { ...t, messages: ids } : t
        );
        return { byImage: { ...s.byImage, [image]: nextList } };
      }),
  }))
);

// Helper para devolver el tempId desde createOptimistic
// (porque zustand set no devuelve el valor)
export const createThreadOptimistic = (image: string, x: number, y: number) => {
  const { createOptimistic } = useThreadsStore.getState() as any;
  // ejecutamos y luego buscamos el último temp en esa imagen/coordenadas
  const before = performance.now();
  createOptimistic(image, x, y);
  const { byImage } = useThreadsStore.getState();
  const list = byImage[image] || [];
  // coge el último con id negativo y coords iguales
  const temp = [...list].reverse().find((t) => t.id < 0 && round3(t.x) === round3(x) && round3(t.y) === round3(y));
  return temp ? temp.id : -Math.floor(before); // fallback
};
