// src/lib/common/coords.ts
/** Redondeo consistente y key canónica para coordenadas de hilos. */
export const roundTo = (n: number, p = 3) => {
  const f = Math.pow(10, p);
  return Math.round(Number(n) * f) / f;
};

export const pointKey = (image: string, x: number, y: number, p = 3) =>
  `${image}|${roundTo(x, p)}|${roundTo(y, p)}`;
