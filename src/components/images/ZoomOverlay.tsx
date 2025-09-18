// ZoomOverlay.tsx 

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ZoomOverlay.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThreadChat from "./ThreadChat";
import { Thread, ThreadStatus } from "@/types/review";

type Props = {
  src: string;
  threads: Thread[];
  activeThreadId: number | null;
  initial?: { xPct: number; yPct: number; zoom?: number; ax?: number; ay?: number };
  currentUsername?: string;
  onCreateThreadAt: (xPct: number, yPct: number) => void;
  onFocusThread: (id: number | null) => void;
  onAddThreadMessage: (threadId: number, text: string) => void;
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => void;
  onDeleteThread: ( id: number) => void;
  onClose: () => void;
};

type ToolMode = "pan" | "pin";

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const colorByStatus = (s: ThreadStatus) =>
  s === "corrected" ? "#0FA958" : s === "reopened" ? "#FFB000" : s === "deleted" ? "#666" : "#FF0040";
const toggleLabel = (s: ThreadStatus) => (s === "corrected" ? "Reabrir" : "Corregido");
const nextStatus = (s: ThreadStatus): ThreadStatus =>
  s === "corrected" ? "reopened" : "corrected";

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const mid = (ax: number, ay: number, bx: number, by: number) => ({ x: (ax + bx) / 2, y: (ay + by) / 2 });

export default function ZoomOverlay({
  src,
  threads,
  activeThreadId,
  onFocusThread,
  onAddThreadMessage,
  onToggleThreadStatus,
  onCreateThreadAt,
  onDeleteThread,
  onClose,
  initial,
  currentUsername
}: Props) {
  // Tamaño real de la imagen
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  const [imgReady, setImgReady] = useState(false);

  // Centro (en %) y zoom
  const [cx, setCx] = useState(initial?.xPct ?? 50);
  const [cy, setCy] = useState(initial?.yPct ?? 50);
  const [zoom, setZoom] = useState(initial?.zoom ?? 1);

  const [hasInitialized, setHasInitialized] = useState(false);
  const [tool, setTool] = useState<ToolMode>("pan");
  const [isDragging, setIsDragging] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; cxPx: number; cyPx: number } | null>(null);
  const movedRef = useRef(false);

  // Doble-tap & pinch control
  const tapRef = useRef<{ t: number; x: number; y: number }>({ t: 0, x: 0, y: 0 });
  const gestureRef = useRef<{
    mode: "none" | "pan" | "pinch";
    startX: number;
    startY: number;
    startCxPx: number;
    startCyPx: number;
    startZoom: number;
    startDist: number;
    xImg0: number;
    yImg0: number;
    tapX: number;
    tapY: number;
    moved: boolean;
    didPinch: boolean;
  }>({
    mode: "none",
    startX: 0,
    startY: 0,
    startCxPx: 0,
    startCyPx: 0,
    startZoom: 1,
    startDist: 0,
    xImg0: 0,
    yImg0: 0,
    tapX: 0,
    tapY: 0,
    moved: false,
    didPinch: false,
  });

  // rAF throttle para pinch
  const pinchRAF = useRef<number | null>(null);

  // minimapa
  const miniRef = useRef<HTMLDivElement>(null);
  const [miniDims, setMiniDims] = useState({ mw: 1, mh: 1, dW: 1, dH: 1, offX: 0, offY: 0 });

  // re-render en resize
  const [, force] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => force((n) => n + 1));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // cerrar con ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // tamaño viewport
  const view = (() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { vw: rect?.width ?? 1, vh: rect?.height ?? 1 };
  })();

  // zooms
  const getMinZoom = useCallback(() => {
    if (!imgW || !imgH) return 1;
    return Math.min(view.vw / imgW, view.vh / imgH);
  }, [imgW, imgH, view.vw, view.vh]);

  const getFitZoom = useCallback(() => {
    if (!imgW || !imgH || !view.vw || !view.vh) return 1;
    return Math.min(view.vw / imgW, view.vh / imgH);
  }, [imgW, imgH, view.vw, view.vh]);

  // zoom que permite pan en ambos ejes (ligeramente > fit)
  const getPanEnabledZoom = useCallback(() => {
    if (!imgW || !imgH || !view.vw || !view.vh) return 1;
    const rw = view.vw / imgW;
    const rh = view.vh / imgH;
    return Math.max(rw, rh) * 1.06; // holgura
  }, [imgW, imgH, view.vw, view.vh]);

  // centro en px
  const cxPx = (cx / 100) * imgW;
  const cyPx = (cy / 100) * imgH;

  // transform
  const tx = view.vw / 2 - cxPx * zoom;
  const ty = view.vh / 2 - cyPx * zoom;

  // visible %
  const viewWPercent = (view.vw / (imgW * zoom)) * 100;
  const viewHPercent = (view.vh / (imgH * zoom)) * 100;

  // ==== helpers de clamping ====

  // clamp del centro en PX para un zoom dado, devuelve %
  const clampCenterPxFor = useCallback(
    (cxPxNew: number, cyPxNew: number, z: number) => {
      if (!imgW || !imgH || !view.vw || !view.vh) return { cx: 50, cy: 50 };

      const visWpx = view.vw / z;
      const visHpx = view.vh / z;

      if (visWpx >= imgW && visHpx >= imgH) return { cx: 50, cy: 50 };

      const halfW = Math.min(visWpx / 2, imgW / 2);
      const halfH = Math.min(visHpx / 2, imgH / 2);

      const cxPxClamped = clamp(cxPxNew, halfW, imgW - halfW);
      const cyPxClamped = clamp(cyPxNew, halfH, imgH - halfH);

      return { cx: (cxPxClamped / imgW) * 100, cy: (cyPxClamped / imgH) * 100 };
    },
    [imgW, imgH, view.vw, view.vh]
  );

  // centrar con ancla y “pegar a bordes” si es esquina
  const centerEdgeAware = useCallback(
    (fx: number, fy: number, z: number, ax = 0.5, ay = 0.5) => {
      if (!imgW || !imgH || !view.vw || !view.vh) return { cx: 50, cy: 50 };
      const wPct = (view.vw / (imgW * z)) * 100;
      const hPct = (view.vh / (imgH * z)) * 100;
      const halfW = Math.min(wPct, 100) / 2;
      const halfH = Math.min(hPct, 100) / 2;

      let axEff = ax,
        ayEff = ay;
      if (fx <= halfW) axEff = 0;
      else if (fx >= 100 - halfW) axEff = 1;
      if (fy <= halfH) ayEff = 0;
      else if (fy >= 100 - halfH) ayEff = 1;

      let cxNew = fx - (2 * axEff - 1) * halfW;
      let cyNew = fy - (2 * ayEff - 1) * halfH;

      cxNew = clamp(cxNew, halfW, 100 - halfW);
      cyNew = clamp(cyNew, halfH, 100 - halfH);
      return { cx: cxNew, cy: cyNew };
    },
    [imgW, imgH, view.vw, view.vh]
  );

  // ====== inicialización ======
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden"; 

    return () => {
      document.body.style.overflow = original; 
    };
  }, []);

  const initializeView = useCallback(() => {
    if (hasInitialized || !imgReady || !view.vw || !view.vh) return;

    const fit = getFitZoom();
    const panZoom = getPanEnabledZoom();
    const z0 = Math.max(initial?.zoom ?? fit * 1.2, panZoom);

    const fx = initial?.xPct ?? 50;
    const fy = initial?.yPct ?? 50;

    const { cx, cy } = centerEdgeAware(fx, fy, z0, initial?.ax ?? 0.5, initial?.ay ?? 0.5);

    setZoom(z0);
    setCx(cx);
    setCy(cy);
    setHasInitialized(true);
  }, [hasInitialized, imgReady, view.vw, view.vh, initial, getFitZoom, getPanEnabledZoom, centerEdgeAware]);

  useEffect(() => {
    initializeView();
  }, [initializeView]);
  
function normalize(s?: string | null) {
  return (s ?? "").trim().toLowerCase();
}
  const isMine = (author?: string | null) => {
    const me = normalize(currentUsername);
    const a = normalize(author);
    return !a || (!!me && a === me);
  };

  // ====== rueda (desktop) ======
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      e.stopPropagation()
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect || !imgW || !imgH) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;

      const SENS = 0.0015;
      const factor = Math.exp(-e.deltaY * SENS);

      const minZ = getMinZoom();
      const maxZ = 10;
      const nextZ = clamp(zoom * factor, minZ, maxZ);

      if (nextZ >= zoom) {
        // zoom IN: pivota en el ratón
        const xImg = (localX - tx) / zoom;
        const yImg = (localY - ty) / zoom;
        const cxPxNext = view.vw / (2 * nextZ) + xImg - localX / nextZ;
        const cyPxNext = view.vh / (2 * nextZ) + yImg - localY / nextZ;
        const { cx, cy } = clampCenterPxFor(cxPxNext, cyPxNext, nextZ);
        setZoom(nextZ);
        setCx(cx);
        setCy(cy);
      } else {
        // zoom OUT: ignora ratón, conserva encuadre
        const cxPxNow = (cx / 100) * imgW;
        const cyPxNow = (cy / 100) * imgH;
        const { cx: cx2, cy: cy2 } = clampCenterPxFor(cxPxNow, cyPxNow, nextZ);
        setZoom(nextZ);
        setCx(cx2);
        setCy(cy2);
      }
    },
    [wrapRef, imgW, imgH, view.vw, view.vh, tx, ty, zoom, cx, cy, getMinZoom, clampCenterPxFor]
  );

  // ====== mouse drag (pan) ======
  const visWpx = view.vw / zoom;
  const visHpx = view.vh / zoom;

  const setCenterToPx = useCallback(
    (nx: number, ny: number) => {
      const halfW = Math.min(visWpx / 2, imgW / 2);
      const halfH = Math.min(visHpx / 2, imgH / 2);
      const newCx = ((clamp(nx, halfW, imgW - halfW)) / imgW) * 100;
      const newCy = ((clamp(ny, halfH, imgH - halfH)) / imgH) * 100;
      setCx(newCx);
      setCy(newCy);
    },
    [imgW, imgH, visWpx, visHpx]
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (tool !== "pan") return;
    movedRef.current = false;
    setIsDragging(true)
    dragRef.current = { x: e.clientX, y: e.clientY, cxPx, cyPx };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (tool !== "pan" || !dragRef.current) return;
    const dx = (e.clientX - dragRef.current.x) / zoom;
    const dy = (e.clientY - dragRef.current.y) / zoom;
    setCenterToPx(dragRef.current.cxPx - dx, dragRef.current.cyPx - dy);
  };
  const endDrag = () => {
    setIsDragging(false)
    dragRef.current = null;
  };

  // ====== click principal → crear hilo ======
  const onClickMain = (e: React.MouseEvent) => {
    const wantsPin = tool === "pin" || e.shiftKey;
    if (!wantsPin) return;
    if (dragRef.current) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xImgPx = (e.clientX - rect.left - tx) / zoom;
    const yImgPx = (e.clientY - rect.top - ty) / zoom;
    const xPct = clamp((xImgPx / imgW) * 100, 0, 100);
    const yPct = clamp((yImgPx / imgH) * 100, 0, 100);
    onCreateThreadAt(xPct, yPct);
  };

  // ====== minimapa ======
  const measureMini = useCallback(() => {
    if (!miniRef.current || !imgW || !imgH) return;
    const rect = miniRef.current.getBoundingClientRect();
    const mw = rect.width;
    const mh = rect.height;
    const s = Math.min(mw / imgW, mh / imgH);
    const dW = imgW * s;
    const dH = imgH * s;
    const offX = (mw - dW) / 2;
    const offY = (mh - dH) / 2;
    setMiniDims({ mw, mh, dW, dH, offX, offY });
  }, [imgW, imgH]);

  useEffect(() => {
    measureMini();
  }, [measureMini, view.vw, view.vh]);

  useEffect(() => {
    const ro = new ResizeObserver(() => measureMini());
    if (miniRef.current) ro.observe(miniRef.current);
    return () => ro.disconnect();
  }, [measureMini]);

  const moveViewportToMiniPos = useCallback(
    (clientX: number, clientY: number) => {
      const rect = miniRef.current?.getBoundingClientRect();
      if (!rect || !miniDims.dW || !miniDims.dH) return;
      const xIn = clientX - rect.left - miniDims.offX;
      const yIn = clientY - rect.top - miniDims.offY;
      const nx = clamp(xIn / miniDims.dW, 0, 1) * 100;
      const ny = clamp(yIn / miniDims.dH, 0, 1) * 100;
      const wPct = (view.vw / (imgW * zoom)) * 100;
      const hPct = (view.vh / (imgH * zoom)) * 100;
      const halfW = Math.min(wPct, 100) / 2;
      const halfH = Math.min(hPct, 100) / 2;
      setCx(clamp(nx, halfW, 100 - halfW));
      setCy(clamp(ny, halfH, 100 - halfH));
    },
    [miniDims, view.vw, view.vh, imgW, imgH, zoom]
  );

  const onMiniClickOrDrag = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      moveViewportToMiniPos(e.clientX, e.clientY);
    },
    [moveViewportToMiniPos]
  );

  // ✅ minimapa táctil (1 dedo)
  const onMiniTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    moveViewportToMiniPos(t.clientX, t.clientY);
  }, [moveViewportToMiniPos]);

  const onMiniTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    moveViewportToMiniPos(t.clientX, t.clientY);
  }, [moveViewportToMiniPos]);

  const vpStyle = useMemo(() => {
    const effW = Math.min(viewWPercent, 100);
    const effH = Math.min(viewHPercent, 100);
    const vpWpx = miniDims.dW * (effW / 100);
    const vpHpx = miniDims.dH * (effH / 100);
    let left = miniDims.offX + ((cx - effW / 2) / 100) * miniDims.dW;
    let top = miniDims.offY + ((cy - effH / 2) / 100) * miniDims.dH;
    left = clamp(left, miniDims.offX, miniDims.offX + miniDims.dW - vpWpx);
    top = clamp(top, miniDims.offY, miniDims.offY + miniDims.dH - vpHpx);
    return { width: `${vpWpx}px`, height: `${vpHpx}px`, left: `${left}px`, top: `${top}px` };
  }, [miniDims, viewWPercent, viewHPercent, cx, cy]);

  // ====== chat ======
  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const fitToView = useCallback(() => {
    const z = getFitZoom();
    setZoom(z);
    setCx(50);
    setCy(50);
  }, [getFitZoom]);

  // ====== MOBILE: touch gestures ======

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault(); // evita gestos nativos (junto con touch-action:none)
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect || !imgW || !imgH) return;

      if (e.touches.length === 1) {
        const t = e.touches[0];
        const x = t.clientX - rect.left;
        const y = t.clientY - rect.top;

        gestureRef.current.mode = "pan";
        gestureRef.current.startX = x;
        gestureRef.current.startY = y;
        gestureRef.current.startCxPx = (cx / 100) * imgW;
        gestureRef.current.startCyPx = (cy / 100) * imgH;
        gestureRef.current.tapX = x;
        gestureRef.current.tapY = y;
        gestureRef.current.moved = false;
        // NO reseteamos didPinch aquí; se resetea al terminar completamente el gesto
      } else if (e.touches.length >= 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const x0 = t0.clientX - rect.left;
        const y0 = t0.clientY - rect.top;
        const x1 = t1.clientX - rect.left;
        const y1 = t1.clientY - rect.top;

        const { x: mx, y: my } = mid(x0, y0, x1, y1);
        const d = dist(x0, y0, x1, y1);

        gestureRef.current.mode = "pinch";
        gestureRef.current.startZoom = zoom;
        gestureRef.current.startDist = d || 1;
        gestureRef.current.xImg0 = (mx - tx) / zoom;
        gestureRef.current.yImg0 = (my - ty) / zoom;
        gestureRef.current.didPinch = true;
      }
    },
    [wrapRef, imgW, imgH, cx, cy, zoom, tx, ty]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect || !imgW || !imgH) return;

      if (gestureRef.current.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0];
        const x = t.clientX - rect.left;
        const y = t.clientY - rect.top;

        const dx = (x - gestureRef.current.startX) / zoom;
        const dy = (y - gestureRef.current.startY) / zoom;

        const cxPxNew = gestureRef.current.startCxPx - dx;
        const cyPxNew = gestureRef.current.startCyPx - dy;
        const { cx: cxPct, cy: cyPct } = clampCenterPxFor(cxPxNew, cyPxNew, zoom);
        setCx(cxPct);
        setCy(cyPct);

        if (Math.abs(x - gestureRef.current.startX) > 4 || Math.abs(y - gestureRef.current.startY) > 4) {
          gestureRef.current.moved = true;
        }
      } else if (gestureRef.current.mode === "pinch" && e.touches.length >= 2) {
        // Throttle a rAF para evitar jitter (amplía-reduce “raro”)
        if (pinchRAF.current != null) return;
        pinchRAF.current = requestAnimationFrame(() => {
          pinchRAF.current = null;

          const t0 = e.touches[0];
          const t1 = e.touches[1];
          const x0 = t0.clientX - rect.left;
          const y0 = t0.clientY - rect.top;
          const x1 = t1.clientX - rect.left;
          const y1 = t1.clientY - rect.top;

          const dNow = dist(x0, y0, x1, y1);
          const factor = dNow / (gestureRef.current.startDist || dNow);

          const minZ = getMinZoom();
          const maxZ = 10;
          const nextZ = clamp(gestureRef.current.startZoom * factor, minZ, maxZ);

          const mx = (x0 + x1) / 2;
          const my = (y0 + y1) / 2;

          const cxPxNext = view.vw / (2 * nextZ) + gestureRef.current.xImg0 - mx / nextZ;
          const cyPxNext = view.vh / (2 * nextZ) + gestureRef.current.yImg0 - my / nextZ;
          const { cx: cxPct, cy: cyPct } = clampCenterPxFor(cxPxNext, cyPxNext, nextZ);

          setZoom(nextZ);
          setCx(cxPct);
          setCy(cyPct);
        });
      }
    },
    [wrapRef, imgW, imgH, zoom, view.vw, view.vh, getMinZoom, clampCenterPxFor]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // Si aún quedan dedos en pantalla, no cerramos gesto
      if (e.touches.length > 0) return;

      // Doble-tap: solo si NO hubo pinch en este gesto
      const now = performance.now();
      const last = tapRef.current;
      const x = gestureRef.current.tapX;
      const y = gestureRef.current.tapY;
      const isQuick = now - last.t < 300 && dist(x, y, last.x, last.y) < 30;
      const canDoubleTap = !gestureRef.current.moved && !gestureRef.current.didPinch;

      if (isQuick && canDoubleTap) {
        const rect = wrapRef.current?.getBoundingClientRect();
        if (rect) {
          const fit = getFitZoom();
          const panZoom = getPanEnabledZoom();
          const threshold = panZoom * 1.5;

          if (zoom >= threshold) {
            // Zoom OUT (toggle): vuelve a una vista cómoda para panear
            const nextZ = panZoom;
            const cxPxNow = (cx / 100) * imgW;
            const cyPxNow = (cy / 100) * imgH;
            const { cx: cx2, cy: cy2 } = clampCenterPxFor(cxPxNow, cyPxNow, nextZ);
            setZoom(nextZ);
            setCx(cx2);
            setCy(cy2);
          } else {
            // Zoom IN (toggle): acerca alrededor del tap
            const localX = x;
            const localY = y;
            const xImg = (localX - tx) / zoom;
            const yImg = (localY - ty) / zoom;
            const nextZ = clamp(Math.max(zoom * 2, fit * 2.4), getMinZoom(), 10);
            const cxPxNext = view.vw / (2 * nextZ) + xImg - localX / nextZ;
            const cyPxNext = view.vh / (2 * nextZ) + yImg - localY / nextZ;
            const { cx: cxPct, cy: cyPct } = clampCenterPxFor(cxPxNext, cyPxNext, nextZ);
            setZoom(nextZ);
            setCx(cxPct);
            setCy(cyPct);
          }
        }
      }

      // actualizar memoria de tap y resetear estado de gesto
      tapRef.current = { t: now, x: gestureRef.current.tapX, y: gestureRef.current.tapY };
      gestureRef.current.mode = "none";
      gestureRef.current.didPinch = false; // IMPORTANTE: permite doble-tap en el siguiente gesto
      if (pinchRAF.current) {
        cancelAnimationFrame(pinchRAF.current);
        pinchRAF.current = null;
      }
    },
    [wrapRef, zoom, tx, ty, view.vw, view.vh, cx, cy, imgW, imgH, getFitZoom, getPanEnabledZoom, getMinZoom, clampCenterPxFor]
  );

  // ====== dots ======
  const dots = useMemo(
    () =>
      threads.map((t) => ({
        id: t.id,
        left: `${t.x}%`,
        top: `${t.y}%`,
        status: t.status,
        num: 1 + threads.findIndex((x) => x.id === t.id),
      })),
    [threads]
  );

  const centerToThread = (t: Thread) => {
    const px = (t.x / 100) * imgW;
    const py = (t.y / 100) * imgH;
    setCenterToPx(px, py);
    onFocusThread(t.id);
  };
  const [cursor, setCursor] = useState("")

  useEffect(() => {
    console.log("test")
    console.log(dragRef)
    setCursor(tool === "pin" ? "crosshair" : dragRef.current ? "grabbing" : "grab")
  },[isDragging,tool])

  return (
    <div className={styles.overlay} role="dialog" aria-label="Zoom" style={{ touchAction: "none" }} >
      <button className={styles.close} onClick={onClose} aria-label="Cerrar">
        ×
      </button>

      {/* TOOLBOX */}
      <div className={styles.toolbox} aria-label="Herramientas">
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "pan" ? styles.toolActive : ""}`}
          aria-pressed={tool === "pan"}
          title="Mover (arrastrar)"
          onClick={() => setTool("pan")}
        >
          🖐️
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "pin" ? styles.toolActive : ""}`}
          aria-pressed={tool === "pin"}
          title="Añadir nuevo hilo"
          onClick={() => setTool("pin")}
        >
          📍
        </button>
      </div>

      {/* Viewport principal */}
      <div
        className={styles.mainWrap}
        ref={wrapRef}
        style={{ touchAction: "none" }} // 🔒 bloquea gestos nativos
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onClick={onClickMain}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          className={styles.stage}
          style={{
            width: imgW || "100%",
            height: imgH || "100%",
            transform: imgReady ? `translate(${tx}px, ${ty}px) scale(${zoom})` : "none",
            cursor,
          }}
        >
          {/* Imagen principal */}
          <div className={styles.imgWrap}>
            <ImageWithSkeleton
              src={src}
              alt=""
              fill
              sizes="100vw"
              priority
              draggable={false}
              className={styles.img}
              onReady={(el: any) => {
                const w = el.naturalWidth || 1;
                const h = el.naturalHeight || 1;
                setImgW(w);
                setImgH(h);
                setImgReady(true);
                requestAnimationFrame(() => measureMini());
              }}
            />
          </div>

          {/* Puntos */}
          {dots.map((d) => (
            <button
              key={d.id}
              className={`${styles.dot} ${activeThreadId === d.id ? styles.dotActive : ""}`}
              style={{ left: d.left, top: d.top, background: colorByStatus(d.status) }}
              title={`Hilo #${d.num}`}
              onClick={(e) => {
                e.stopPropagation();
                onFocusThread(d.id);
              }}
            >
              <span className={styles.dotNum}>{d.num}</span>
            </button>
          ))}
        </div>

      {activeThread && (
        <ThreadChat
          activeThread={activeThread}
          threads={threads}
          isMine={isMine}
          onAddThreadMessage={onAddThreadMessage}
          onFocusThread={onFocusThread}
          onToggleThreadStatus={onToggleThreadStatus}
          onDeleteThread={onDeleteThread}
        />
      )}
      </div>

      {/* Sidebar */}
      <div className={styles.sidebar} style={{ touchAction: "none" }}>
        <div
          className={styles.minimap}
          ref={miniRef}
          style={{ touchAction: "none" }} // ✅ evita scroll nativo en mini
          onMouseDown={onMiniClickOrDrag}
          onMouseMove={(e) => e.buttons === 1 && onMiniClickOrDrag(e)}
          onTouchStart={onMiniTouchStart}
          onTouchMove={onMiniTouchMove}
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
              onLoadingComplete={() => measureMini()}
            />
          </div>
          <div className={styles.viewport} style={vpStyle} />
          <div className={styles.veil} />
        </div>

        <div className={styles.controls}>
          <div className={styles.row}>
            <button onClick={() => setZoom((z) => clamp(z * 0.9, getMinZoom(), 10))}>−</button>
            <span className={styles.zoomLabel}>{zoom.toFixed(2)}×</span>
            <button onClick={() => setZoom((z) => clamp(z * 1.1, getMinZoom(), 10))}>+</button>
            <button onClick={fitToView} title="Ajustar a ventana">
              🔍
            </button>
          </div>
          <div className={styles.hint}>
            🖐️ mover · 📍 anotar · rueda/gestos para zoom · doble-tap (móvil) · Esc para cerrar
          </div>

          <div className={styles.threadList}>
            <div className={styles.threadListTitle}>Hilos</div>
            <ul>
              {threads.map((t, i) => (
                <li key={t.id} className={`${styles.threadRow} ${activeThreadId === t.id ? styles.threadRowActive : ""}`}>
                  <button className={styles.threadRowMain} onClick={() => centerToThread(t)}>
                    <span className={styles.dotMini} style={{ background: colorByStatus(t.status) }} />
                    <span className={styles.threadName}>Hilo #{i + 1}</span>
                    {/* <span className={styles.threadCoords}>
                      ({t.x.toFixed(1)}%, {t.y.toFixed(1)}%)
                    </span> */}
                  </button>
                  <button className={styles.stateBtn} onClick={() => onToggleThreadStatus(t.id, nextStatus(t.status))} title={toggleLabel(t.status)}>
                    {toggleLabel(t.status)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
