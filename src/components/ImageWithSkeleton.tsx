"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image, { ImageProps } from "next/image";
import styles from "./ImageWithSkeleton.module.css";

type Props = Omit<ImageProps, "onError"> & {
  wrapperClassName?: string;
  minSkeletonMs?: number;
  fallbackText?: string;
  forceSkeletonOnSrcChange?: boolean;
  onReady?: (img:any) => void; 
};

function srcToString(src: any): string {
  if (typeof src === "string") return src;
  return src?.src  ?? "";
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
    const [ratio, setRatio] = useState<number | null>(null);

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

    const handleLoaded = (img:HTMLImageElement) => {
      if (error) return;
      const elapsed = Date.now() - mountedAt;
      const remaining = Math.max(0, minSkeletonMs - elapsed);
      if (remaining === 0) {
        setLoaded(true);
        onReady?.(img);
      } else {
        doneTimer.current = window.setTimeout(() => {
          setLoaded(true);
          doneTimer.current = null;
          onReady?.(img);
        }, remaining) as unknown as number;
      }
    };


    return (
      <div
        className={`${styles.wrapper} ${wrapperClassName ?? ""}`}
        style={{
          aspectRatio: ratio ? `${ratio}` : "1 / 1", // fallback cuadrado
          // width: "100%",
          height: "100%",
        }}
        aria-busy={!loaded && !error}
      >
        {!loaded && !error && <div className={styles.skeleton} />}

        {!error ? (
          <Image
            ref={ref as any}
            key={srcKey}
            {...imgProps}
            onLoad={(e) => {
              const img = e.currentTarget as HTMLImageElement
              setRatio(img.naturalWidth / img.naturalHeight);
              handleLoaded(img);
            }}
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
