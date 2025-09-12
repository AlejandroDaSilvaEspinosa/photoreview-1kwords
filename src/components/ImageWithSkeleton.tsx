"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image, { ImageProps } from "next/image";
import styles from "./ImageWithSkeleton.module.css";

type Props = Omit<ImageProps, "onLoadingComplete" | "onError"> & {
  /** ms mínimos que el skeleton debe permanecer visible (evita flash) */
  minSkeletonMs?: number;
  /** Texto/char de fallback si falla */
  fallbackText?: string;
  /** Fuerza reactivar skeleton cuando cambia src (true por defecto) */
  forceSkeletonOnSrcChange?: boolean;
};

function srcToString(src: ImageProps["src"]): string {
  if (typeof src === "string") return src;
  // StaticImport (next/image import)
  // @ts-ignore
  return src?.src ?? "";
}

export default function ImageWithSkeleton({
  className,
  minSkeletonMs = 180,
  fallbackText = "×",
  forceSkeletonOnSrcChange = true,
  ...imgProps
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [mountedAt, setMountedAt] = useState<number>(() => Date.now());
  const doneTimer = useRef<number | null>(null);

  // String estable del src para resetear estados cuando cambie
  const srcKey = useMemo(() => srcToString(imgProps.src), [imgProps.src]);

  // Si cambia el src: resetea estados y asegura que se vea skeleton
  useEffect(() => {
    if (!forceSkeletonOnSrcChange) return;
    setLoaded(false);
    setError(false);
    setMountedAt(Date.now());
    // limpia cualquier timeout previo
    if (doneTimer.current) {
      window.clearTimeout(doneTimer.current);
      doneTimer.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey]);

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
    } else {
      doneTimer.current = window.setTimeout(() => {
        setLoaded(true);
        doneTimer.current = null;
      }, remaining) as unknown as number;
    }
  };

  const w =
    typeof imgProps.width === "number" ? imgProps.width : undefined;
  const h =
    typeof imgProps.height === "number" ? imgProps.height : undefined;

  return (
    <div
      className={`${styles.wrapper} ${className ?? ""}`}
      style={{
        width: w ? `${w}px` : undefined,
        height: h ? `${h}px` : undefined,
      }}
      aria-busy={!loaded && !error}
    >
      {/* Skeleton oscuro y notorio mientras carga o si hay error */}
      {!loaded && !error && <div className={styles.skeleton} />}

      {!error ? (
        <Image
          key={srcKey} // fuerza remount al cambiar src
          {...imgProps}
          onLoadingComplete={handleLoaded}
          onError={() => {
            setError(true);
            setLoaded(false);
          }}
          className={`${styles.image} ${loaded ? styles.imageVisible : ""} ${
            imgProps.className ?? ""
          }`}
        />
      ) : (
        <div className={styles.fallback} title="No se pudo cargar la imagen">
          {fallbackText}
        </div>
      )}
    </div>
  );
}
