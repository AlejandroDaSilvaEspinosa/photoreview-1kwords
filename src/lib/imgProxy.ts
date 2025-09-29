// src/lib/imgProxy.ts
export function proxifySrc(src: any) {
  if (typeof src !== "string") return src;
  if (/^https?:\/\//i.test(src)) return `/api/img?u=${encodeURIComponent(src)}`;
  return src; // locales tal cual
}
