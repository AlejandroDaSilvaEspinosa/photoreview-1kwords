"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useImageGeometry() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState({
    offsetLeft: 0,
    offsetTop: 0,
    width: 0,
    height: 0,
  });

  const update = useCallback(() => {
    const w = wrapperRef.current;
    const i = imgRef.current;
    if (!w || !i) return;
    const wr = w.getBoundingClientRect();
    const ir = i.getBoundingClientRect();
    setBox({
      offsetLeft: ir.left - wr.left,
      offsetTop: ir.top - wr.top,
      width: ir.width,
      height: ir.height,
    });
  }, []);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(() => update());
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [update]);

  return { wrapperRef, imgRef, box, update };
}
