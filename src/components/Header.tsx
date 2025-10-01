"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import styles from "./Header.module.css";
import type { SkuWithImagesAndStatus } from "@/types/review";
import SkuSearch from "./SkuSearch";
import Notifications from "./Notifications";
import { useHomeOverview } from "@/hooks/useHomeOverview"; // ⬅️ NUEVO

type NotificationType =
  | "new_message"
  | "new_thread"
  | "thread_status_changed"
  | "image_status_changed"
  | "sku_status_changed";

export type NotificationRow = {
  id: number;
  user_id: string;
  author_id: string | null;
  author_username?: string | null;
  type: NotificationType;
  sku: string | null;
  image_name: string | null;
  thread_id: number | null;
  message: string;
  excerpt?: string | null;
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

  // Peek inicial
  useEffect(() => {
    setOpen(true);
    const t = setTimeout(() => setOpen(false), 2500);
    return () => clearTimeout(t);
  }, []);

  const reveal = () => setOpen(true);
  const hide = () => setOpen(false);

  // ⬇️ NUEVO: no leídos por SKU para el buscador
  const { unread } = useHomeOverview(skus);

  return (
    <>
      <div className={styles.hoverZone} onMouseEnter={reveal} />
      <header
        className={`${styles.appHeader} ${open ? styles.open : ""}`}
        onMouseEnter={reveal}
        onMouseLeave={hide}
        aria-expanded={open}
      >
        <div className={styles.peekTab} aria-hidden />

        <div className={styles.left}>
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

        <div className={styles.center}>
          <SkuSearch
            skus={skus}
            placeholder={loading ? "Cargando SKUs…" : "Buscar SKU…"}
            onSelect={(sku) => selectSku(sku as SkuWithImagesAndStatus)}
            maxResults={200}
            minChars={1}
            debounceMs={200}
            thumbSize={64}
            unreadBySku={unread} // ⬅️ NUEVO
          />
        </div>

        <div className={styles.right}>
          <div className={styles.clientInfo}>
            <h3>{clientName}</h3>
            <p>{clientProject}</p>
          </div>

          <Notifications
            onOpenSku={onOpenSku}
            initial={notificationsInitial ?? undefined}
          />
        </div>
      </header>
    </>
  );
}
