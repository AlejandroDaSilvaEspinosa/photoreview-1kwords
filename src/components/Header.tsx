"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import styles from "./Header.module.css";
import type { SkuWithImagesAndStatus } from "@/types/review";
import SkuSearch from "./SkuSearch";
import Notifications from "./Notifications";

type NotificationType =
  | "new_message"
  | "new_thread"
  | "thread_status_changed"
  | "image_status_changed"
  | "sku_status_changed";

type NotificationRow = {
  id: number;
  user_id: string;
  author_id: string | null;
  type: NotificationType;
  sku: string | null;
  image_name: string | null;
  thread_id: number | null;
  message: string;
  viewed: boolean;
  created_at: string;
};

interface HeaderProps {
  skus: SkuWithImagesAndStatus[];
  loading: boolean;
  clientName: string;
  clientProject: string;
  selectSku: (sku: SkuWithImagesAndStatus | null) => void;
  onOpenSku: (sku: string) => void;
  notificationsInitial?: { items: NotificationRow[]; unseen: number } | null;
}

export default function Header({
  skus,
  loading,
  clientName,
  clientProject,
  selectSku,
  onOpenSku,
  notificationsInitial,
}: HeaderProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  // pequeño “peek” inicial
  useEffect(() => {
    setOpen(true);
    const t = setTimeout(() => !pinned && setOpen(false), 2500);
    return () => clearTimeout(t);
  }, [pinned]);

  const reveal = () => setOpen(true);
  const hide = () => !pinned && setOpen(false);

  return (
    <>
      {/* zona de activación por hover en el borde superior */}
      <div className={styles.hoverZone} onMouseEnter={reveal} />

      <header
        className={`${styles.appHeader} ${open ? styles.open : ""} ${pinned ? styles.pinned : ""}`}
        onMouseEnter={reveal}
        onMouseLeave={hide}
        aria-expanded={open}
      >
        {/* rail/handler visual */}
        <div className={styles.peekTab} aria-hidden />

        {/* Izquierda: logo */}
        <div className={styles.left}>
          <button
            className={styles.pinBtn}
            aria-pressed={pinned}
            title={pinned ? "Desanclar" : "Anclar"}
            onClick={() => setPinned((v) => !v)}
          >
            {pinned ? "📍" : "📌"}
          </button>

          <div className={styles.logo}>
            <Image
              src="/1kwords-logo.png"
              alt="1K Words"
              width={160}
              height={40}
              priority
              draggable={false}
            />
          </div>
        </div>

        {/* Centro: título + buscador */}
        <div className={styles.center}>
          {/* <div className={styles.heading}>
            <h2>Revisión de Productos</h2>
            <p>Selecciona una SKU para comenzar el proceso de revisión.</p>
          </div> */}

          <SkuSearch
            skus={skus}
            placeholder={loading ? "Cargando SKUs…" : "Buscar SKU…"}
            onSelect={(sku) => selectSku(sku as SkuWithImagesAndStatus)}
            maxResults={200}
            minChars={1}
            debounceMs={200}
            thumbSize={40}
          />
        </div>

        {/* Derecha: cliente + notificaciones */}
        <div className={styles.right}>
          <div className={styles.clientInfo}>
            <h3>{clientName}</h3>
            <p>{clientProject}</p>
          </div>

          <Notifications onOpenSku={onOpenSku} initial={notificationsInitial ?? undefined} />
        </div>
      </header>

    </>
  );
}
