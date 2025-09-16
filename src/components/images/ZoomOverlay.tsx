"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import css from "./ZoomOverlay.module.css";

export type ZoomThread = {
  id: number;
  x: number; // %
  y: number; // %
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
  initial?: { xPct: number; yPct: number; zoom?: number }; // 0..100
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
    // dimensiones reales de la imagen
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  // centro en % de la imagen (0..100)
  const [cx, setCx] = useState(initial?.xPct ?? 50);
  const [cy, setCy] = useState(initial?.yPct ?? 50);
  const [zoom, setZoom] = useState(initial?.zoom ?? 3); // 1..10
  const [draft, setDraft] = useState("");

  const mainRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ active: boolean; startX: number; startY: number; startCx: number; startCy: number } | null>(null);

  // cerrar con ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

   const view = (() => {
    const rect = mainRef.current?.getBoundingClientRect();
    return { vw: rect?.width ?? 1, vh: rect?.height ?? 1 };
  })();
    // tamaño del viewport respecto a la imagen (en px y %)
  const visWpx = view.vw / zoom;
  const visHpx = view.vh / zoom;
  
  const setCenterToPx = useCallback(
    (nx: number, ny: number) => {
      // clamp para no sacar el viewport
      const halfW = visWpx / 2;
      const halfH = visHpx / 2;
      const clampedX = clamp(nx, halfW, imgW - halfW);
      const clampedY = clamp(ny, halfH, imgH - halfH);
      setCx((clampedX / imgW) * 100);
      setCy((clampedY / imgH) * 100);
    },
    [imgW, imgH, visWpx, visHpx]
  );

    useEffect(() => {
    const im = new Image();
    im.onload = () => {
      setImgW(im.naturalWidth);
      setImgH(im.naturalHeight);
    };
    im.src = src;
  }, [src]);

    // ir a un hilo concreto
  const centerToThread = (t: ZoomThread) => {
    const px = (t.x / 100) * imgW;
    const py = (t.y / 100) * imgH;
    setCenterToPx(px, py);
    onFocusThread(t.id);
  };


  // tamaño del viewport relativo (en %) según el zoom
  const viewW = 100 / zoom; // ancho visible (% de la imagen)
  const viewH = 100 / zoom;

  // clamp del centro para que el viewport no se salga
  const setCenterClamped = useCallback(
    (nx: number, ny: number) => {
      const halfW = viewW / 2;
      const halfH = viewH / 2;
      setCx(clamp(nx, halfW, 100 - halfW));
      setCy(clamp(ny, halfH, 100 - halfH));
    },
    [viewW, viewH]
  );

  // zoom con rueda (centrado en el cursor)
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = mainRef.current?.getBoundingClientRect();
      const px = rect ? ((e.clientX - rect.left) / rect.width) * 100 : 50;
      const py = rect ? ((e.clientY - rect.top) / rect.height) * 100 : 50;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const nz = clamp(zoom * factor, 1, 10);
      setZoom(nz);
      setCenterClamped(px, py);
    },
    [zoom, setCenterClamped]
  );

  // pan (arrastrar)
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = mainRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragging.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        startCx: cx,
        startCy: cy,
      };
    },
    [cx, cy]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging.current?.active || !mainRef.current) return;
      const rect = mainRef.current.getBoundingClientRect();
      const dxPx = e.clientX - dragging.current.startX;
      const dyPx = e.clientY - dragging.current.startY;
      const nx = dragging.current.startCx - (dxPx / rect.width) * viewW;
      const ny = dragging.current.startCy - (dyPx / rect.height) * viewH;
      setCenterClamped(nx, ny);
    },
    [setCenterClamped, viewW, viewH]
  );

  const endDrag = useCallback(() => {
    if (dragging.current) dragging.current.active = false;
  }, []);

  // click en minimapa
  const onMiniClickOrDrag = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      setCenterClamped(px, py);
    },
    [setCenterClamped]
  );

  // estilos del viewport para el minimapa
  const vpStyle = useMemo(
    () => ({
      width: `${viewW}%`,
      height: `${viewH}%`,
      left: `${cx - viewW / 2}%`,
      top: `${cy - viewH / 2}%`,
    }),
    [cx, cy, viewW, viewH]
  );

  // Coordenadas de anotaciones dentro del viewport actual
  const dots = useMemo(() => {
    const left = cx - viewW / 2;
    const top = cy - viewH / 2;
    return threads
      .map((t) => {
        const relX = (t.x - left) / viewW; // 0..1
        const relY = (t.y - top) / viewH;  // 0..1
        return { t, relX, relY };
      })
      .filter(({ relX, relY }) => relX >= 0 && relX <= 1 && relY >= 0 && relY <= 1);
  }, [threads, cx, cy, viewW, viewH]);

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

  return (
    <div className={css.overlay} role="dialog" aria-label="Zoom">
      <button className={css.close} onClick={onClose} aria-label="Cerrar">×</button>

      {/* Panel principal (imagen + dots + chat dock) */}
      <div className={css.mainWrap}>
        <div
          ref={mainRef}
          className={css.main}
          style={{
            backgroundImage: `url(${src})`,
            backgroundSize: `${zoom * 100}% auto`,
            backgroundPosition: `${cx}% ${cy}%`,
          }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          {/* Dots sobre la imagen */}
          {dots.map(({ t, relX, relY }, idx) => (
            <button
              key={t.id}
              className={`${css.dot} ${activeThreadId === t.id ? css.dotActive : ""}`}
              style={{
                left: `${relX * 100}%`,
                top: `${relY * 100}%`,
                background: colorByStatus(t.status),
              }}
              title={`#${idx + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                onFocusThread(t.id);
              }}
            >
              {/* opcional número */}
              <span className={css.dotNum}>{idx + 1}</span>
            </button>
          ))}

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
                <button onClick={send}>Enviar</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar (minimapa + controles) */}
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
          <div className={css.hint}>
            Arrastra para mover · Rueda para zoom · Esc para cerrar
          </div>

        <div className={css.threadList}>
        <div className={css.threadListTitle}>Hilos</div>
        <ul>
            {threads.map((t, i) => (
            <li key={t.id} className={`${css.threadRow} ${activeThreadId === t.id ? css.threadRowActive : ""}`}>
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
