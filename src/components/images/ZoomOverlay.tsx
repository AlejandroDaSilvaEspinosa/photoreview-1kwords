"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import css from "./ZoomOverlay.module.css";

export type ZoomThread = {
  id: number;
  x: number; // porcentaje 0..100
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
  onCreateThreadAt: (xPct: number, yPct: number) => void; // <—— NUEVO USO
  onClose: () => void;
  initial?: { xPct: number; yPct: number; zoom?: number };
};

type ToolMode = "pan" | "pin";

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
  onCreateThreadAt,
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

  // Herramienta activa
  const [tool, setTool] = useState<ToolMode>("pan");

  // chat
  const [draft, setDraft] = useState("");

  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; cxPx: number; cyPx: number } | null>(null);
  const movedRef = useRef(false);

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

  // tamaño del viewport principal
  const view = (() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { vw: rect?.width ?? 1, vh: rect?.height ?? 1 };
  })();

  // min zoom = ver toda la imagen
  const getMinZoom = useCallback(() => {
    if (!imgW || !imgH) return 1;
    return Math.min(view.vw / imgW, view.vh / imgH);
  }, [imgW, imgH, view.vw, view.vh]);

  // centro actual en px de imagen
  const cxPx = (cx / 100) * imgW;
  const cyPx = (cy / 100) * imgH;

  // transform para centrar + escalar
  const tx = view.vw / 2 - cxPx * zoom;
  const ty = view.vh / 2 - cyPx * zoom;

  // tamaño visible (px) de imagen
  const visWpx = view.vw / zoom;
  const visHpx = view.vh / zoom;

  const setCenterToPx = useCallback(
    (nx: number, ny: number) => {
      const halfW = Math.min(visWpx / 2, imgW / 2);
      const halfH = Math.min(visHpx / 2, imgH / 2);
      setCx(((clamp(nx, halfW, imgW - halfW)) / imgW) * 100);
      setCy(((clamp(ny, halfH, imgH - halfH)) / imgH) * 100);
    },
    [imgW, imgH, visWpx, visHpx]
  );

  // % visible respecto a la imagen
  const viewWPercent = (view.vw / (imgW * zoom)) * 100;
  const viewHPercent = (view.vh / (imgH * zoom)) * 100;

  const setCenterClamped = useCallback(
    (nxPct: number, nyPct: number) => {
      const effW = Math.min(viewWPercent, 100);
      const effH = Math.min(viewHPercent, 100);
      const halfW = effW / 2;
      const halfH = effH / 2;
      setCx(viewWPercent >= 100 ? 50 : clamp(nxPct, halfW, 100 - halfW));
      setCy(viewHPercent >= 100 ? 50 : clamp(nyPct, halfH, 100 - halfH));
    },
    [viewWPercent, viewHPercent]
  );

  // rueda → zoom
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

  // drag sólo en modo pan
  const onMouseDown = (e: React.MouseEvent) => {
    if (tool !== "pan") return;
    movedRef.current = false;
    dragRef.current = { x: e.clientX, y: e.clientY, cxPx, cyPx };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (tool !== "pan" || !dragRef.current) return;
    const dx = (e.clientX - dragRef.current.x) / zoom;
    const dy = (e.clientY - dragRef.current.y) / zoom;
    setCenterToPx(dragRef.current.cxPx - dx, dragRef.current.cyPx - dy);
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  // click principal: crea hilo si herramienta = pin o si viene con Shift
  const onClickMain = (e: React.MouseEvent) => {
    const wantsPin = tool === "pin" || e.shiftKey;
    if (!wantsPin) return;
    if (dragRef.current) return; // si estabas arrastrando, ignora

    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;

    const xImgPx = (e.clientX - rect.left - tx) / zoom;
    const yImgPx = (e.clientY - rect.top - ty) / zoom;

    const xPct = clamp((xImgPx / imgW) * 100, 0, 100);
    const yPct = clamp((yImgPx / imgH) * 100, 0, 100);

    onCreateThreadAt(xPct, yPct);
  };

  // medir minimapa (contain con letterbox)
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

  // viewport minimapa
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

  // dots
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

  // chat
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

  const centerToThread = (t: ZoomThread) => {
    const px = (t.x / 100) * imgW;
    const py = (t.y / 100) * imgH;
    setCenterToPx(px, py);
    onFocusThread(t.id);
  };

  // cursor según herramienta
  const cursor =
    tool === "pin"
      ? "crosshair"
      : dragRef.current
      ? "grabbing"
      : "grab";

      
  return (
    <div className={css.overlay} role="dialog" aria-label="Zoom">
      <button className={css.close} onClick={onClose} aria-label="Cerrar">×</button>

      {/* TOOLBOX flotante del overlay */}
      <div className={css.toolbox} aria-label="Herramientas">
        <button
          type="button"
          className={`${css.toolBtn} ${tool === "pan" ? css.toolActive : ""}`}
          aria-pressed={tool === "pan"}
          title="Mover (arrastrar)"
          onClick={() => setTool("pan")}
        >
          🖐️
        </button>
        <button
          type="button"
          className={`${css.toolBtn} ${tool === "pin" ? css.toolActive : ""}`}
          aria-pressed={tool === "pin"}
          title="Añadir anotación"
          onClick={() => setTool("pin")}
        >
          📍
        </button>
      </div>

      {/* Viewport principal */}
      <div
        className={css.mainWrap}
        ref={wrapRef}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onClick={onClickMain}
        
      >
        <div
          className={css.stage}
          style={{
            width: imgW || 1,
            height: imgH || 1,
            transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
            cursor
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
                setZoom((z) => Math.max(z, minZ));
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
                <div key={m.id} className={`${css.bubble} ${m.isSystem ? css.sys : ""}`} title={m.createdByName || "Usuario"}>
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

      {/* Sidebar: Minimap + controles + lista */}
      <div className={css.sidebar}>
        <div
          className={css.minimap}
          ref={miniRef}
          onMouseDown={onMiniClickOrDrag}
          onMouseMove={(e) => e.buttons === 1 && onMiniClickOrDrag(e)}
        >
          <div className={css.miniImgWrap}>
            <Image src={src} alt="" fill sizes="320px" priority draggable={false} className={css.miniImg} onLoadingComplete={() => measureMini()} />
          </div>
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
            🖐️ mover · 📍 anotar · rueda para zoom · Esc para cerrar
          </div>

          <div className={css.threadList}>
            <div className={css.threadListTitle}>Hilos</div>
            <ul>
              {threads.map((t, i) => (
                <li key={t.id} className={`${css.threadRow} ${activeThreadId === t.id ? css.threadRowActive : ""}`}>
                  <button className={css.threadRowMain} onClick={() => centerToThread(t)}>
                    <span className={css.dotMini} style={{ background: colorByStatus(t.status) }} />
                    <span className={css.threadName}>#{i + 1}</span>
                    <span className={css.threadCoords}>({t.x.toFixed(1)}%, {t.y.toFixed(1)}%)</span>
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
