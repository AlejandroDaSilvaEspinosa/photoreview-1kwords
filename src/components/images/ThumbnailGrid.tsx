"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import styles from "./ThumbnailGrid.module.css";
import type { ThreadState, ImageItem } from "@/types/review";
import ChatIcon from "@/icons/chat.svg";

type ImgStatus = "finished" | "needs_correction";

type Props = {
  images: ImageItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Threads por imagen (sigue igual por compatibilidad, no se usa para contar no leídos). */
  threads: ThreadState;

  /** NUEVO: map nombreImagen -> tiene mensajes no leídos (no system y no tuyos, sin read_at). */
  unreadByImage?: Record<string, boolean>;

  /** NUEVO (opcional): map nombreImagen -> estado ("finished" | "needs_correction").
   * Si no se provee, se intentará usar image.status.
   */
  imageStatusByName?: Record<string, ImgStatus>;
};

export default function ThumbnailGrid({
  images,
  selectedIndex,
  onSelect,
  threads, // se mantiene por compatibilidad (no se usa para la badge de chat)
  unreadByImage,
  imageStatusByName,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => images.map((_, i) => `thumb-${i}`), [images]);
  const [focusIdx, setFocusIdx] = useState<number>(-1);

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
    const prevent = () => e.preventDefault();
    let next = selectedIndex;

    switch (e.key) {
      case "ArrowRight":
        prevent();
        next = Math.min(selectedIndex + 1, images.length - 1);
        break;
      case "ArrowLeft":
        prevent();
        next = Math.max(selectedIndex - 1, 0);
        break;
      case "Home":
        prevent();
        next = 0;
        break;
      case "End":
        prevent();
        next = images.length - 1;
        break;
      case "Enter":
      case " ":
        prevent();
        onSelect(selectedIndex);
        return;
      default:
        return;
    }
    onSelect(next);
    setFocusIdx(next);
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

        // --- Nuevo: badge de chat sólo si hay pendientes reales por imagen
        const showUnread = !!(name && unreadByImage && unreadByImage[name]);

        // --- Nuevo: dot de estado (verde = finished, rojo = needs_correction)
        const statusFromMap = imageStatusByName?.[name];
        const statusFromItem = (image as any)?.status as ImgStatus | undefined;
        const status: ImgStatus | undefined = statusFromMap || statusFromItem;

        const showDot = status === "finished" || status === "needs_correction";
        const isFinished = status === "finished";

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
            onClick={() => onSelect(index)}
            onFocus={() => setFocusIdx(index)}
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
            {showDot && (
              <span
                className={`${styles.stateDot} ${
                  isFinished ? styles.dotGreen : styles.dotRed
                }`}
                aria-label={
                  isFinished ? "Imagen terminada" : "Necesita correcciones"
                }
                title={isFinished ? "Terminada" : "Necesita correcciones"}
              />
            )}

            {/* Badge de chat: se desplaza si hay dot para no solapar */}
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
