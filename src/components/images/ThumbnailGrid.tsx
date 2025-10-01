"use client";

import React, { useEffect, useMemo, useRef } from "react";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import styles from "./ThumbnailGrid.module.css";
import type { ThreadState, ImageItem, ThreadStatus } from "@/types/review";
import ChatIcon from "@/icons/chat.svg";

type ImgStatus = "finished" | "needs_correction";

type Props = {
  images: ImageItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;

  /** Threads por imagen (se usa para calcular dot y no leídos). */
  threads: ThreadState;

  /** nombreImagen -> hay mensajes no leídos (no system, no míos, sin read_at) */
  unreadByImage?: Record<string, boolean>;

  /** (Opcional) nombreImagen -> estado ("finished" | "needs_correction").
   * Se usa SOLO como pista si aún no hay threads hidratados.
   */
  imageStatusByName?: Record<string, ImgStatus>;
};

export default function ThumbnailGrid({
  images,
  selectedIndex,
  onSelect,
  threads,
  unreadByImage,
  imageStatusByName,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => images.map((_, i) => `thumb-${i}`), [images]);

  // Auto-scroll suave al elemento seleccionado
  useEffect(() => {
    const el = document.getElementById(ids[selectedIndex]);
    el?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
  }, [selectedIndex, ids]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!images.length) return;

    // Evita que también lo capture el listener global del ImageViewer
    e.stopPropagation();

    if (e.repeat) {
      e.preventDefault();
      return;
    }

    let next = selectedIndex;
    const clamp = (n: number) => Math.max(0, Math.min(images.length - 1, n));

    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        next = clamp(selectedIndex + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        next = clamp(selectedIndex - 1);
        break;
      case "Home":
        e.preventDefault();
        next = 0;
        break;
      case "End":
        e.preventDefault();
        next = images.length - 1;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        next = selectedIndex;
        break;
      default:
        return;
    }
    onSelect(next);
  };

  // Estado REAL desde threads si ya están hidratados (ignora borrados)
  const statusFromThreads = (name: string): ImgStatus | undefined => {
    const list =
      (threads[name] as Array<{ status: ThreadStatus }> | undefined) ??
      undefined;
    if (!Array.isArray(list)) return undefined;
    const hasOpen = list.some(
      (t) => t.status === "pending" || t.status === "reopened"
    );
    return hasOpen ? "needs_correction" : "finished";
  };

  return (
    <div
      ref={wrapRef}
      className={styles.thumbnailStrip}
      role="listbox"
      aria-label="Miniaturas"
      aria-activedescendant={ids[selectedIndex]}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {images.map((image, index) => {
        const name = image.name ?? "";
        const baseName = (name.split(".")[0] || name) ?? "";

        // 1) Intentar derivar desde threads (reactivo)
        const fromThreads = statusFromThreads(name);

        // 2) Si aún no hay threads, usar pista (no reactiva) de props/imagen
        const hint =
          imageStatusByName?.[name] ||
          ((image as any)?.status as ImgStatus | undefined);

        // 3) Prioridad: threads -> pista -> finished
        const finalStatus: ImgStatus = fromThreads ?? hint ?? "finished";
        const isFinished = finalStatus === "finished";

        // Chat pendiente por imagen (no leídos reales)
        const showUnread = !!(name && unreadByImage && unreadByImage[name]);

        return (
          <button
            key={`${name}-${index}`}
            id={ids[index]}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            className={`${styles.card} ${
              index === selectedIndex ? styles.active : ""
            }`}
            tabIndex={-1}
            onMouseDown={(e) => {
              // Evita que el botón robe el foco; mantenemos foco en el contenedor
              e.preventDefault();
              (e.currentTarget.parentElement as HTMLElement | null)?.focus({
                preventScroll: true,
              });
            }}
            onClick={() => {
              onSelect(index);
              requestAnimationFrame(() => {
                (wrapRef.current as HTMLDivElement | null)?.focus({
                  preventScroll: true,
                });
              });
            }}
            title={name}
          >
            <ImageWithSkeleton
              src={image.thumbnailUrl || ""}
              alt={name || `Imagen ${index + 1}`}
              width={100}
              height={100}
              className={styles.thumb}
              sizes="100px"
              quality={100}
              minSkeletonMs={220}
              fallbackText={(baseName || "IMG").slice(0, 2).toUpperCase()}
            />

            {/* Nombre sobre un velo en la base */}
            <div className={styles.nameBar}>
              <span className={styles.nameText}>
                {baseName.length > 12 ? `${baseName.slice(0, 12)}…` : baseName}
              </span>
            </div>

            {/* Estado (dot arriba-derecha): verde si finished, rojo si needs_correction */}
            <span
              className={`${styles.stateDot} ${
                isFinished ? styles.dotGreen : styles.dotRed
              }`}
              aria-label={
                isFinished ? "Imagen terminada" : "Necesita correcciones"
              }
              title={isFinished ? "Terminada" : "Necesita correcciones"}
            />

            {/* Badge de chat */}
            {showUnread && (
              <span className={styles.chatBadge} title="Mensajes sin leer">
                <ChatIcon />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
