"use client";

import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./Minimap.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";

type Props = {
  src: string;
  imgW: number;
  imgH: number;
  cx: number; // %
  cy: number; // %
  zoom: number;
  viewportPx: { vw: number; vh: number };
  onMoveViewport: (xPct: number, yPct: number) => void;
  miniAspect?: string;
  className?: string;
  /** cuando true, ignora cualquier interacción (se usa mientras se arrastra el flotante) */
  disabled?: boolean;
};

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export default function Minimap({
  src,
  imgW,
  imgH,
  cx,
  cy,
  zoom,
  viewportPx,
  onMoveViewport,
  miniAspect,
  className,
  disabled = false,
}: Props) {
  const miniRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({
    mw: 1,
    mh: 1,
    dW: 1,
    dH: 1,
    offX: 0,
    offY: 0,
  });

  // === medir ===
  const measure = useCallback(() => {
    if (!miniRef.current || !imgW || !imgH) return;
    const rect = miniRef.current.getBoundingClientRect();
    const mw = rect.width;
    const mh = rect.height;
    const s = Math.min(mw / imgW, mh / imgH);
    const dW = imgW * s;
    const dH = imgH * s;
    const offX = (mw - dW) / 2;
    const offY = (mh - dH) / 2;
    setDims({ mw, mh, dW, dH, offX, offY });
  }, [imgW, imgH]);

  useLayoutEffect(() => {
    measure();
  }, [measure, imgW, imgH, miniAspect, viewportPx.vw, viewportPx.vh]);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (miniRef.current) ro.observe(miniRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const viewWPercent = useMemo(
    () => (viewportPx.vw / (imgW * zoom)) * 100,
    [viewportPx.vw, imgW, zoom]
  );
  const viewHPercent = useMemo(
    () => (viewportPx.vh / (imgH * zoom)) * 100,
    [viewportPx.vh, imgH, zoom]
  );

  const vpStyle = useMemo(() => {
    const effW = Math.min(viewWPercent, 100);
    const effH = Math.min(viewHPercent, 100);
    const vpWpx = dims.dW * (effW / 100);
    const vpHpx = dims.dH * (effH / 100);
    let left = dims.offX + ((cx - effW / 2) / 100) * dims.dW;
    let top = dims.offY + ((cy - effH / 2) / 100) * dims.dH;
    left = clamp(left, dims.offX, dims.offX + dims.dW - vpWpx);
    top = clamp(top, dims.offY, dims.offY + dims.dH - vpHpx);
    return {
      width: `${vpWpx}px`,
      height: `${vpHpx}px`,
      left: `${left}px`,
      top: `${top}px`,
    } as React.CSSProperties;
  }, [dims, viewWPercent, viewHPercent, cx, cy]);

  const moveViewportToPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = miniRef.current?.getBoundingClientRect();
      if (!rect || !dims.dW || !dims.dH) return;
      const xIn = clientX - rect.left - dims.offX;
      const yIn = clientY - rect.top - dims.offY;
      const nx = clamp(xIn / dims.dW, 0, 1) * 100;
      const ny = clamp(yIn / dims.dH, 0, 1) * 100;
      const halfW = Math.min(viewWPercent, 100) / 2;
      const halfH = Math.min(viewHPercent, 100) / 2;
      onMoveViewport(
        clamp(nx, halfW, 100 - halfW),
        clamp(ny, halfH, 100 - halfH)
      );
    },
    [dims, viewWPercent, viewHPercent, onMoveViewport]
  );

  // === sólo responde si el pointerDown fue en el propio minimapa ===
  const [activePointer, setActivePointer] = useState<number | null>(null);

  const handleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setActivePointer(e.pointerId);
    moveViewportToPoint(e.clientX, e.clientY);
  };
  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || activePointer !== e.pointerId) return;
    moveViewportToPoint(e.clientX, e.clientY);
  };
  const handleUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (activePointer !== e.pointerId) return;
    setActivePointer(null);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const ar =
    miniAspect ||
    (imgW && imgH ? `${Math.max(imgW, 1)}/${Math.max(imgH, 1)}` : undefined);

  return (
    <div
      ref={miniRef}
      className={`${styles.minimap} ${className ?? ""}`}
      style={{
        touchAction: "none",
        aspectRatio: ar,
        pointerEvents: disabled ? "none" : "auto",
      }}
      data-no-pin // 👈 importante: no crear hilos al clickar aquí
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUpOrCancel}
      onPointerCancel={handleUpOrCancel}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.miniImgWrap} data-no-pin>
        <ImageWithSkeleton
          src={src}
          alt=""
          fill
          sizes="320px"
          priority
          draggable={false}
          className={styles.miniImg}
          onDragStart={(e) => e.preventDefault()}
        />
      </div>
      <div className={styles.viewport} style={vpStyle} data-no-pin />
      <div className={styles.veil} data-no-pin />
    </div>
  );
}
