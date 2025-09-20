// src/stores/statuses.ts
"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { SkuStatus, ImageStatus } from "@/types/review";

export type SkuStatusRow = {
  sku: string;
  status: SkuStatus;
  images_total: number | null;
  images_needing_fix: number | null;
  updated_at: string;
};

export type ImageStatusRow = {
  sku: string;
  image_name: string;
  status: ImageStatus;
  updated_at: string;
};

type State = {
  bySku: Record<string, SkuStatusRow>;
  byImage: Record<string, ImageStatusRow>; // key `${sku}|${image}`
};

type Actions = {
  hydrate: (skus: SkuStatusRow[], images: ImageStatusRow[]) => void;
  upsertSku: (row: SkuStatusRow) => void;
  upsertImage: (row: ImageStatusRow) => void;
  removeSku: (row: SkuStatusRow) => void;
  removeImage: (row: ImageStatusRow) => void;
};

export const useStatusesStore = create<State & Actions>()(
  subscribeWithSelector((set) => ({
    bySku: {},
    byImage: {},

    hydrate: (skus, images) =>
      set({
        bySku: Object.fromEntries(skus.map((r) => [r.sku, r])),
        byImage: Object.fromEntries(images.map((r) => [`${r.sku}|${r.image_name}`, r])),
      }),

    upsertSku: (r) =>
      set((s) => ({ bySku: { ...s.bySku, [r.sku]: r } })),

    upsertImage: (r) =>
      set((s) => ({ byImage: { ...s.byImage, [`${r.sku}|${r.image_name}`]: r } })),

    removeSku: (r) =>
      set((s) => {
        const n = { ...s.bySku };
        delete n[r.sku];
        return { bySku: n };
      }),

    removeImage: (r) =>
      set((s) => {
        const k = `${r.sku}|${r.image_name}`;
        const n = { ...s.byImage };
        delete n[k];
        return { byImage: n };
      }),
  }))
);
