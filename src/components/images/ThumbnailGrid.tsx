"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import styles from "./ThumbnailGrid.module.css";
import type { ThreadState, ValidationState, ImageItem } from "@/types/review";

type Props = {
  images: ImageItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  threads: ThreadState;
  validatedImages: ValidationState;
};

export default function ThumbnailGrid({
  images,
  selectedIndex,
  onSelect,
  threads,
  validatedImages,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => images.map((_, i) => `thumb-${i}`), [images]);
  const [focusIdx, setFocusIdx] = useState<number>(-1);

  // Auto-scroll suave al elemento seleccionado
  useEffect(() => {
    const el = document.getElementById(ids[selectedIndex]);
    el?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
  }, [selectedIndex, ids]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!images.length) return;
    const prevent = () => e.preventDefault();
    let next = selectedIndex;

    switch (e.key) {
      case "ArrowRight":
        prevent();
        next = Math.min(selectedIndex + 1, images.length - 1);
        break;
      case "ArrowLeft":
        prevent();
        next = Math.max(selectedIndex - 1, 0);
        break;
      case "Home":
        prevent();
        next = 0;
        break;
      case "End":
        prevent();
        next = images.length - 1;
        break;
      case "Enter":
      case " ":
        prevent();
        onSelect(selectedIndex);
        return;
      default:
        return;
    }
    onSelect(next);
    setFocusIdx(next);
  };

  return (
    <div
      ref={wrapRef}
      className={styles.thumbnailStrip}
      role="listbox"
      aria-label="Miniaturas"
      aria-activedescendant={ids[selectedIndex]}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {images.map((image, index) => {
        const name = image.name ?? "";
        const hasNotes =
          !!name && (threads[name]?.length || 0) > 0 && !validatedImages[name];
        const isValidated = !!validatedImages[name];
        const baseName = name.split(".")[0] || name;

        return (
          <button
            key={`${name}-${index}`}
            id={ids[index]}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            className={`${styles.card} ${index === selectedIndex ? styles.active : ""}`}
            onClick={() => onSelect(index)}
            onFocus={() => setFocusIdx(index)}
            title={name}
          >
            <ImageWithSkeleton
              src={image.thumbnailUrl || ""}
              alt={name || `Imagen ${index + 1}`}
              width={100}
              height={100}
              className={styles.thumb}
              sizes="100px"
              quality={100}
              minSkeletonMs={220}
              fallbackText={(baseName || "IMG").slice(0, 2).toUpperCase()}
            />

            {/* Nombre sobre un velo en la base */}
            <div className={styles.nameBar}>
              <span className={styles.nameText}>
                {baseName.length > 12 ? `${baseName.slice(0, 12)}…` : baseName}
              </span>
            </div>

            {/* Badges (coherentes con ThreadChat: verde validado, ámbar notas) */}
            {hasNotes && (
              <span
                className={`${styles.badge} ${styles.warn}`}
                aria-label="Tiene comentarios"
              >
                💬
              </span>
            )}
            {isValidated && (
              <span
                className={`${styles.badge} ${styles.ok}`}
                aria-label="Validada"
              >
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
