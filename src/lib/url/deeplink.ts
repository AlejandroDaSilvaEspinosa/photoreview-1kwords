// src/lib/url/deeplink.ts
export type ReviewParams = {
  sku?: string | null;
  image?: string | null;
  thread?: number | null;
};

export function buildReviewUrl(baseHref: string, p: ReviewParams) {
  const url = new URL(baseHref, window.location.origin);
  const sp = url.searchParams;
  if (p.sku) sp.set("sku", p.sku);
  else sp.delete("sku");
  if (p.image) sp.set("image", p.image);
  else sp.delete("image");
  if (p.thread != null) sp.set("thread", String(p.thread));
  else sp.delete("thread");
  url.search = sp.toString();
  return url.pathname + (url.search ? `?${sp.toString()}` : "");
}
