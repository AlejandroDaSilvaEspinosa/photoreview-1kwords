"use client";

import React from "react";
import styles from "./NextSkuCard.module.css";
import type { SkuWithImagesAndStatus } from "@/types/review";
import { STATUS_LABEL } from "@/lib/sku/nextSku";
import ImageWithSkeleton from "./ImageWithSkeleton";
import ImageIcon from "@/icons/image.svg";

type Props = {
  sku: SkuWithImagesAndStatus | null;
  onGo: (skuCode: string) => void;
  title?: string;
};

export default function NextSkuCard({ sku, onGo }: Props) {
  if (!sku) return null;

  const thumb =
    sku.images.find((i) => i.thumbnailUrl)?.thumbnailUrl ||
    sku.images[0]?.thumbnailUrl ||
    "";

  // const porValidar = sku.counts?.finished ?? 0;
  const conCorrecciones = sku.counts?.needs_correction ?? 0;
  const totalImagenes = sku.counts?.total;
  const readyVariant =
    sku.status === "pending_validation" && conCorrecciones === 0;

  return (
    <aside className={styles.card} aria-label="Recomendación de siguiente SKU">
      <div className={styles.left}>
        <ImageWithSkeleton
          className={styles.thumb}
          src={thumb}
          alt={sku.sku}
          width={90}
          height={90}
        />
        <div className={styles.pendingImagesBubble}>
          <ImageIcon className={styles.imageIcon} />
          <span>{totalImagenes}</span>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.value}>
              Siguiente SKU listo para revisar
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Estado</span>
            <span className={styles.value}>{STATUS_LABEL[sku.status]}</span>
          </div>
          {/* <div className={styles.row}>
            <span className={styles.label}>Por validar</span>
            <span className={styles.valueStrong}>{porValidar}</span>
          </div> */}
          {/* <div className={styles.row}>
            <span className={styles.label}>Con correcciones</span>
            <span className={styles.valueStrong}>{conCorrecciones}</span>
          </div> */}
        </div>

        <button
          className={`${styles.cta} ${readyVariant ? styles.green : ""}`}
          onClick={() => onGo(sku.sku)}
          aria-label={`Ir al SKU ${sku.sku}`}
        >
          {`Revisar SKU ${sku.sku} →`}
        </button>
      </div>
    </aside>
  );
}
