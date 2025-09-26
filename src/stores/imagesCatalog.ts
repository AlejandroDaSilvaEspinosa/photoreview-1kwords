// src/stores/imagesCatalog.ts
"use client";

import { create } from "zustand";
import { createVersionedCache } from "@/lib/cache/versioned";

type ThumbInfo = {
  thumbnailUrl: string;
  listingImageUrl?: string;
  bigImgUrl?: string;
};

type ImageItemLike = { name: string; thumbnailUrl: string; listingImageUrl?: string; bigImgUrl?: string };
type SkuLike = { sku: string; images: ImageItemLike[] };

type State = {
  bySku: Record<string, Record<string, ThumbInfo>>;
};
type Actions = {
  hydrateFromSkus: (skus: SkuLike[]) => void;
  thumbOf: (sku: string | null | undefined, imageName: string | null | undefined) => string | undefined;
  hydrateFromCacheIfEmpty: () => void;
  clearCache: () => void;
};

const cache = createVersionedCache<{ bySku: Record<string, Record<string, ThumbInfo>> }>("rev_img_catalog", 1);

export const useImagesCatalogStore = create<State & Actions>()((set, get) => ({
  bySku: {},

  hydrateFromSkus: (skus) => {
    if (!Array.isArray(skus)) return;
    const next: Record<string, Record<string, ThumbInfo>> = {};
    for (const s of skus) {
      if (!s?.sku || !Array.isArray(s.images)) continue;
      const m: Record<string, ThumbInfo> = {};
      for (const img of s.images) {
        if (!img?.name || !img?.thumbnailUrl) continue;
        m[img.name] = {
          thumbnailUrl: img.thumbnailUrl,
          listingImageUrl: img.listingImageUrl,
          bigImgUrl: img.bigImgUrl,
        };
      }
      next[s.sku] = m;
    }
    set({ bySku: next });
    cache.save({ bySku: next });
  },

  thumbOf: (sku, imageName) => {
    if (!sku || !imageName) return undefined;
    return get().bySku[sku]?.[imageName]?.thumbnailUrl;
  },

  hydrateFromCacheIfEmpty: () => {
    const now = get();
    if (Object.keys(now.bySku).length) return;
    const payload = cache.load();
    if (!payload) return;
    set({ bySku: payload.bySku });
  },

  clearCache: () => {
    cache.clear();
  },
}));

export const imagesCatalogCache = {
  load: () => cache.load()?.bySku ?? {},
  save: (bySku: Record<string, Record<string, ThumbInfo>>) => cache.save({ bySku }),
  clear: () => cache.clear(),
};
