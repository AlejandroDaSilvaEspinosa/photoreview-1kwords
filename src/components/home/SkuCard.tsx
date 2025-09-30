// src/components/home/SkuCard.tsx
"use client";

import styles from "./SkuCard.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import type { SkuWithImagesAndStatus } from "@/types/review";
import ProgressList, { ImageStats } from "./ProgressList";
import ChatIcon from "@/icons/chat.svg";

type Props = {
  sku: SkuWithImagesAndStatus;
  unread: boolean;
  perImageStats: Record<string, ImageStats>;
  onOpen: () => void;
};

export default function SkuCard({ sku, unread, perImageStats, onOpen }: Props) {
  const needFix = sku.counts.needs_correction ?? 0;
  const hasStatusRow =
    Number.isFinite(sku.counts.total) && sku.counts.total >= 0;

  return (
    <button
      type="button"
      className={styles.card}
      onClick={onOpen}
      role="listitem"
      title={`Abrir SKU ${sku.sku}`}
    >
      <div className={styles.thumbWrap}>
        {unread && (
          <span className={styles.unread} title="Mensajes sin leer">
            <ChatIcon />
          </span>
        )}

        <ImageWithSkeleton
          src={sku.images[0]?.listingImageUrl}
          alt={sku.sku}
          width={600}
          height={600}
          className={styles.thumbnail}
          sizes="(max-width: 900px) 50vw, 260px"
          quality={100}
          minSkeletonMs={180}
          fallbackText={sku.sku.slice(0, 2).toUpperCase()}
        />

        <span className={styles.badge}>
          {hasStatusRow
            ? needFix > 0
              ? `${needFix} img necesitan corrección`
              : `0 img por corregir`
            : "(pendiente de validación)"}
        </span>
      </div>

      <span className={styles.openHint}>sku: {sku.sku}</span>

      {needFix > 0 && <ProgressList statsByImage={perImageStats} />}
    </button>
  );
}
