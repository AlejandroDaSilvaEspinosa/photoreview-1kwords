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

  // Minimap
  const miniRef = useRef<HTMLDivElement>(null);
  const [miniDims, setMiniDims] = useState({
    mw: 1, // ancho del contenedor minimapa
    mh: 1, // alto del contenedor minimapa
    dW: 1, // ancho renderizado de la imagen (contain)
    dH: 1, // alto renderizado de la imagen (contain)
    offX: 0, // offset x (letterbox)
    offY: 0, // offset y (letterbox)
  });

  // Cerrar con ESC
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

  // Centro en px de imagen (no del DOM)
  const cxPx = (cx / 100) * imgW;
  const cyPx = (cy / 100) * imgH;

  // Translate para centrar (cx,cy) y escalar
  const tx = view.vw / 2 - cxPx * zoom;
  const ty = view.vh / 2 - cyPx * zoom;

  // Tamaño visible en px de imagen (útil para clamp)
  const visWpx = view.vw / zoom;
  const visHpx = view.vh / zoom;

  // Centrar en coordenadas px de imagen — con clamp compatible si la imagen es más pequeña que el viewport
  const setCenterToPx = useCallback(
    (nx: number, ny: number) => {
      // Si el viewport “cabe” más que la imagen, la mitad efectiva se reduce a imgW/2 o imgH/2
      const halfW = Math.min(visWpx / 2, imgW / 2);
      const halfH = Math.min(visHpx / 2, imgH / 2);
      const clampedX = clamp(nx, halfW, imgW - halfW);
      const clampedY = clamp(ny, halfH, imgH - halfH);
      setCx((clampedX / imgW) * 100);
      setCy((clampedY / imgH) * 100);
    },
    [imgW, imgH, visWpx, visHpx]
  );

  // Porcentaje visible (para viewport del minimapa)
  const viewW = 100 / zoom;
  const viewH = 100 / zoom;

  // Clamp en % (se usa para click al minimapa)
  const setCenterClamped = useCallback(
    (nxPct: number, nyPct: number) => {
      const halfW = viewW / 2;
      const halfH = viewH / 2;
      setCx(clamp(nxPct, halfW, 100 - halfW));
      setCy(clamp(nyPct, halfH, 100 - halfH));
    },
    [viewW, viewH]
  );

  // Zoom con rueda anclando al cursor (cursor → coords imagen)
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

  // Medir minimapa y calcular letterboxing (contain)
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
  }, [measureMini]);

  useEffect(() => {
    const ro = new ResizeObserver(() => measureMini());
    if (miniRef.current) ro.observe(miniRef.current);
    return () => ro.disconnect();
  }, [measureMini]);

  // Minimap: click / drag (coordenadas dentro de la imagen renderizada, no del contenedor)
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

  // Estilo del viewport en el minimapa (en px para respetar letterboxing)
  const vpStyle = useMemo(() => {
    const vpWpx = miniDims.dW * (viewW / 100);
    const vpHpx = miniDims.dH * (viewH / 100);
    const left =
      miniDims.offX + miniDims.dW * ((cx - viewW / 2) / 100);
    const top =
      miniDims.offY + miniDims.dH * ((cy - viewH / 2) / 100);
    return {
      width: `${vpWpx}px`,
      height: `${vpHpx}px`,
      left: `${left}px`,
      top: `${top}px`,
    };
  }, [miniDims, viewW, viewH, cx, cy]);

  // Dots (puestos en el "stage" con % → no hace falta recalcular por zoom/pan)
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

  // Ir a un hilo desde la lista (centra en px de imagen)
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
          {/* Imagen Next (cacheable) */}
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
                const w = el.naturalWidth || 1;
                const h = el.naturalHeight || 1;
                setImgW(w);
                setImgH(h);
                // re-medimos minimapa con las nuevas dimensiones
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

      {/* Sidebar con MINIMAPA (Next/Image) + controles + lista de hilos */}
      <div className={css.sidebar}>
        <div
          className={css.minimap}
          ref={miniRef}
          onMouseDown={onMiniClickOrDrag}
          onMouseMove={(e) => e.buttons === 1 && onMiniClickOrDrag(e)}
        >
          {/* Imagen del minimapa con Next/Image (contain) */}
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

          {/* Viewport (en píxeles para respetar letterboxing) */}
          <div className={css.viewport} style={vpStyle} />

          {/* opcional: velo sutil encima del minimapa */}
          <div className={css.veil} />
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