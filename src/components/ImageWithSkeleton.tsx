"use client";

import { useEffect, useMemo, useRef, useState, forwardRef } from "react";
import Image, { ImageProps } from "next/image";
import styles from "./ImageWithSkeleton.module.css";

type Props = Omit<ImageProps, "onLoadingComplete" | "onError"> & {
  /** clase para el contenedor (wrapper) */
  wrapperClassName?: string;
  /** ms mínimos que el skeleton permanece visible */
  minSkeletonMs?: number;
  /** Texto/char de fallback si falla */
  fallbackText?: string;
  /** Reactivar skeleton cuando cambia src */
  forceSkeletonOnSrcChange?: boolean;
  onReady?: () => void; 
};

function srcToString(src: ImageProps["src"]): string {
  if (typeof src === "string") return src;
  // @ts-ignore StaticImport
  return src?.src ?? "";
}

const ImageWithSkeleton = forwardRef<HTMLImageElement, Props>(function ImageWithSkeleton(
  {
    wrapperClassName,
    className,                 // clase para la IMG
    minSkeletonMs = 180,
    fallbackText = "×",
    forceSkeletonOnSrcChange = true,
    onReady,
    ...imgProps                // resto de props de <Image>
  },
  ref
) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [mountedAt, setMountedAt] = useState<number>(() => Date.now());
  const doneTimer = useRef<number | null>(null);

  const srcKey = useMemo(() => srcToString(imgProps.src), [imgProps.src]);
  const finishLoad = () => {
    setLoaded(true);
    // Llamamos en el siguiente frame para asegurar layout final
    requestAnimationFrame(() => onReady?.());
  };
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
    if (remaining === 0) finishLoad();
    else {
      doneTimer.current = window.setTimeout(() => {
        setLoaded(true);
        doneTimer.current = null;
      }, remaining) as unknown as number;
    }
  };

  const w = typeof imgProps.width === "number" ? imgProps.width : undefined;
  const h = typeof imgProps.height === "number" ? imgProps.height : undefined;

  return (
    <div
      className={`${styles.wrapper} ${wrapperClassName ?? ""}`}
      style={imgProps.width && imgProps.height ? { width: w, height: h } : undefined}
      aria-busy={!loaded && !error}
    >
      {!loaded && !error && <div className={styles.skeleton} />}

      {!error ? (
        <Image
          key={srcKey}
          ref={ref}                 
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
});

export default ImageWithSkeleton;
