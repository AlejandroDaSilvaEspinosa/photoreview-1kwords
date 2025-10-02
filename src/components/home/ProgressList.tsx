// src/components/home/ProgressList.tsx
"use client";

import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import "overlayscrollbars/overlayscrollbars.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import styles from "./ProgressList.module.css";

export type ImageStats = {
  pending: number;
  corrected: number;
  reopened: number;
  total: number;
  thumbnailUrl?: string;
};

type Props = { statsByImage: Record<string, ImageStats> };

export default function ProgressList({ statsByImage }: Props) {
  const entries = Object.entries(statsByImage).filter(([_, st]) => {
    if (!st || !Number.isFinite(st.total)) return false;
    const open = (st.pending ?? 0) + (st.reopened ?? 0);
    return open > 0;
  });

  if (!entries.length) return null;

  return (
    <OverlayScrollbarsComponent
      defer
      className={styles.scrollArea}
      options={{
        overflow: {
          x: "scroll",
          y: "visible",
        },
      }}
    >
      <div className={styles.list}>
        {entries.map(([imgName, st]) => {
          const open = (st.pending ?? 0) + (st.reopened ?? 0);
          const done = st.corrected ?? 0;
          const tot = Math.max(1, open + done);
          const pctDone = (done / tot) * 100;

          return (
            <div key={imgName} className={styles.row} title={imgName}>
              {st.thumbnailUrl ? (
                <ImageWithSkeleton
                  src={st.thumbnailUrl}
                  alt={imgName}
                  width={56}
                  height={56}
                  className={styles.thumb}
                  sizes="56px"
                  quality={70}
                  minSkeletonMs={120}
                  fallbackText={imgName.slice(0, 2).toUpperCase()}
                />
              ) : (
                <div className={styles.thumbFallback}>
                  {imgName.slice(0, 2).toUpperCase()}
                </div>
              )}

              <div className={styles.progressBarWrap}>
                <div
                  className={styles.progressBarFill}
                  style={{ width: `${pctDone}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </OverlayScrollbarsComponent>
  );
}
