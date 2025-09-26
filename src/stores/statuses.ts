// src/stores/statuses.ts
"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { SkuStatus, ImageStatus } from "@/types/review";
import { createVersionedCache } from "@/lib/cache/versioned";

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
  byImage: Record<string, ImageStatusRow>; // key `${r.sku}|${r.image_name}`
};

type Actions = {
  hydrate: (skus: SkuStatusRow[], images: ImageStatusRow[]) => void;
  upsertSku: (row: SkuStatusRow) => void;
  upsertImage: (row: ImageStatusRow) => void;
  removeSku: (row: SkuStatusRow) => void;
  removeImage: (row: ImageStatusRow) => void;
  hydrateFromCacheIfEmpty: () => void;
};

const cache = createVersionedCache<{ bySku: Record<string, SkuStatusRow>; byImage: Record<string, ImageStatusRow> }>(
  "rev_statuses",
  1
);

export const useStatusesStore = create<State & Actions>()(
  subscribeWithSelector((set, get) => ({
    bySku: {},
    byImage: {},

    hydrate: (skus, images) =>
      set((s) => {
        const bySku = { ...s.bySku };
        for (const r of skus) bySku[r.sku] = r;

        const byImage = { ...s.byImage };
        for (const r of images) byImage[`${r.sku}|${r.image_name}`] = r;

        cache.save({ bySku, byImage });
        return { bySku, byImage };
      }),

    upsertSku: (r) =>
      set((s) => {
        if (s.bySku[r.sku] === r) return {};
        const bySku = { ...s.bySku, [r.sku]: r };
        cache.save({ bySku, byImage: s.byImage });
        return { bySku };
      }),

    upsertImage: (r) =>
      set((s) => {
        const k = `${r.sku}|${r.image_name}`;
        if (s.byImage[k] === r) return {};
        const byImage = { ...s.byImage, [k]: r };
        cache.save({ bySku: s.bySku, byImage });
        return { byImage };
      }),

    removeSku: (r) =>
      set((s) => {
        if (!s.bySku[r.sku]) return {};
        const bySku = { ...s.bySku };
        delete bySku[r.sku];

        const byImage = { ...s.byImage };
        for (const key of Object.keys(byImage)) {
          if (key.startsWith(`${r.sku}|`)) delete byImage[key];
        }

        if (!Object.keys(bySku).length && !Object.keys(byImage).length) {
          cache.clear();
        } else {
          cache.save({ bySku, byImage });
        }
        return { bySku, byImage };
      }),

    removeImage: (r) =>
      set((s) => {
        const k = `${r.sku}|${r.image_name}`;
        if (!s.byImage[k]) return {};
        const byImage = { ...s.byImage };
        delete byImage[k];

        if (!Object.keys(s.bySku).length && !Object.keys(byImage).length) {
          cache.clear();
        } else {
          cache.save({ bySku: s.bySku, byImage });
        }
        return { byImage };
      }),

    hydrateFromCacheIfEmpty: () => {
      const sNow = get();
      if (Object.keys(sNow.bySku).length || Object.keys(sNow.byImage).length) return;
      const payload = cache.load();
      if (!payload) return;
      set({ bySku: payload.bySku, byImage: payload.byImage });
    },
  }))
);
