// src/lib/common/rank.ts
/** Utilidad para combinar estados monótonos (no “bajan”). */
export function preferByRank<K extends string>(rank: Record<K, number>) {
  return (a?: K, b?: K): K => {
    const keys = Object.keys(rank) as K[];
    const base = keys[0];
    const aa = (a ?? base) as K;
    const bb = (b ?? base) as K;
    return rank[aa] >= rank[bb] ? aa : bb;
  };
}
