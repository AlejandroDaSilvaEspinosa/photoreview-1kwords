// Devuelve un src proxificado para pasar por el proxy condicional
export function proxifySrc(src: any) {
  if (typeof src !== "string") return src;
  if (/^https?:\/\//i.test(src)) return `/api/img?u=${encodeURIComponent(src)}`;
  return src; // rutas locales tal cual
}
