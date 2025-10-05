"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image, { ImageProps } from "next/image";
import styles from "./ImageWithSkeleton.module.css";
import { proxifySrc } from "@/lib/imgProxy";

type Props = Omit<ImageProps, "onError"> & {
  wrapperClassName?: string;
  minSkeletonMs?: number;
  fallbackText?: string;
  forceSkeletonOnSrcChange?: boolean;
  onReady?: (img: any) => void;
};

function srcToString(src: any): string {
  if (typeof src === "string") return src;
  return src?.src ?? "";
}

const ImageWithSkeleton = React.forwardRef<HTMLImageElement, Props>(
  (props, ref) => {
    const {
      wrapperClassName,
      className,
      minSkeletonMs = 180,
      fallbackText = "×",
      forceSkeletonOnSrcChange = true,
      onReady,
      ...imgProps
    } = props;

    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);
    const [mountedAt, setMountedAt] = useState<number>(() => Date.now());
    const doneTimer = useRef<number | null>(null);
    const [ratio, setRatio] = useState<number | null>(null);

    const srcKey = useMemo(() => srcToString(imgProps.src), [imgProps.src]);

    // --- ref combinada para poder leer .complete y no romper la ref externa ---
    const imgElRef = useRef<HTMLImageElement | null>(null);
    const setRefs = (node: HTMLImageElement | null) => {
      imgElRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref)
        (ref as React.MutableRefObject<HTMLImageElement | null>).current = node;
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

    useEffect(
      () => () => {
        if (doneTimer.current) window.clearTimeout(doneTimer.current);
      },
      []
    );

    const handleLoaded = (img: HTMLImageElement) => {
      if (error) return;
      const elapsed = Date.now() - mountedAt;
      const remaining = Math.max(0, minSkeletonMs - elapsed);
      const finish = () => {
        setLoaded(true);
        onReady?.(img);
      };
      if (remaining === 0) finish();
      else
        doneTimer.current = window.setTimeout(() => {
          finish();
          doneTimer.current = null;
        }, remaining) as unknown as number;
    };

    // --- SAFARI FIX: si la imagen ya estaba en caché al montar, simula el onLoad ---
    useEffect(() => {
      const img = imgElRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        setRatio(img.naturalWidth / img.naturalHeight);
        handleLoaded(img);
      }
    }, [srcKey]); // re-check cuando cambia el src

    const proxiedSrc = useMemo(
      () => proxifySrc(srcToString(imgProps.src)),
      [imgProps.src]
    );

    return (
      <div
        className={`${styles.wrapper} ${wrapperClassName ?? ""}`}
        style={{ aspectRatio: ratio ? `${ratio}` : "1 / 1", height: "100%" }}
        aria-busy={!loaded && !error}
      >
        {!loaded && !error && <div className={styles.skeleton} />}

        {!error ? (
          <Image
            ref={setRefs}
            key={proxiedSrc}
            {...imgProps}
            // Si es above-the-fold, esto evita IO/refresh raros en Safari:
            loading={imgProps.loading ?? "eager"}
            // Mucho más fiable que onLoad con caché:
            onLoadingComplete={(img) => {
              setRatio(img.naturalWidth / img.naturalHeight);
              handleLoaded(img);
            }}
            onLoad={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              setRatio(img.naturalWidth / img.naturalHeight);
              handleLoaded(img);
            }}
            onError={() => {
              setError(true);
              setLoaded(false);
            }}
            className={`${styles.image} ${loaded ? styles.imageVisible : ""} ${
              className ?? ""
            }`}
            // (Opcional) evita doble optimización si usas proxy propio:
            // unoptimized
            // (Opcional) prioridad para hero/primer fold:
            // priority
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
