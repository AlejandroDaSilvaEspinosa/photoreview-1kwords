"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "./MinimapFloat.module.css";
import Minimap from "./Minimap";

type Props = {
  containerRef: React.RefObject<HTMLElement>;
  src: string;
  imgW: number;
  imgH: number;
  cx: number;
  cy: number;
  zoom: number;
  viewportPx: { vw: number; vh: number };
  onMoveViewport: (xPct: number, yPct: number) => void;
  miniAspect?: string;
};

const LS_KEYS = {
  pos: "rev.zoom.minimap.pos.v2",
  collapsed: "rev.zoom.minimap.collapsed.v2",
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export default function MinimapFloat({
  containerRef,
  src,
  imgW,
  imgH,
  cx,
  cy,
  zoom,
  viewportPx,
  onMoveViewport,
  miniAspect,
}: Props) {
  const floatRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const miniRootRef = useRef<HTMLDivElement>(null); // contenedor del Minimap

  const [hydrated, setHydrated] = useState(false);
  const [miniCollapsed, setMiniCollapsed] = useState(false);
  const [miniPos, setMiniPos] = useState<{ x: number; y: number }>({
    x: 12,
    y: 12,
  });
  const [dragging, setDragging] = useState(false);
  const hasClampedOnce = useRef(false);

  useLayoutEffect(() => {
    try {
      const rawPos = localStorage.getItem(LS_KEYS.pos);
      if (rawPos) {
        const p = JSON.parse(rawPos);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y))
          setMiniPos({ x: p.x, y: p.y });
      }
      const rawCol = localStorage.getItem(LS_KEYS.collapsed);
      if (rawCol === "1" || rawCol === "0") setMiniCollapsed(rawCol === "1");
    } catch {
      // no-op
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !dragging)
      localStorage.setItem(LS_KEYS.pos, JSON.stringify(miniPos));
  }, [hydrated, dragging, miniPos.x, miniPos.y]);

  useEffect(() => {
    if (hydrated)
      localStorage.setItem(LS_KEYS.collapsed, miniCollapsed ? "1" : "0");
  }, [hydrated, miniCollapsed]);

  const getHandleH = () =>
    handleRef.current?.getBoundingClientRect().height ?? 28;
  const getFloatW = () =>
    floatRef.current?.getBoundingClientRect().width ?? 240;

  const computeMiniHeight = useCallback(
    (collapsed: boolean) => {
      const handleH = getHandleH();
      if (collapsed) return handleH;
      const frW = getFloatW();
      const estMiniH = imgW && imgH ? (frW * imgH) / imgW : frW;
      const realH = miniRootRef.current?.getBoundingClientRect().height;
      return handleH + (realH ?? estMiniH);
    },
    [imgW, imgH]
  );

  // ⬇️ clamp con paddings del contenedor (corrige “5px del bottom”)
  const clampToBounds = useCallback(
    (p: { x: number; y: number }, collapsed = miniCollapsed) => {
      const crel = containerRef.current as HTMLElement | null;
      const crect = crel?.getBoundingClientRect();
      const ow = crect?.width ?? window.innerWidth;
      const oh = crect?.height ?? window.innerHeight;

      // Paddings del contenedor
      const cs = crel ? getComputedStyle(crel) : null;
      const padL = cs ? parseFloat(cs.paddingLeft || "0") : 0;
      const padR = cs ? parseFloat(cs.paddingRight || "0") : 0;
      const padT = cs ? parseFloat(cs.paddingTop || "0") : 0;
      const padB = cs ? parseFloat(cs.paddingBottom || "0") : 0;

      const mw = getFloatW();
      const mh = computeMiniHeight(collapsed);

      const minX = padL;
      const minY = padT;
      const maxX = Math.max(minX, ow - mw - padR);
      const maxY = Math.max(minY, oh - mh - padB);

      return { x: clamp(p.x, minX, maxX), y: clamp(p.y, minY, maxY) };
    },
    [containerRef, computeMiniHeight, miniCollapsed]
  );

  // Primera sujeción al contenedor cuando ya tiene tamaño real
  useEffect(() => {
    if (!hydrated) return;
    const crect = containerRef.current?.getBoundingClientRect();
    if (!crect || !crect.width || !crect.height) return;

    // Dejar que el layout asiente y entonces clampear (evita reseteos)
    const raf = requestAnimationFrame(() => {
      setMiniPos((p) => clampToBounds(p));
      hasClampedOnce.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [hydrated, containerRef, clampToBounds]);

  // Si cambia tamaño de imagen/contenedor, re-clampeamos pero sin “saltar”
  useEffect(() => {
    if (!hydrated || !hasClampedOnce.current) return;
    setMiniPos((p) => clampToBounds(p));
  }, [hydrated, imgW, imgH, viewportPx.vw, viewportPx.vh, clampToBounds]);

  const toggleCollapsed = useCallback(() => {
    setMiniCollapsed((prev) => {
      const next = !prev;
      setMiniPos((p) => {
        const crect = containerRef.current?.getBoundingClientRect();
        const oh = crect?.height ?? window.innerHeight;
        const mh = computeMiniHeight(next);
        const y = Math.max(0, oh - mh);
        return clampToBounds({ x: p.x, y }, next);
      });
      return next;
    });
  }, [computeMiniHeight, clampToBounds, containerRef]);

  // === Drag del flotante (mouse/touch + captura robusta) ===
  const dragRef = useRef<{
    active: boolean;
    id: number | null;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  }>({
    active: false,
    id: null,
    sx: 0,
    sy: 0,
    ox: 0,
    oy: 0,
  });

  const beginMiniDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (miniCollapsed) return;
    const el = e.currentTarget as HTMLElement; // el asa
    el.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      active: true,
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ox: miniPos.x,
      oy: miniPos.y,
    };
    setDragging(true);
  };

  const doMiniDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragRef.current.active) return;
      const dx = clientX - dragRef.current.sx;
      const dy = clientY - dragRef.current.sy;
      setMiniPos(
        clampToBounds({
          x: dragRef.current.ox + dx,
          y: dragRef.current.oy + dy,
        })
      );
    },
    [clampToBounds]
  );

  const endMiniDrag = () => {
    if (!dragRef.current.active) return;
    dragRef.current = { active: false, id: null, sx: 0, sy: 0, ox: 0, oy: 0 };
    setDragging(false);
  };

  // Escucha global robusta (incluye pointermove/up y mousemove/up)
  useEffect(() => {
    const onPMove = (e: PointerEvent) => doMiniDrag(e.clientX, e.clientY);
    const onMMove = (e: MouseEvent) => doMiniDrag(e.clientX, e.clientY);
    const onPUp = () => endMiniDrag();
    const onMUp = () => endMiniDrag();
    const onPCancel = () => endMiniDrag();

    window.addEventListener("pointermove", onPMove, { passive: true });
    window.addEventListener("mousemove", onMMove, { passive: true });
    window.addEventListener("pointerup", onPUp, { passive: true });
    window.addEventListener("mouseup", onMUp, { passive: true });
    window.addEventListener("pointercancel", onPCancel, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPMove);
      window.removeEventListener("mousemove", onMMove);
      window.removeEventListener("pointerup", onPUp);
      window.removeEventListener("mouseup", onMUp);
      window.removeEventListener("pointercancel", onPCancel);
    };
  }, [doMiniDrag]);

  // Forzar remonte del Minimap si cambian inputs relevantes (evita “imagen colgada”)
  const miniKey = `${src}|${imgW}x${imgH}|${miniCollapsed ? 1 : 0}`;

  return (
    <div
      ref={floatRef}
      className={`${styles.miniFloat} ${
        miniCollapsed ? styles.miniFloatCollapsed : ""
      }`}
      style={{ left: miniPos.x, top: miniPos.y, touchAction: "none" }}
      data-no-pin
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={`${styles.miniDragHandle} ${
          miniCollapsed ? styles.miniDragHandleDisabled : ""
        }`}
        ref={handleRef}
        data-no-pin
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest(`.${styles.miniHandleBtn}`)) return; // evita iniciar drag al pulsar el botón
          e.preventDefault();
          e.stopPropagation();
          beginMiniDrag(e);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
          endMiniDrag();
        }}
      >
        <span className={styles.miniHandleTitle}>Minimapa</span>
        <button
          className={styles.miniHandleBtn}
          aria-label={
            miniCollapsed ? "Expandir minimapa" : "Minimizar minimapa"
          }
          title={miniCollapsed ? "Expandir" : "Minimizar"}
          data-no-pin
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            toggleCollapsed();
          }}
        >
          {miniCollapsed ? "▣" : "▭"}
        </button>
      </div>

      {!miniCollapsed && (
        <div ref={miniRootRef} data-no-pin>
          <Minimap
            key={miniKey}
            src={src}
            imgW={imgW}
            imgH={imgH}
            cx={cx}
            cy={cy}
            zoom={zoom}
            viewportPx={viewportPx}
            onMoveViewport={onMoveViewport}
            miniAspect={miniAspect}
            className={styles.minimap}
            /** bloquea interacciones mientras se arrastra el flotante */
            disabled={dragging}
          />
        </div>
      )}
    </div>
  );
}
