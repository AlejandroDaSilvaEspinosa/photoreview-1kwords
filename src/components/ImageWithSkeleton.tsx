"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image, { ImageProps } from "next/image";
import styles from "./ImageWithSkeleton.module.css";

type Props = Omit<ImageProps, "onLoadingComplete" | "onError"> & {
  wrapperClassName?: string;
  minSkeletonMs?: number;
  fallbackText?: string;
  forceSkeletonOnSrcChange?: boolean;
  onReady?: () => void; // callback cuando quedó visible
};

function srcToString(src: ImageProps["src"]): string {
  if (typeof src === "string") return src;
  // @ts-ignore: StaticImport
  return src?.src ?? "";
}

const ImageWithSkeleton = React.forwardRef<HTMLImageElement, Props>(
  (
    {
      wrapperClassName,
      className,
      minSkeletonMs = 180,
      fallbackText = "×",
      forceSkeletonOnSrcChange = true,
      onReady,
      ...imgProps
    },
    ref
  ) => {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);
    const [mountedAt, setMountedAt] = useState<number>(() => Date.now());
    const doneTimer = useRef<number | null>(null);

    const srcKey = useMemo(() => srcToString(imgProps.src), [imgProps.src]);

    useEffect(() => {
      if (!forceSkeletonOnSrcChange) return;
      setLoaded(false);
      setError(false);
      setMountedAt(Date.now());
      if (doneTimer.current) {
        window.clearTimeout(doneTimer.current);
        doneTimer.current = null;
      }
    }, [srcKey, forceSkeletonOnSrcChange]);

    useEffect(() => {
      return () => {
        if (doneTimer.current) window.clearTimeout(doneTimer.current);
      };
    }, []);

    const handleLoaded = () => {
      if (error) return;
      const elapsed = Date.now() - mountedAt;
      const remaining = Math.max(0, minSkeletonMs - elapsed);
      if (remaining === 0) {
        setLoaded(true);
        onReady?.();
      } else {
        doneTimer.current = window.setTimeout(() => {
          setLoaded(true);
          doneTimer.current = null;
          onReady?.();
        }, remaining) as unknown as number;
      }
    };

    const w = typeof imgProps.width === "number" ? imgProps.width : undefined;
    const h = typeof imgProps.height === "number" ? imgProps.height : undefined;

    return (
      <div
        className={`${styles.wrapper} ${wrapperClassName ?? ""}`}
        style={{ width: w ? `${w}px` : undefined, height: h ? `${h}px` : undefined }}
        aria-busy={!loaded && !error}
      >
        {!loaded && !error && <div className={styles.skeleton} />}

        {!error ? (
          <Image
            ref={ref as any}
            key={srcKey}
            {...imgProps}
            onLoadingComplete={handleLoaded}
            onError={() => {
              setError(true);
              setLoaded(false);
            }}
            className={`${styles.image} ${loaded ? styles.imageVisible : ""} ${className ?? ""}`}
          />
        ) : (
          <div className={styles.fallback} title="No se pudo cargar la imagen">
            {fallbackText}
          </div>
        )}
      </div>
    );
  }
);

ImageWithSkeleton.displayName = "ImageWithSkeleton";
export default ImageWithSkeleton;
