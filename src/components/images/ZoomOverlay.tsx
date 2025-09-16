"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import css from "./ZoomOverlay.module.css";

export type ZoomThread = {
  id: number;
  x: number; // porcentaje 0..100 (coords de la imagen)
  y: number; // porcentaje 0..100
  status: "pending" | "corrected" | "reopened" | "deleted";
  messages: Array<{
    id: number;
    text: string;
    createdAt: string;
    createdByName?: string | null;
    isSystem?: boolean;
  }>;
};

type Props = {
  src: string;
  threads: ZoomThread[];
  activeThreadId: number | null;
  onFocusThread: (id: number) => void;
  onAddMessage: (threadId: number, text: string) => void;
  onToggleThreadStatus: (threadId: number, next: ZoomThread["status"]) => void;
  onClose: () => void;
  initial?: { xPct: number; yPct: number; zoom?: number };
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const colorByStatus = (s: ZoomThread["status"]) =>
  s === "corrected" ? "#0FA958" : s === "reopened" ? "#FFB000" : s === "deleted" ? "#666" : "#FF0040";

const toggleLabel = (s: ZoomThread["status"]) => (s === "corrected" ? "Reabrir" : "Corregido");
const nextStatus = (s: ZoomThread["status"]): ZoomThread["status"] =>
  s === "corrected" ? "reopened" : "corrected";

export default function ZoomOverlay({
  src,
  threads,
  activeThreadId,
  onFocusThread,
  onAddMessage,
  onToggleThreadStatus,
  onClose,
  initial,
}: Props) {
  // Tamaño real de la imagen (px)
  const [imgW, setImgW] = useState(1);
  const [imgH, setImgH] = useState(1);

  // Centro (en %) y zoom
  const [cx, setCx] = useState(initial?.xPct ?? 50);
  const [cy, setCy] = useState(initial?.yPct ?? 50);
  const [zoom, setZoom] = useState(initial?.zoom ?? 3);

  const [draft, setDraft] = useState("");

  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; cxPx: number; cyPx: number } | null>(null);

  // Minimap (medidas con letterboxing)
  const miniRef = useRef<HTMLDivElement>(null);
  const [miniDims, setMiniDims] = useState({
    mw: 1, mh: 1, dW: 1, dH: 1, offX: 0, offY: 0,
  });

  // Re-render en resize
  const [, force] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => force((n) => n + 1));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Esc para cerrar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Tamaño del viewport principal
  const view = (() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { vw: rect?.width ?? 1, vh: rect?.height ?? 1 };
  })();

  // minZoom = ver toda la imagen
  const getMinZoom = useCallback(() => {
    if (!imgW || !imgH) return 1;
    return Math.min(view.vw / imgW, view.vh / imgH);
  }, [imgW, imgH, view.vw, view.vh]);

  // Centro actual en px de imagen
  const cxPx = (cx / 100) * imgW;
  const cyPx = (cy / 100) * imgH;

  // Transform para centrar + escalar
  const tx = view.vw / 2 - cxPx * zoom;
  const ty = view.vh / 2 - cyPx * zoom;

  // Tamaño visible en px de imagen
  const visWpx = view.vw / zoom;
  const visHpx = view.vh / zoom;

  // Centrar a (nx,ny) px de imagen, con clamp robusto si viewport > imagen
  const setCenterToPx = useCallback(
    (nx: number, ny: number) => {
      const halfW = Math.min(visWpx / 2, imgW / 2);
      const halfH = Math.min(visHpx / 2, imgH / 2);
      const clampedX = clamp(nx, halfW, imgW - halfW);
      const clampedY = clamp(ny, halfH, imgH - halfH);
      setCx((clampedX / imgW) * 100);
      setCy((clampedY / imgH) * 100);
    },
    [imgW, imgH, visWpx, visHpx]
  );

  // % visible respecto a la imagen (puede ser >100 si viewport es más grande)
  const viewWPercent = (view.vw / (imgW * zoom)) * 100;
  const viewHPercent = (view.vh / (imgH * zoom)) * 100;

  // ✅ FIX: clamp en % robusto cuando el viewport supera el 100%
  const setCenterClamped = useCallback(
    (nxPct: number, nyPct: number) => {
      const effW = Math.min(viewWPercent, 100);
      const effH = Math.min(viewHPercent, 100);
      const halfW = effW / 2;
      const halfH = effH / 2;

      const cxTarget = viewWPercent >= 100 ? 50 : clamp(nxPct, halfW, 100 - halfW);
      const cyTarget = viewHPercent >= 100 ? 50 : clamp(nyPct, halfH, 100 - halfH);

      setCx(cxTarget);
      setCy(cyTarget);
    },
    [viewWPercent, viewHPercent]
  );

  // Zoom con rueda (anclado al cursor)
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;

      const curXpx = (e.clientX - rect.left - tx) / zoom;
      const curYpx = (e.clientY - rect.top - ty) / zoom;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const minZ = getMinZoom();
      const nz = clamp(zoom * factor, minZ, 10);
      setZoom(nz);

      setCenterToPx(curXpx, curYpx);
    },
    [tx, ty, zoom, getMinZoom, setCenterToPx]
  );

  // Pan (arrastrar)
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, cxPx, cyPx };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.x) / zoom;
    const dy = (e.clientY - dragRef.current.y) / zoom;
    setCenterToPx(dragRef.current.cxPx - dx, dragRef.current.cyPx - dy);
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  // Medir minimapa (letterboxing de contain)
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

  // Minimap: click/drag → centra
  const onMiniClickOrDrag = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = miniRef.current?.getBoundingClientRect();
      if (!rect || !miniDims.dW || !miniDims.dH) return;

      const xIn = e.clientX - rect.left - miniDims.offX;
      const yIn = e.clientY - rect.top - miniDims.offY;

      const nx = clamp(xIn / miniDims.dW, 0, 1) * 100;
      const ny = clamp(yIn / miniDims.dH, 0, 1) * 100;

      setCenterClamped(nx, ny);
    },
    [miniDims, setCenterClamped]
  );

  // ✅ FIX: viewport del minimapa clamped a la imagen renderizada
  const vpStyle = useMemo(() => {
    const effW = Math.min(viewWPercent, 100);
    const effH = Math.min(viewHPercent, 100);

    const vpWpx = miniDims.dW * (effW / 100);
    const vpHpx = miniDims.dH * (effH / 100);

    let left = miniDims.offX + ((cx - effW / 2) / 100) * miniDims.dW;
    let top = miniDims.offY + ((cy - effH / 2) / 100) * miniDims.dH;

    // clamp para que no se salga del área de la imagen en el minimapa
    left = clamp(left, miniDims.offX, miniDims.offX + miniDims.dW - vpWpx);
    top = clamp(top, miniDims.offY, miniDims.offY + miniDims.dH - vpHpx);

    return {
      width: `${vpWpx}px`,
      height: `${vpHpx}px`,
      left: `${left}px`,
      top: `${top}px`,
    };
  }, [miniDims, viewWPercent, viewHPercent, cx, cy]);

  // Dots (se transforman junto con la imagen)
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

  // Chat / envío
  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || !activeThread) return;
    onAddMessage(activeThread.id, text);
    setDraft("");
  }, [draft, activeThread, onAddMessage]);

  // Ir a un hilo desde la lista
  const centerToThread = (t: ZoomThread) => {
    const px = (t.x / 100) * imgW;
    const py = (t.y / 100) * imgH;
    setCenterToPx(px, py);
    onFocusThread(t.id);
  };

  return (
    <div className={css.overlay} role="dialog" aria-label="Zoom">
      <button className={css.close} onClick={onClose} aria-label="Cerrar">×</button>

      {/* Viewport principal con stage */}
      <div
        className={css.mainWrap}
        ref={wrapRef}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <div
          className={css.stage}
          style={{
            width: imgW || 1,
            height: imgH || 1,
            transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
          }}
        >
          {/* Imagen principal (Next/Image) */}
          <div className={css.imgWrap}>
            <Image
              src={src}
              alt=""
              fill
              sizes="100vw"
              priority
              draggable={false}
              className={css.img}
              onLoadingComplete={(el) => {
                const w = el.naturalWidth || 1;
                const h = el.naturalHeight || 1;
                setImgW(w);
                setImgH(h);
                const minZ = Math.min(view.vw / w, view.vh / h);
                setZoom((z) => Math.max(z, minZ)); // asegúrate de no bajar de fit
                setTimeout(() => measureMini(), 0);
              }}
            />
          </div>

          {/* Puntos */}
          {dots.map((d) => (
            <button
              key={d.id}
              className={`${css.dot} ${activeThreadId === d.id ? css.dotActive : ""}`}
              style={{ left: d.left, top: d.top, background: colorByStatus(d.status) }}
              title={`Hilo #${d.num}`}
              onClick={(e) => {
                e.stopPropagation();
                onFocusThread(d.id);
              }}
            >
              <span className={css.dotNum}>{d.num}</span>
            </button>
          ))}
        </div>

        {/* Chat acoplado */}
        {activeThread && (
          <div className={css.chatDock}>
            <div className={css.chatHeader}>
              Hilo #{threads.findIndex((x) => x.id === activeThread.id) + 1}
            </div>
            <div className={css.chatList}>
              {activeThread.messages.map((m) => (
                <div
                  key={m.id}
                  className={`${css.bubble} ${m.isSystem ? css.sys : ""}`}
                  title={m.createdByName || "Usuario"}
                >
                  <div className={css.bubbleText}>{m.text}</div>
                  <div className={css.meta}>{m.createdByName || "Usuario"}</div>
                </div>
              ))}
            </div>
            <div className={css.composer}>
              <textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Escribe un mensaje…"
              />
              <button
                onClick={() => {
                  const minZ = getMinZoom();
                  setZoom((z) => clamp(z, minZ, 10));
                  send();
                }}
              >
                Enviar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar: Minimap (Next/Image) + controles + lista */}
      <div className={css.sidebar}>
        <div
          className={css.minimap}
          ref={miniRef}
          onMouseDown={onMiniClickOrDrag}
          onMouseMove={(e) => e.buttons === 1 && onMiniClickOrDrag(e)}
        >
          <div className={css.miniImgWrap}>
            <Image
              src={src}
              alt=""
              fill
              sizes="320px"
              priority
              draggable={false}
              className={css.miniImg}
              onLoadingComplete={() => measureMini()}
            />
          </div>

          {/* Viewport con el mismo aspect ratio y clamped al área visible */}
          <div className={css.viewport} style={vpStyle} />
          <div className={css.veil} />
        </div>

        <div className={css.controls}>
          <div className={css.row}>
            <button onClick={() => setZoom((z) => clamp(z * 0.9, getMinZoom(), 10))}>−</button>
            <span className={css.zoomLabel}>{zoom.toFixed(2)}×</span>
            <button onClick={() => setZoom((z) => clamp(z * 1.1, getMinZoom(), 10))}>+</button>
          </div>
          <div className={css.hint}>
            Arrastra para mover · Rueda para zoom · Esc para cerrar
          </div>

          <div className={css.threadList}>
            <div className={css.threadListTitle}>Hilos</div>
            <ul>
              {threads.map((t, i) => (
                <li
                  key={t.id}
                  className={`${css.threadRow} ${activeThreadId === t.id ? css.threadRowActive : ""}`}
                >
                  <button className={css.threadRowMain} onClick={() => centerToThread(t)}>
                    <span className={css.dotMini} style={{ background: colorByStatus(t.status) }} />
                    <span className={css.threadName}>#{i + 1}</span>
                    <span className={css.threadCoords}>
                      ({t.x.toFixed(1)}%, {t.y.toFixed(1)}%)
                    </span>
                  </button>
                  <button
                    className={css.stateBtn}
                    onClick={() => onToggleThreadStatus(t.id, nextStatus(t.status))}
                    title={toggleLabel(t.status)}
                  >
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