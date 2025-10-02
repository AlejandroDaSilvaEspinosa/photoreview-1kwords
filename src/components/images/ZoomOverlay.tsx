"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, SetStateAction } from "react";
import styles from "./ZoomOverlay.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThreadChat from "../ThreadChat";
import type { Thread, ThreadStatus } from "@/types/review";
import {
  colorByThreadStatus,
  nextThreadStatus,
  toggleThreadStatusLabel,
} from "@/lib/ui/status";

import CloseIcon from "@/icons/close.svg";
import EyeOffIncon from "@/icons/eye-off.svg";
import PinIcon from "@/icons/pin.svg";
import HandIcon from "@/icons/hand.svg";
import FitToScreenIcon from "@/icons/fit-screen.svg";
import PlusIcon from "@/icons/plus.svg";
import MinusIcon from "@/icons/minus.svg";
import ChatIcon from "@/icons/chat.svg";

type Props = {
  src: string;
  threads: Thread[];
  activeThreadId: number | null;
  initial?: {
    xPct: number;
    yPct: number;
    zoom?: number;
    ax?: number;
    ay?: number;
  };
  currentUsername?: string;
  hideThreads?: boolean;
  setHideThreads: Dispatch<SetStateAction<boolean>>;
  onCreateThreadAt: (xPct: number, yPct: number) => void;
  onFocusThread: (id: number | null) => void;
  onAddThreadMessage: (threadId: number, text: string) => void;
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => void;
  onDeleteThread: (id: number) => void;
  onClose: () => void;
};

type ToolMode = "pan" | "pin";

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);
const mid = (ax: number, ay: number, bx: number, by: number) => ({
  x: (ax + bx) / 2,
  y: (ay + by) / 2,
});

export default function ZoomOverlay({
  src,
  threads,
  activeThreadId,
  onFocusThread,
  onAddThreadMessage,
  onToggleThreadStatus,
  onCreateThreadAt,
  setHideThreads,
  onDeleteThread,
  onClose,
  initial,
  hideThreads,
}: Props) {
  // ===== responsive: ≤1050 => minimapa flotante + chat drawer =====
  const [isNarrow, setIsNarrow] = useState(false);
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    const update = () => setIsNarrow(window.innerWidth <= 1050);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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
  const [isDragging, setIsDragging] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    cxPx: number;
    cyPx: number;
  } | null>(null);
  const movedRef = useRef(false);

  // Doble-tap & pinch control
  const tapRef = useRef<{ t: number; x: number; y: number }>({
    t: 0,
    x: 0,
    y: 0,
  });
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

  // minimapa (ambas vistas)
  const miniRef = useRef<HTMLDivElement>(null);
  const [miniDims, setMiniDims] = useState({
    mw: 1,
    mh: 1,
    dW: 1,
    dH: 1,
    offX: 0,
    offY: 0,
  });

  // ===== minimapa flotante (solo narrow) - posición, drag y colapsado =====
  const floatRef = useRef<HTMLDivElement>(null);
  const [miniPos, setMiniPos] = useState<{ x: number; y: number }>({
    x: 12,
    y: 12,
  });
  const [miniPosInit, setMiniPosInit] = useState(false); // evita re-colocar tras drag
  const [miniCollapsed, setMiniCollapsed] = useState(false);

  const miniDrag = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    dragging: boolean;
  }>({ sx: 0, sy: 0, ox: 12, oy: 12, dragging: false });

  // Colocar inicialmente en esquina INFERIOR IZQUIERDA
  useEffect(() => {
    if (!isNarrow || miniPosInit) return;

    const MARGIN = 12;
    const placeBL = () => {
      const orect = overlayRef.current?.getBoundingClientRect();
      const ow = orect?.width ?? window.innerWidth;
      const oh = orect?.height ?? window.innerHeight;

      const rect = floatRef.current?.getBoundingClientRect();
      const mw = rect && rect.width > 40 ? rect.width : 240;
      const mh = rect && rect.height > 40 ? rect.height : 240; // cuadrado

      const x = clamp(MARGIN, MARGIN, Math.max(MARGIN, ow - mw - MARGIN));
      const y = clamp(
        oh - mh - MARGIN,
        MARGIN,
        Math.max(MARGIN, oh - mh - MARGIN)
      );

      setMiniPos({ x, y });
      miniDrag.current.ox = x;
      miniDrag.current.oy = y;
      setMiniPosInit(true);
    };

    requestAnimationFrame(placeBL);
    const t = setTimeout(placeBL, 300);
    return () => clearTimeout(t);
  }, [isNarrow, miniPosInit]);

  const beginMiniDrag = useCallback(
    (clientX: number, clientY: number) => {
      miniDrag.current.sx = clientX;
      miniDrag.current.sy = clientY;
      miniDrag.current.ox = miniPos.x;
      miniDrag.current.oy = miniPos.y;
      miniDrag.current.dragging = true;
    },
    [miniPos.x, miniPos.y]
  );

  const doMiniDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!miniDrag.current.dragging) return;
      const rect = overlayRef.current?.getBoundingClientRect();
      const ow = rect?.width ?? window.innerWidth;
      const oh = rect?.height ?? window.innerHeight;

      const mw = floatRef.current?.getBoundingClientRect().width ?? 240;
      const mh =
        floatRef.current?.getBoundingClientRect().height ??
        (miniCollapsed ? 28 : 240);

      const dx = clientX - miniDrag.current.sx;
      const dy = clientY - miniDrag.current.sy;

      const nx = clamp(miniDrag.current.ox + dx, 8, Math.max(8, ow - mw - 8));
      const ny = clamp(miniDrag.current.oy + dy, 8, Math.max(8, oh - mh - 8));
      setMiniPos({ x: nx, y: ny });
    },
    [miniCollapsed]
  );

  const endMiniDrag = useCallback(() => {
    miniDrag.current.dragging = false;
  }, []);

  // listeners globales para drag (mouse + touch)
  useEffect(() => {
    const onMove = (e: MouseEvent) => doMiniDrag(e.clientX, e.clientY);
    const onUp = () => endMiniDrag();
    const onTouchMove = (e: TouchEvent) => {
      if (!miniDrag.current.dragging) return;
      const t = e.touches[0];
      if (t) doMiniDrag(t.clientX, t.clientY);
    };
    const onTouchEnd = () => endMiniDrag();

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [doMiniDrag, endMiniDrag]);

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

  const getPanEnabledZoom = useCallback(() => {
    if (!imgW || !imgH || !view.vw || !view.vh) return 1;
    const rw = view.vw / imgW;
    const rh = view.vh / imgH;
    return Math.max(rw, rh) * 1.06;
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

    const { cx, cy } = centerEdgeAware(
      fx,
      fy,
      z0,
      initial?.ax ?? 0.5,
      initial?.ay ?? 0.5
    );

    setZoom(z0);
    setCx(cx);
    setCy(cy);
    setHasInitialized(true);
  }, [
    hasInitialized,
    imgReady,
    view.vw,
    view.vh,
    initial,
    getFitZoom,
    getPanEnabledZoom,
    centerEdgeAware,
  ]);

  useEffect(() => {
    initializeView();
  }, [initializeView]);

  // ====== rueda (desktop) ======
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.stopPropagation();
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
        const xImg = (localX - tx) / zoom;
        const yImg = (localY - ty) / zoom;
        const cxPxNext = view.vw / (2 * nextZ) + xImg - localX / nextZ;
        const cyPxNext = view.vh / (2 * nextZ) + yImg - localY / nextZ;
        const { cx, cy } = clampCenterPxFor(cxPxNext, cyPxNext, nextZ);
        setZoom(nextZ);
        setCx(cx);
        setCy(cy);
      } else {
        const cxPxNow = (cx / 100) * imgW;
        const cyPxNow = (cy / 100) * imgH;
        const { cx: cx2, cy: cy2 } = clampCenterPxFor(cxPxNow, cyPxNow, nextZ);
        setZoom(nextZ);
        setCx(cx2);
        setCy(cy2);
      }
    },
    [
      wrapRef,
      imgW,
      imgH,
      view.vw,
      view.vh,
      tx,
      ty,
      zoom,
      cx,
      cy,
      getMinZoom,
      clampCenterPxFor,
    ]
  );

  // ====== mouse drag (pan) ======
  const visWpx = view.vw / zoom;
  const visHpx = view.vh / zoom;

  const setCenterToPx = useCallback(
    (nx: number, ny: number) => {
      const halfW = Math.min(visWpx / 2, imgW / 2);
      const halfH = Math.min(visHpx / 2, imgH / 2);
      const newCx = (clamp(nx, halfW, imgW - halfW) / imgW) * 100;
      const newCy = (clamp(ny, halfH, imgH - halfH) / imgH) * 100;
      setCx(newCx);
      setCy(newCy);
    },
    [imgW, imgH, visWpx, visHpx]
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (tool !== "pan") return;
    movedRef.current = false;
    setIsDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY, cxPx, cyPx };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (tool !== "pan" || !dragRef.current) return;
    const dx = (e.clientX - dragRef.current.x) / zoom;
    const dy = (e.clientY - dragRef.current.y) / zoom;
    setCenterToPx(dragRef.current.cxPx - dx, dragRef.current.cyPx - dy);
  };
  const endDrag = () => {
    setIsDragging(false);
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
    setHideThreads(true);
    onCreateThreadAt(xPct, yPct);
    if (isNarrow) setShowChat(true);
  };

  // ====== minimapa (medidas) ======
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
  }, [measureMini, view.vw, view.vh, isNarrow, miniCollapsed]);

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
      e.preventDefault();
      e.stopPropagation(); // 🔒 bloquear eventos al visor
      moveViewportToMiniPos(e.clientX, e.clientY);
    },
    [moveViewportToMiniPos]
  );

  const onMiniTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation(); // 🔒 bloquear eventos al visor
      const t = e.touches[0];
      if (!t) return;
      moveViewportToMiniPos(t.clientX, t.clientY);
    },
    [moveViewportToMiniPos]
  );

  const onMiniTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation(); // 🔒 bloquear eventos al visor
      const t = e.touches[0];
      if (!t) return;
      moveViewportToMiniPos(t.clientX, t.clientY);
    },
    [moveViewportToMiniPos]
  );

  const vpStyle = useMemo(() => {
    const effW = Math.min(viewWPercent, 100);
    const effH = Math.min(viewHPercent, 100);
    const vpWpx = miniDims.dW * (effW / 100);
    const vpHpx = miniDims.dH * (effH / 100);
    let left = miniDims.offX + ((cx - effW / 2) / 100) * miniDims.dW;
    let top = miniDims.offY + ((cy - effH / 2) / 100) * miniDims.dH;
    left = clamp(left, miniDims.offX, miniDims.offX + miniDims.dW - vpWpx);
    top = clamp(top, miniDims.offY, miniDims.offY + miniDims.dH - vpHpx);
    return {
      width: `${vpWpx}px`,
      height: `${vpHpx}px`,
      left: `${left}px`,
      top: `${top}px`,
    };
  }, [miniDims, viewWPercent, viewHPercent, cx, cy]);

  // ====== chat ======
  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const threadIndex = useMemo(
    () =>
      activeThreadId
        ? threads.findIndex((t) => t.id === activeThreadId) + 1
        : 0,
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
      e.preventDefault();
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
        const { cx: cxPct, cy: cyPct } = clampCenterPxFor(
          cxPxNew,
          cyPxNew,
          zoom
        );
        setCx(cxPct);
        setCy(cyPct);

        if (
          Math.abs(x - gestureRef.current.startX) > 4 ||
          Math.abs(y - gestureRef.current.startY) > 4
        ) {
          gestureRef.current.moved = true;
        }
      } else if (gestureRef.current.mode === "pinch" && e.touches.length >= 2) {
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
          const nextZ = clamp(
            gestureRef.current.startZoom * factor,
            minZ,
            maxZ
          );

          const mx = (x0 + x1) / 2;
          const my = (y0 + y1) / 2;

          const cxPxNext =
            view.vw / (2 * nextZ) + gestureRef.current.xImg0 - mx / nextZ;
          const cyPxNext =
            view.vh / (2 * nextZ) + gestureRef.current.yImg0 - my / nextZ;
          const { cx: cxPct, cy: cyPct } = clampCenterPxFor(
            cxPxNext,
            cyPxNext,
            nextZ
          );

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
      if (e.touches.length > 0) return;

      const now = performance.now();
      const last = tapRef.current;
      const x = gestureRef.current.tapX;
      const y = gestureRef.current.tapY;
      const isQuick = now - last.t < 300 && dist(x, y, last.x, last.y) < 30;
      const canDoubleTap =
        !gestureRef.current.moved && !gestureRef.current.didPinch;

      if (isQuick && canDoubleTap) {
        const rect = wrapRef.current?.getBoundingClientRect();
        if (rect) {
          const fit = getFitZoom();
          const panZoom = getPanEnabledZoom();
          const threshold = panZoom * 1.5;

          if (zoom >= threshold) {
            const nextZ = panZoom;
            const cxPxNow = (cx / 100) * imgW;
            const cyPxNow = (cy / 100) * imgH;
            const { cx: cx2, cy: cy2 } = clampCenterPxFor(
              cxPxNow,
              cyPxNow,
              nextZ
            );
            setZoom(nextZ);
            setCx(cx2);
            setCy(cy2);
          } else {
            const localX = x;
            const localY = y;
            const xImg = (localX - tx) / zoom;
            const yImg = (localY - ty) / zoom;
            const nextZ = clamp(
              Math.max(zoom * 2, fit * 2.4),
              getMinZoom(),
              10
            );
            const cxPxNext = view.vw / (2 * nextZ) + xImg - localX / nextZ;
            const cyPxNext = view.vh / (2 * nextZ) + yImg - localY / nextZ;
            const { cx: cxPct, cy: cyPct } = clampCenterPxFor(
              cxPxNext,
              cyPxNext,
              nextZ
            );
            setZoom(nextZ);
            setCx(cxPct);
            setCy(cyPct);
          }
        }
      }

      tapRef.current = {
        t: now,
        x: gestureRef.current.tapX,
        y: gestureRef.current.tapY,
      };
      gestureRef.current.mode = "none";
      gestureRef.current.didPinch = false;
      if (pinchRAF.current) {
        cancelAnimationFrame(pinchRAF.current);
        pinchRAF.current = null;
      }
    },
    [
      wrapRef,
      zoom,
      tx,
      ty,
      view.vw,
      view.vh,
      cx,
      cy,
      imgW,
      imgH,
      getFitZoom,
      getPanEnabledZoom,
      getMinZoom,
      clampCenterPxFor,
    ]
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
    if (isNarrow) setShowChat(true);
  };

  const [cursor, setCursor] = useState("");
  useEffect(() => {
    setCursor(
      tool === "pin" ? "crosshair" : dragRef.current ? "grabbing" : "grab"
    );
  }, [isDragging, tool]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-label="Zoom"
      ref={overlayRef}
      style={{ touchAction: "none" }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <button className={styles.close} onClick={onClose} aria-label="Cerrar">
        <CloseIcon />
      </button>

      {/* TOOLBOX */}
      <div className={styles.toolbox} aria-label="Herramientas">
        <button
          type="button"
          className={`${styles.toolBtn} ${
            tool === "pan" ? styles.toolActive : ""
          }`}
          aria-pressed={tool === "pan"}
          title="Mover (arrastrar)"
          onClick={() => setTool("pan")}
        >
          <HandIcon />
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${
            tool === "pin" ? styles.toolActive : ""
          }`}
          aria-pressed={tool === "pin"}
          title="Añadir nuevo hilo"
          onClick={() => setTool("pin")}
        >
          <PinIcon />
        </button>
        <button
          className={`${styles.toolBtn} ${
            !hideThreads ? "" : styles.toolActive
          }`}
          aria-pressed={hideThreads}
          title={`${hideThreads ? "Ocultar" : "Mostrar"} hilos — T`}
          onClick={() => setHideThreads((v) => !v)}
        >
          <EyeOffIncon />
        </button>

        <div className={styles.toolSep} aria-hidden />

        <button
          className={styles.toolBtn}
          onClick={() => setZoom((z) => clamp(z * 0.9, getMinZoom(), 10))}
          title="Zoom −"
          aria-label="Disminuir zoom"
        >
          <MinusIcon />
        </button>
        <button
          className={styles.toolBtn}
          onClick={() => setZoom((z) => clamp(z * 1.1, getMinZoom(), 10))}
          title="Zoom +"
          aria-label="Aumentar zoom"
        >
          <PlusIcon />
        </button>
        <button
          className={styles.toolBtn}
          onClick={fitToView}
          title="Ajustar a la ventana"
          aria-label="Ajustar a la ventana"
        >
          <FitToScreenIcon />
        </button>
      </div>

      {/* Viewport principal */}
      <div
        className={styles.mainWrap}
        ref={wrapRef}
        style={{ touchAction: "none" }}
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
            transform: imgReady
              ? `translate(${tx}px, ${ty}px) scale(${zoom})`
              : "none",
            cursor,
            ["--zoom" as any]: zoom,
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
              onLoadingComplete={(img: HTMLImageElement) => {
                if (!imgW || !imgH) {
                  setImgW(img.naturalWidth || 1);
                  setImgH(img.naturalHeight || 1);
                  setImgReady(true);
                  requestAnimationFrame(() => measureMini());
                }
              }}
            />
          </div>

          {!hideThreads &&
            dots.map((d) => (
              <button
                key={d.id}
                className={`${styles.dot} ${
                  activeThreadId === d.id ? styles.dotActive : ""
                }`}
                style={{
                  left: d.left,
                  top: d.top,
                  background: colorByThreadStatus(d.status),
                }}
                title={`Hilo #${d.num}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusThread(d.id);
                  if (isNarrow) setShowChat(true);
                }}
              >
                <span className={styles.dotNum}>{d.num}</span>
              </button>
            ))}
        </div>

        {/* Minimap flotante (solo ≤1050px) */}
        {isNarrow && (
          <div
            ref={floatRef}
            className={`${styles.miniFloat} ${
              miniCollapsed ? styles.miniFloatCollapsed : ""
            }`}
            style={{ left: miniPos.x, top: miniPos.y }}
            onMouseDown={(e) => e.stopPropagation()} // 🔒 bloquea al visor
            onTouchStart={(e) => e.stopPropagation()} // 🔒 bloquea al visor
          >
            <div
              className={styles.miniDragHandle}
              onMouseDown={(e) => {
                // si clic en el botón, no empezar drag
                const target = e.target as HTMLElement;
                if (target.closest(`.${styles.miniHandleBtn}`)) return;
                e.preventDefault();
                e.stopPropagation();
                beginMiniDrag(e.clientX, e.clientY);
              }}
              onTouchStart={(e) => {
                const t = e.touches[0];
                if (!t) return;
                e.preventDefault();
                e.stopPropagation();
                // si tocamos el botón, no drag
                const target = e.target as HTMLElement;
                if (target.closest(`.${styles.miniHandleBtn}`)) return;
                beginMiniDrag(t.clientX, t.clientY);
              }}
            >
              <span className={styles.miniHandleTitle}>Minimapa</span>
              <button
                className={styles.miniHandleBtn}
                aria-label={
                  miniCollapsed ? "Expandir minimapa" : "Minimizar minimapa"
                }
                title={miniCollapsed ? "Expandir" : "Minimizar"}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setMiniCollapsed((v) => !v);
                  // opcional: al expandir, recalcular medidas
                  requestAnimationFrame(() => measureMini());
                }}
              >
                {miniCollapsed ? "▣" : "▭"}
              </button>
            </div>

            {!miniCollapsed && (
              <div
                className={styles.minimap}
                ref={miniRef}
                style={{ touchAction: "none" }}
                onMouseDown={onMiniClickOrDrag}
                onMouseMove={(e) => {
                  e.stopPropagation();
                  if (e.buttons === 1) onMiniClickOrDrag(e);
                }}
                onTouchStart={onMiniTouchStart}
                onTouchMove={onMiniTouchMove}
                onClick={(e) => e.stopPropagation()}
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
                    onLoadingComplete={() => {
                      measureMini();
                    }}
                  />
                </div>
                <div className={styles.viewport} style={vpStyle} />
                <div className={styles.veil} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sidebar clásica (solo >1050px) */}
      {!isNarrow && (
        <div className={styles.sidebar} style={{ touchAction: "none" }}>
          <div
            className={styles.minimap}
            ref={miniRef}
            style={{ touchAction: "none" }}
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

          <div className={styles.chatPanel}>
            {activeThread ? (
              <ThreadChat
                activeThread={activeThread}
                threadIndex={threadIndex}
                onAddThreadMessage={onAddThreadMessage}
                onFocusThread={onFocusThread}
                onToggleThreadStatus={onToggleThreadStatus}
                onDeleteThread={onDeleteThread}
              />
            ) : (
              <div className={styles.threadList}>
                <div className={styles.threadListTitle}>Hilos</div>
                <ul>
                  {threads.map((t, i) => (
                    <li
                      key={t.id}
                      className={`${styles.threadRow} ${
                        activeThreadId === t.id ? styles.threadRowActive : ""
                      }`}
                    >
                      <button
                        className={styles.threadRowMain}
                        onClick={() => centerToThread(t)}
                      >
                        <span
                          className={styles.dotMini}
                          style={{ background: colorByThreadStatus(t.status) }}
                        />
                        <span className={styles.threadName}>Hilo #{i + 1}</span>
                      </button>
                      <button
                        className={styles.stateBtn}
                        onClick={() =>
                          onToggleThreadStatus(t.id, nextThreadStatus(t.status))
                        }
                        title={toggleThreadStatusLabel(t.status)}
                      >
                        {toggleThreadStatusLabel(t.status)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* FAB (mostrar chat) — ≤1050px */}
      {isNarrow && !showChat && (
        <button
          className={styles.fabChat}
          aria-label="Abrir chat"
          onClick={() => setShowChat(true)}
          title="Abrir chat"
        >
          <ChatIcon />
        </button>
      )}

      {/* Drawer de chat — ≤1050px */}
      {isNarrow && showChat && (
        <div className={styles.chatDrawer} role="dialog" aria-label="Chat">
          <div className={styles.chatDrawerHeader}>
            <div className={styles.chatDrawerTitle}>
              {activeThread ? `Hilo #${threadIndex}` : "Hilos"}
            </div>
            <button
              className={styles.chatDrawerClose}
              onClick={() => setShowChat(false)}
              aria-label="Cerrar chat"
              title="Cerrar chat"
            >
              <CloseIcon />
            </button>
          </div>

          <div className={styles.chatDrawerBody}>
            {activeThread ? (
              <ThreadChat
                activeThread={activeThread}
                threadIndex={threadIndex}
                onAddThreadMessage={onAddThreadMessage}
                onFocusThread={(id) => {
                  onFocusThread(id);
                }}
                onToggleThreadStatus={onToggleThreadStatus}
                onDeleteThread={onDeleteThread}
              />
            ) : (
              <div className={styles.threadList}>
                <div className={styles.threadListTitle}>Hilos</div>
                <ul>
                  {threads.map((t, i) => (
                    <li
                      key={t.id}
                      className={`${styles.threadRow} ${
                        activeThreadId === t.id ? styles.threadRowActive : ""
                      }`}
                    >
                      <button
                        className={styles.threadRowMain}
                        onClick={() => centerToThread(t)}
                      >
                        <span
                          className={styles.dotMini}
                          style={{ background: colorByThreadStatus(t.status) }}
                        />
                        <span className={styles.threadName}>Hilo #{i + 1}</span>
                      </button>
                      <button
                        className={styles.stateBtn}
                        onClick={() =>
                          onToggleThreadStatus(t.id, nextThreadStatus(t.status))
                        }
                        title={toggleThreadStatusLabel(t.status)}
                      >
                        {toggleThreadStatusLabel(t.status)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hint */}
      <div className={styles.shortcutHint} aria-hidden>
        🖐️ mover · <b>Pin</b> anotar · <b>T</b> hilos on/off · rueda/gestos para
        zoom · doble-tap (móvil) · <b>Esc</b> cerrar
      </div>
    </div>
  );
}
