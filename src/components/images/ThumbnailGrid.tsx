"use client";

import React from "react";
import AuthenticatedImage from "./AuthenticatedImage";
import styles from "./ThumbnailGrid.module.css";
import type {
  AnnotationState,
  ValidationState,
  ImageItem,
} from "@/types/review";

type Props = {
  images: ImageItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  annotations: AnnotationState;
  validatedImages: ValidationState;
  token: string | null;
  thumbSize?: number;
};

export default function ThumbnailGrid({
  images,
  selectedIndex,
  onSelect,
  annotations,
  validatedImages,
  token,
  thumbSize = 112,
}: Props) {
  return (
    <div className={styles.thumbnailSelector}>
      {images.map((image, index) => {
        const hasNotes =
          (annotations[image.filename]?.length || 0) > 0 &&
          !validatedImages[image.filename];

        return (
          <div
            key={`${image.filename}-${index}`}
            className={`${styles.thumbnailWrapper} ${
              index === selectedIndex ? styles.activeThumbnail : ""
            }`}
            onClick={() => onSelect(index)}
          >
            <AuthenticatedImage
              src={image.url}
              alt={image.filename}
              token={token}
              lazy
              placeholderWidth={thumbSize}
              placeholderHeight={thumbSize}
              className={styles.thumbnail}
            />
            <div className={styles.thumbnailName}>
              {image.filename.split(".")[0].substring(0, 12)}…
            </div>

            {hasNotes && <div className={styles.commentIndicator}>💬</div>}
            {validatedImages[image.filename] && (
              <div className={styles.validatedIndicator}>✅</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
