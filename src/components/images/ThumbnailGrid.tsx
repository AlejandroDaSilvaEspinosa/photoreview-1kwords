"use client";

import React from "react";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import styles from "./ThumbnailGrid.module.css";
import type {
  ThreadState,
  ValidationState,
  ImageItem,
} from "@/types/review";

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
  validatedImages
}: Props) {
  return (
    <div className={styles.thumbnailSelector}>
      {images.map((image, index) => {
        const hasNotes =
          image.name &&
          (threads[image.name]?.length || 0) > 0 &&
          !validatedImages[image.name];

        return (
          <div
            key={`${image.name}-${index}`}
            className={`${styles.thumbnailWrapper} ${
              index === selectedIndex ? styles.activeThumbnail : ""
            }`}
            onClick={() => onSelect(index)}
          >
             <ImageWithSkeleton
                src={image.thumbnailUrl || ''}
                alt={image.name || ''}
                width={100}
                height={100}
                className={styles.thumbnail}
                sizes={`100%`}
                quality={100}
                minSkeletonMs={220}      // más notorio
                fallbackText={image.name?.slice(0,2).toUpperCase()}
              />
            <div className={styles.thumbnailName}>
              {image.name?.split(".")[0].substring(0, 12)}…
            </div>

            {hasNotes && <div className={styles.commentIndicator}>💬</div>}
            {validatedImages[image.name || '' ] && (
              <div className={styles.validatedIndicator}>✅</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
