"use client";

import styles from "./FilterPills.module.css";
import type { SkuStatus } from "@/types/review";

type Props = {
  all: SkuStatus[];
  labels: Record<SkuStatus, string>;
  totals: Record<SkuStatus, number>;
  active: Set<SkuStatus>;
  onToggle: (s: SkuStatus) => void;
};

export default function FilterPills({ all, labels, totals, active, onToggle }: Props) {
  return (
    <div
      className={styles.filters}
      role="group"
      aria-label="Filtrar por estado"
      suppressHydrationWarning
    >
      {all.map((s) => {
        const isActive = active.has(s);
        return (
          <button
            key={s}
            type="button"
            className={`${styles.pill} ${isActive ? styles.pillActive : ""}`}
            aria-pressed={isActive}
            onClick={() => onToggle(s)}
            title={labels[s]}
          >
            <span className={`${styles.dot} ${styles[`dot_${s}`]}`} />
            {labels[s]}
            <span className={styles.count}>{totals[s] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
