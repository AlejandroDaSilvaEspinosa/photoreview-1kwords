// src/stores/imagesCatalog.ts
"use client";

import { create } from "zustand";

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
};

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
  },

  thumbOf: (sku, imageName) => {
    if (!sku || !imageName) return undefined;
    return get().bySku[sku]?.[imageName]?.thumbnailUrl;
  },
}));
