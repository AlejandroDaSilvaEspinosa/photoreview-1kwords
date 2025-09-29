"use client";

import React from "react";
import styles from "./NextSkuCard.module.css";
import type { SkuWithImagesAndStatus } from "@/types/review";
import { STATUS_LABEL } from "@/lib/sku/nextSku";
import ImageWithSkeleton from "./ImageWithSkeleton";

type Props = {
  sku: SkuWithImagesAndStatus | null;
  onGo: (skuCode: string) => void;
  title?: string; // opcional (por si la reutilizas)
};

export default function NextSkuCard({
  sku,
  onGo,
  title = "Siguiente SKU",
}: Props) {
  if (!sku) return null;

  // Miniatura: primera imagen que tenga thumbnailUrl, si no, coge la primera.
  const thumb =
    sku.images.find((i) => i.thumbnailUrl)?.thumbnailUrl ||
    sku.images[0]?.thumbnailUrl ||
    "";
  const baseName =
    sku.images.find((i) => i.thumbnailUrl)?.name ||
    sku.images[0]?.name ||
    "IMG";

  // “Listas para validar” = imágenes en estado finished (sin hilos abiertos).
  const readyToValidate = sku.counts.finished;

  return (
    <aside className={styles.card} aria-label="Recomendación de siguiente SKU">
      <div className={styles.left}>
        <ImageWithSkeleton
          className={styles.thumb}
          src={thumb || ""}
          alt={baseName}
          width={64}
          height={64}
        />
      </div>

      <div className={styles.right}>
        <div className={styles.header}>
          <span className={styles.pill}>{title}</span>
        </div>

        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.label}>SKU</span>
            <span className={styles.valueCode}>{sku.sku}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Estado</span>
            <span className={styles.value}>{STATUS_LABEL[sku.status]}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Listas para validar</span>
            <span className={styles.valueStrong}>{readyToValidate}</span>
          </div>
        </div>

        <button
          className={styles.cta}
          onClick={() => onGo(sku.sku)}
          aria-label={`Ir al SKU ${sku.sku}`}
        >
          Ir al siguiente SKU →
        </button>
      </div>
    </aside>
  );
}
