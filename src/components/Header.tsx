// src/components/Header.tsx
import React, { useState, useEffect } from "react";
import Image from "next/image";
import styles from "./Header.module.css";
import type { SkuWithImagesAndStatus } from "@/types/review";
import SkuSearch from "./SkuSearch";
import Notifications from "./Notifications";

interface HeaderProps {
  skus: SkuWithImagesAndStatus[];
  loading: boolean;
  clientName: string;
  clientProject: string;
  selectSku: (sku: SkuWithImagesAndStatus | null) => void;
  onOpenSku: (sku: string) => void; // ← para navegar desde notificaciones
  notificationsInitial?: { items: any[]; unseen: number } | null; // ← prefetch
}

export default function Header({
  skus, loading, clientName, clientProject, selectSku, onOpenSku, notificationsInitial
}: HeaderProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => setIsVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <div className={styles.hoverZone} onMouseEnter={() => setIsVisible(true)} />
      <header
        className={styles.appHeader}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        style={{ transform: isVisible ? "translateY(0)" : "translateY(-85%)" }}
      >
        <div className={styles.logoContainer}>
          <Image src="/1kwords-logo.png" alt="1K Words Logo" width={180} height={50} priority />
        </div>

        <div className={styles.selectorWrapper}>
          <div className={styles.selectorText}>
            <h2>Revisión de Productos</h2>
            <p>Selecciona una SKU para comenzar el proceso de revisión.</p>
          </div>

          <SkuSearch
            skus={skus}
            onSelect={(sku) => selectSku(sku as SkuWithImagesAndStatus)}
          />
        </div>

        <div className={styles.clientInfoRight}>
          <div className={styles.clientInfo}>
            <h3>{clientName}</h3>
            <p>{clientProject}</p>
          </div>

          {/* 🔔 Campana */}
          <Notifications onOpenSku={onOpenSku} initial={notificationsInitial ?? undefined} />
        </div>
      </header>

      <div className={styles.headerSpacer} />
    </>
  );
}
