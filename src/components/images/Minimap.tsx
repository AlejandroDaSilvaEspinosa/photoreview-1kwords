// ==============================
// File: src/components/images/Minimap.tsx
// ==============================
import React from "react";
import styles from "./Minimap.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";

type MinimapProps = {
  src: string;
  aspect?: string;
  vpStyle: React.CSSProperties;
  miniRef?: React.RefObject<HTMLDivElement>;
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTouchStart?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchMove?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onImageReady?: () => void; // normalmente measureMini()
};

export default function Minimap({
  src,
  aspect,
  vpStyle,
  miniRef,
  onMouseDown,
  onMouseMove,
  onTouchStart,
  onTouchMove,
  onImageReady,
}: MinimapProps) {
  return (
    <div
      className={styles.minimap}
      ref={miniRef}
      style={{ touchAction: "none", aspectRatio: aspect }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
    >
      <div className={styles.miniImgWrap}>
        <ImageWithSkeleton
          src={src}
          alt=""
          fill
          sizes="320px"
          priority
          draggable={false}
          className={styles.miniImg}
          onLoadingComplete={() => onImageReady && onImageReady()}
        />
      </div>
      <div className={styles.viewport} style={vpStyle} />
      <div className={styles.veil} />
    </div>
  );
}
