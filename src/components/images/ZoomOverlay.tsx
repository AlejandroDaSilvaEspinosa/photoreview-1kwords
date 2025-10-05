// ==============================
// File: src/components/images/ZoomOverlay.tsx
// ==============================
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import styles from "./ZoomOverlay.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThreadsPanel from "@/components/ThreadsPanel";
import type { Thread, ThreadStatus } from "@/types/review";
import { colorByThreadStatus } from "@/lib/ui/status";
import { pointKey } from "@/lib/common/coords";

import CloseIcon from "@/icons/close.svg";
import EyeOffIncon from "@/icons/eye-off.svg";
import PinIcon from "@/icons/pin.svg";
import HandIcon from "@/icons/hand.svg";
import FitToScreenIcon from "@/icons/fit-screen.svg";
import PlusIcon from "@/icons/plus.svg";
import MinusIcon from "@/icons/minus.svg";
import ChatIcon from "@/icons/chat.svg";

import SidePanel from "./SidePanelZoomOverlay";
import MinimapFloat from "./MinimapFloat";
import { useDotNumbers } from "@/contexts/DotNumbersProvider";

type Props = {
  src: string;
  imageName?: string;
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

  validationLock?: boolean;
  pendingStatusIds?: Set<number>;

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

export default function ZoomOverlay({
  src,
  imageName,
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
  validationLock,
  pendingStatusIds,
}: Props) {
  const imageKey = imageName || "__overlay__";

  // Provider de numeración compartida
  const dot = useDotNumbers();

  // Sólo hilos visibles
  const threadsForRender = useMemo(
    () => threads.filter((t) => t.status !== "deleted"),
    [threads]
  );

  // 🔄 Sincroniza numeración para esta imagen
  useEffect(() => {
    dot?.sync?.(imageKey, threadsForRender as any);
  }, [dot, imageKey, threadsForRender]);

  // responsive
  const [isNarrow, setIsNarrow] = useState(false);
  const [showChat, setShowChat] = useState(false);
  useEffect(() => {
    const update = () => setIsNarrow(window.innerWidth <= 1050);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // main image dims
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  const [imgReady, setImgReady] = useState(false);

  // camera
  const [cx, setCx] = useState(initial?.xPct ?? 50);
  const [cy, setCy] = useState(initial?.yPct ?? 50);
  const [zoom, setZoom] = useState(initial?.zoom ?? 1);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [tool, setTool] = useState<ToolMode>("pan");

  // refs/containers
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // prevent body scroll
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // viewport px
  const view = (() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { vw: rect?.width ?? 1, vh: rect?.height ?? 1 };
  })();

  // helpers zoom
  const getFitZoom = useCallback(() => {
    if (!imgW || !imgH || !view.vw || !view.vh) return 1;
    return Math.min(view.vw / imgW, view.vh / imgH);
  }, [imgW, imgH, view.vw, view.vh]);

  const getMinZoom = getFitZoom;

  const getPanEnabledZoom = useCallback(() => {
    if (!imgW || !imgH || !view.vw || !view.vh) return 1;
    const rw = view.vw / imgW;
    const rh = view.vh / imgH;
    return Math.max(rw, rh) * 1.06;
  }, [imgW, imgH, view.vw, view.vh]);

  // transforms
  const cxPx = (cx / 100) * imgW;
  const cyPx = (cy / 100) * imgH;
  const tx = view.vw / 2 - cxPx * zoom;
  const ty = view.vh / 2 - cyPx * zoom;

  const viewWPercent = (view.vw / (imgW * zoom)) * 100;
  const viewHPercent = (view.vh / (imgH * zoom)) * 100;

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

  // init camera
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

  /** Wheel (desktop) */
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

  /** Pointer state (pan/pinch) */
  type PState =
    | { mode: "none" }
    | {
        mode: "pan";
        pointerId: number;
        startX: number;
        startY: number;
        startCxPx: number;
        startCyPx: number;
      }
    | {
        mode: "pinch";
        p0: { id: number; x: number; y: number };
        p1: { id: number; x: number; y: number };
        startZoom: number;
        startDist: number;
        imgX0: number;
        imgY0: number;
      };
  const pState = useRef<PState>({ mode: "none" });
  const movedRef = useRef(false);
  const lastTapRef = useRef(0);

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect || !imgW || !imgH) return;
      movedRef.current = false;

      if (pState.current.mode === "none") {
        pState.current = {
          mode: "pan",
          pointerId: e.pointerId,
          startX: e.clientX - rect.left,
          startY: e.clientY - rect.top,
          startCxPx: (cx / 100) * imgW,
          startCyPx: (cy / 100) * imgH,
        };
        return;
      }

      if (pState.current.mode === "pan") {
        const p0 = {
          id: pState.current.pointerId,
          x: pState.current.startX,
          y: pState.current.startY,
        };
        const p1 = {
          id: e.pointerId,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
        const m = mid(p0, p1);
        const d = dist(p0, p1) || 1;
        const imgX0 = (m.x - tx) / zoom;
        const imgY0 = (m.y - ty) / zoom;
        pState.current = {
          mode: "pinch",
          p0,
          p1,
          startZoom: zoom,
          startDist: d,
          imgX0,
          imgY0,
        };
      }
    },
    [imgW, imgH, cx, cy, tx, ty, zoom]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect || !imgW || !imgH) return;

      if (
        pState.current.mode === "pan" &&
        e.pointerId === pState.current.pointerId
      ) {
        movedRef.current = true;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = (x - pState.current.startX) / zoom;
        const dy = (y - pState.current.startY) / zoom;
        const cxPxNew = pState.current.startCxPx - dx;
        const cyPxNew = pState.current.startCyPx - dy;
        const { cx: cxPct, cy: cyPct } = clampCenterPxFor(
          cxPxNew,
          cyPxNew,
          zoom
        );
        setCx(cxPct);
        setCy(cyPct);
        return;
      }

      if (pState.current.mode === "pinch") {
        movedRef.current = true;
        if (e.pointerId === pState.current.p0.id) {
          pState.current.p0 = {
            ...pState.current.p0,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          };
        } else if (e.pointerId === pState.current.p1.id) {
          pState.current.p1 = {
            ...pState.current.p1,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          };
        } else return;

        const dNow = dist(pState.current.p0, pState.current.p1);
        const factor = dNow / (pState.current.startDist || dNow);
        const minZ = getMinZoom();
        const maxZ = 10;
        const nextZ = clamp(pState.current.startZoom * factor, minZ, maxZ);
        const m = mid(pState.current.p0, pState.current.p1);
        const cxPxNext =
          view.vw / (2 * nextZ) + pState.current.imgX0 - m.x / nextZ;
        const cyPxNext =
          view.vh / (2 * nextZ) + pState.current.imgY0 - m.y / nextZ;
        const { cx: cxPct, cy: cyPct } = clampCenterPxFor(
          cxPxNext,
          cyPxNext,
          nextZ
        );
        setZoom(nextZ);
        setCx(cxPct);
        setCy(cyPct);
      }
    },
    [imgW, imgH, view.vw, view.vh, getMinZoom, clampCenterPxFor, zoom]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (
        pState.current.mode === "pan" &&
        e.pointerId === pState.current.pointerId
      ) {
        // double-tap zoom
        const now = performance.now();
        const dt = now - lastTapRef.current;
        if (dt < 300 && !movedRef.current) {
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
            const nextZ = clamp(
              Math.max(zoom * 2, fit * 2.4),
              getMinZoom(),
              10
            );
            const cxPxNext =
              view.vw / (2 * nextZ) + (cxPx - view.vw / 2) / zoom;
            const cyPxNext =
              view.vh / (2 * nextZ) + (cyPx - view.vh / 2) / zoom;
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
        lastTapRef.current = now;
        pState.current = { mode: "none" };
      } else if (pState.current.mode === "pinch") {
        pState.current = { mode: "none" };
      }
    },
    [
      getFitZoom,
      getPanEnabledZoom,
      getMinZoom,
      clampCenterPxFor,
      zoom,
      cx,
      cy,
      cxPx,
      cyPx,
      view.vw,
      view.vh,
      imgW,
      imgH,
    ]
  );

  const onPointerCancel = useCallback(() => {
    pState.current = { mode: "none" };
  }, []);

  /** Crear hilo (click si no hubo pan/pinch) */
  const onClickMain = useCallback(
    (e: React.MouseEvent) => {
      const wantsPin = tool === "pin" || e.shiftKey;
      if (!wantsPin) return;
      if (movedRef.current) return;
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const xImgPx = (e.clientX - rect.left - tx) / zoom;
      const yImgPx = (e.clientY - rect.top - ty) / zoom;
      const xPct = clamp((xImgPx / imgW) * 100, 0, 100);
      const yPct = clamp((yImgPx / imgH) * 100, 0, 100);
      setHideThreads(true);
      onCreateThreadAt(xPct, yPct);
      if (isNarrow) setShowChat(true);
    },
    [tool, tx, ty, zoom, imgW, imgH, setHideThreads, onCreateThreadAt, isNarrow]
  );

  // ====== Dots (numeración estable del provider) ======
  const dots = useMemo(
    () =>
      threadsForRender.map((t, i) => ({
        id: t.id,
        left: `${t.x}%`,
        top: `${t.y}%`,
        status: t.status,
        num: dot?.getNumberFor(imageKey, t.x, t.y) ?? i + 1,
      })),
    [threadsForRender, imageKey, dot?.version] // version: re-render cuando cambien asignaciones
  );

  const centerToThread = (t: Thread) => {
    const px = (t.x / 100) * imgW;
    const py = (t.y / 100) * imgH;
    const visWpx = view.vw / zoom;
    const visHpx = view.vh / zoom;
    const halfW = Math.min(visWpx / 2, imgW / 2);
    const halfH = Math.min(visHpx / 2, imgH / 2);
    const nx = clamp(px, halfW, imgW - halfW);
    const ny = clamp(py, halfH, imgH - halfH);
    setCx((nx / imgW) * 100);
    setCy((ny / imgH) * 100);
    onFocusThread(t.id);
    if (isNarrow) setShowChat(true);
  };

  const cursor =
    tool === "pin"
      ? "crosshair"
      : pState.current.mode === "pan"
      ? "grabbing"
      : "grab";
  const miniAspect = useMemo(
    () => (imgW && imgH ? `${imgW} / ${imgH}` : undefined),
    [imgW, imgH]
  );

  // Hilo activo → número desde provider
  const activeNum = useMemo(() => {
    const t = threads.find((x) => x.id === activeThreadId);
    return t ? dot?.getNumberFor(imageKey, t.x, t.y) ?? 0 : 0;
  }, [threads, activeThreadId, imageKey, dot?.version]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-label="Zoom"
      ref={overlayRef}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {/* cerrar en pointerUp */}
      <button
        className={styles.close}
        onPointerUp={onClose}
        aria-label="Cerrar"
        title="Cerrar"
      >
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
          aria-pressed={!!hideThreads}
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
          onClick={() => {
            const z = getFitZoom();
            setZoom(z);
            setCx(50);
            setCy(50);
          }}
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onClickMain}
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
              }}
              onLoadingComplete={(img: HTMLImageElement) => {
                if (!imgW || !imgH) {
                  setImgW(img.naturalWidth || 1);
                  setImgH(img.naturalHeight || 1);
                  setImgReady(true);
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
                  background: colorByThreadStatus(
                    threads.find((t) => t.id === d.id)?.status || "pending"
                  ),
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

        {/* Minimap flotante (≤1050px) totalmente encapsulado */}
        {isNarrow && (
          <MinimapFloat
            containerRef={wrapRef}
            src={src}
            imgW={imgW}
            imgH={imgH}
            cx={cx}
            cy={cy}
            zoom={zoom}
            viewportPx={{ vw: view.vw, vh: view.vh }}
            onMoveViewport={(xPct, yPct) => {
              setCx(xPct);
              setCy(yPct);
            }}
            miniAspect={miniAspect}
          />
        )}
      </div>

      {/* Sidebar (>1050px) encapsulada */}
      {!isNarrow && (
        <SidePanel
          src={src}
          miniAspect={miniAspect}
          imgW={imgW}
          imgH={imgH}
          cx={cx}
          cy={cy}
          zoom={zoom}
          viewportPx={{ vw: view.vw, vh: view.vh }}
          onMoveViewport={(xPct, yPct) => {
            setCx(xPct);
            setCy(yPct);
          }}
          threads={threads}
          activeThreadId={activeThreadId}
          validationLock={!!validationLock}
          pendingStatusIds={pendingStatusIds}
          onAddThreadMessage={onAddThreadMessage}
          onFocusThread={onFocusThread}
          centerToThread={centerToThread}
          onToggleThreadStatus={onToggleThreadStatus}
          onDeleteThread={onDeleteThread}
        />
      )}

      {/* FAB chat — ≤1050px */}
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

      {/* Drawer chat — ≤1050px */}
      {isNarrow && showChat && (
        <div className={styles.chatDrawer} role="dialog" aria-label="Chat">
          <div className={styles.chatDrawerHeader}>
            <div className={styles.chatDrawerTitle}>
              {threads.find((t) => t.id === activeThreadId)
                ? `Hilo #${activeNum}`
                : "Hilos"}
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
            <ThreadsPanel
              threads={threads}
              activeThreadId={activeThreadId}
              validationLock={!!validationLock}
              pendingStatusIds={pendingStatusIds}
              composeLocked={false}
              statusLockedForActive={
                !!(
                  pendingStatusIds &&
                  activeThreadId &&
                  pendingStatusIds.has(activeThreadId)
                )
              }
              onAddThreadMessage={onAddThreadMessage}
              onFocusThread={(id) => {
                onFocusThread(id);
                if (id != null) setShowChat(true);
              }}
              centerToThread={centerToThread}
              onToggleThreadStatus={onToggleThreadStatus}
              onDeleteThread={onDeleteThread}
              emptyTitle="Aún no hay hilos"
              emptySubtitle="Crea un hilo tocando la imagen para empezar."
            />
          </div>
        </div>
      )}

      {/* Hint */}
      <div className={styles.shortcutHint} aria-hidden>
        <HandIcon /> mover · <b>Pin</b> anotar · <b>T</b> hilos on/off ·
        rueda/gestos para zoom · doble-tap (móvil) · <b>Esc</b> cerrar
      </div>
    </div>
  );
}
