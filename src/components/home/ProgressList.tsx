// src/components/home/ProgressList.tsx
"use client";

import styles from "./ProgressList.module.css";

export type ImageStats = {
  pending: number;
  corrected: number;
  reopened: number;
  total: number;
};
type Props = { statsByImage: Record<string, ImageStats> };

export default function ProgressList({ statsByImage }: Props) {
  return (
    <div className={styles.list} aria-label="Progreso por imagen">
      {Object.entries(statsByImage).map(([img, st]) => {
        if (!st || st.total === 0) return null;
        const show = st.pending + st.reopened > 0;
        if (!show) return null;

        const tot = Math.max(1, st.pending + st.corrected + st.reopened);
        const wp = (st.pending / tot) * 100;
        const wc = (st.corrected / tot) * 100;
        const wr = (st.reopened / tot) * 100;

        return (
          <div key={img} className={styles.row} title={img}>
            <div className={styles.bar}>
              <span className={styles.pending} style={{ width: `${wp}%` }} />
              <span className={styles.corrected} style={{ width: `${wc}%` }} />
              <span className={styles.reopened} style={{ width: `${wr}%` }} />
            </div>
            <span className={styles.legend}>
              {img} · {st.pending} pend. · {st.reopened} reab. · {st.corrected}{" "}
              ok
            </span>
          </div>
        );
      })}
    </div>
  );
}
