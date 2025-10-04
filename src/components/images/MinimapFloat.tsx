// ==============================
// File: src/components/images/MinimapFloat.tsx
// ==============================
import React from "react";
import styles from "./MinimapFloat.module.css";
import Minimap from "./Minimap";

type MinimapFloatProps = {
  src: string;
  aspect?: string;
  position: { x: number; y: number };
  collapsed: boolean;
  setCollapsed: (b: boolean) => void;

  // refs (se reutilizan desde el padre para cálculo/medidas/drag)
  miniRef: React.RefObject<HTMLDivElement>;
  floatRef: React.RefObject<HTMLDivElement>;
  handleRef: React.RefObject<HTMLDivElement>;

  // estilo de viewport dentro del minimapa
  vpStyle: React.CSSProperties;

  // handlers delegados (ya existentes en el padre)
  onMiniClickOrDrag: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMiniTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void;
  onMiniTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void;

  // drag de la caja flotante (el padre mantiene el estado y clamp)
  beginMiniDrag: (x: number, y: number) => void;

  // para recolocar en esquina y medir tras expandir (lógica del padre)
  snapMiniToCorner: (collapsed: boolean, corner: "bl" | "br") => void;
  measureMini: () => void;
};

export default function MinimapFloat({
  src,
  aspect,
  position,
  collapsed,
  setCollapsed,
  miniRef,
  floatRef,
  handleRef,
  vpStyle,
  onMiniClickOrDrag,
  onMiniTouchStart,
  onMiniTouchMove,
  beginMiniDrag,
  snapMiniToCorner,
  measureMini,
}: MinimapFloatProps) {
  return (
    <div
      ref={floatRef}
      className={`${styles.miniFloat} ${
        collapsed ? styles.miniFloatCollapsed : ""
      }`}
      style={{ left: position.x, top: position.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div
        className={`${styles.miniDragHandle} ${
          collapsed ? styles.miniDragHandleDisabled : ""
        }`}
        ref={handleRef}
        onMouseDown={(e) => {
          if (collapsed) return;
          const target = e.target as HTMLElement;
          if (target.closest(`.${styles.miniHandleBtn}`)) return;
          e.preventDefault();
          e.stopPropagation();
          beginMiniDrag(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          if (collapsed) return;
          const t = e.touches[0];
          if (!t) return;
          e.preventDefault();
          e.stopPropagation();
          const target = (e.target as HTMLElement) || undefined;
          if (target && target.closest(`.${styles.miniHandleBtn}`)) return;
          beginMiniDrag(t.clientX, t.clientY);
        }}
      >
        <span className={styles.miniHandleTitle}>Minimapa</span>
        <button
          className={styles.miniHandleBtn}
          aria-label={collapsed ? "Expandir minimapa" : "Minimizar minimapa"}
          title={collapsed ? "Expandir" : "Minimizar"}
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
            const next = !collapsed;
            setCollapsed(next);
            if (next) {
              // al colapsar → esquina inferior (mantenemos "bl" para consistencia con tu versión)
              snapMiniToCorner(true, "bl");
            } else {
              // al expandir → recoloca y mide
              snapMiniToCorner(false, "bl");
              requestAnimationFrame(() => measureMini());
            }
          }}
        >
          {collapsed ? "▣" : "▭"}
        </button>
      </div>

      {!collapsed && (
        <Minimap
          src={src}
          aspect={aspect}
          vpStyle={vpStyle}
          miniRef={miniRef}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMiniClickOrDrag(e);
          }}
          onMouseMove={(e) => {
            e.stopPropagation();
            if (e.buttons === 1) onMiniClickOrDrag(e);
          }}
          onTouchStart={(e) => onMiniTouchStart(e)}
          onTouchMove={(e) => onMiniTouchMove(e)}
          onImageReady={measureMini}
        />
      )}
    </div>
  );
}
