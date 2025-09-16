"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import css from "./ZoomOverlay.module.css";

export type ZoomThread = {
  id: number;
  x: number; // porcentaje 0..100 relativo a la imagen
  y: number; // porcentaje 0..100 relativo a la imagen
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

const toggleLabel = (s: ZoomThread["status"]) => (s === "corrected" ? "Reabrir" : "Marcar corregido");
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
  // Tamaño real de la imagen
  const [imgW, setImgW] = useState(1);
  const [imgH, setImgH] = useState(1);

  // Centro (en %) y zoom
  const [cx, setCx] = useState(initial?.xPct ?? 50);
  const [cy, setCy] = useState(initial?.yPct ?? 50);
  const [zoom, setZoom] = useState(initial?.zoom ?? 3);

  const [draft, setDraft] = useState("");

  // Viewport principal
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; cxPx: number; cyPx: number } | null>(null);

  // Cerrar con ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const view = (() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { vw: rect?.width ?? 1, vh: rect?.height ?? 1 };
  })();

  // Centro en px de imagen
  const cxPx = (cx / 100) * imgW;
  const cyPx = (cy / 100) * imgH;

  // Transform del stage para centrar (cx,cy) en el viewport
  const tx = view.vw / 2 - cxPx * zoom;
  const ty = view.vh / 2 - cyPx * zoom;

  // Tamaño visible en px (útil para clamp)
  const visWpx = view.vw / zoom;
  const visHpx = view.vh / zoom;

  // Centrar en coordenadas px de imagen
  const setCenterToPx = useCallback(
    (nx: number, ny: number) => {
      const halfW = visWpx / 2;
      const halfH = visHpx / 2;
      const clampedX = clamp(nx, halfW, imgW - halfW);
      const clampedY = clamp(ny, halfH, imgH - halfH);
      setCx((clampedX / imgW) * 100);
      setCy((clampedY / imgH) * 100);
    },
    [imgW, imgH, visWpx, visHpx]
  );

  // Porcentaje visible (para minimapa)
  const viewW = 100 / zoom;
  const viewH = 100 / zoom;

  // Clamp en %
  const setCenterClamped = useCallback(
    (nxPct: number, nyPct: number) => {
      const halfW = viewW / 2;
      const halfH = viewH / 2;
      setCx(clamp(nxPct, halfW, 100 - halfW));
      setCy(clamp(nyPct, halfH, 100 - halfH));
    },
    [viewW, viewH]
  );

  // Zoom con rueda anclando al cursor (en coords de imagen)
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const curXpx = (e.clientX - rect.left - tx) / zoom;
      const curYpx = (e.clientY - rect.top - ty) / zoom;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const nz = clamp(zoom * factor, 1, 10);
      setZoom(nz);
      setCenterToPx(curXpx, curYpx);
    },
    [tx, ty, zoom, setCenterToPx]
  );

  // Pan (arrastrar)
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, cxPx, cyPx };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.x) / zoom; // en px de imagen
    const dy = (e.clientY - dragRef.current.y) / zoom;
    setCenterToPx(dragRef.current.cxPx - dx, dragRef.current.cyPx - dy);
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  // Minimap: click/drag para centrar (en %)
  const onMiniClickOrDrag = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      setCenterClamped(px, py);
    },
    [setCenterClamped]
  );

  // Estilo del viewport en el minimapa
  const vpStyle = useMemo(
    () => ({
      width: `${viewW}%`,
      height: `${viewH}%`,
      left: `${cx - viewW / 2}%`,
      top: `${cy - viewH / 2}%`,
    }),
    [cx, cy, viewW, viewH]
  );

  // Dots (dentro del stage → no hace falta recalcular con zoom/pan)
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

  // Thread activo + envío
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
          {/* Imagen Next (cacheable por Next) */}
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
                // naturalWidth/Height fiables para coord % exactas
                setImgW(el.naturalWidth || 1);
                setImgH(el.naturalHeight || 1);
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

        {/* Chat acoplado (no escala) */}
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
              <button onClick={send}>Enviar</button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar con MINIMAPA + controles + lista de hilos */}
      <div className={css.sidebar}>
        <div
          className={css.minimap}
          style={{ backgroundImage: `url(${src})` }}
          onMouseDown={onMiniClickOrDrag}
          onMouseMove={(e) => e.buttons === 1 && onMiniClickOrDrag(e)}
        >
          <div className={css.veil} />
          <div className={css.viewport} style={vpStyle} />
        </div>

        <div className={css.controls}>
          <div className={css.row}>
            <button onClick={() => setZoom((z) => clamp(z * 0.9, 1, 10))}>−</button>
            <span className={css.zoomLabel}>{zoom.toFixed(2)}×</span>
            <button onClick={() => setZoom((z) => clamp(z * 1.1, 1, 10))}>+</button>
          </div>
          <div className={css.hint}>Arrastra para mover · Rueda para zoom · Esc para cerrar</div>

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
