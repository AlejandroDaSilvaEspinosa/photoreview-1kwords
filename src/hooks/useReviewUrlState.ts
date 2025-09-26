// src/hooks/useReviewUrlState.ts
"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, startTransition } from "react";

export function useReviewUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const params = useMemo(() => ({
    sku: searchParams.get("sku"),
    image: searchParams.get("image"),
    thread: (() => {
      const t = searchParams.get("thread");
      return t && /^-?\d+$/.test(t) ? Number(t) : null;
    })(),
  }), [searchParams]);

  const replaceParams = useCallback((next: URLSearchParams) => {
    const current = `${pathname}${searchParams.size ? `?${searchParams}` : ""}`;
    const target = `${pathname}${next.toString() ? `?${next.toString()}` : ""}`;
    if (current !== target) startTransition(() => router.replace(target, { scroll: false }));
  }, [pathname, router, searchParams]);

  const setSku = useCallback((sku: string | null, keepImageIfBelongs?: (name: string)=>boolean) => {
    const next = new URLSearchParams(searchParams.toString());
    if (sku) {
      next.set("sku", sku);
      const img = next.get("image");
      if (img && keepImageIfBelongs && !keepImageIfBelongs(img)) next.delete("image");
    } else {
      next.delete("sku"); next.delete("image");
    }
    next.delete("thread");
    replaceParams(next);
  }, [searchParams, replaceParams]);

  const setImage = useCallback((name: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (name) next.set("image", name); else next.delete("image");
    next.delete("thread");
    replaceParams(next);
  }, [searchParams, replaceParams]);

  const setThread = useCallback((id: number | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (id != null) next.set("thread", String(id)); else next.delete("thread");
    replaceParams(next);
  }, [searchParams, replaceParams]);

  return { params, setSku, setImage, setThread };
}
