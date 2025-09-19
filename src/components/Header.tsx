// Fichero: src/components/Header.tsx

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import styles from './Header.module.css';
import type { Dispatch, SetStateAction } from 'react';
import type { ImageItem, SkuWithImagesAndStatus } from '@/types/review';
import SkuSearch from './SkuSearch';
interface HeaderProps {
  skus: SkuWithImagesAndStatus[];
  loading: boolean;
  clientName: string;
  clientProject: string;
  selectSku:(sku: SkuWithImagesAndStatus | null) => void;
}

export default function Header({ skus, loading, clientName, clientProject, selectSku }: HeaderProps) {
  const [isVisible, setIsVisible] = useState(false);

  // Mostrar temporalmente el header al cargar la página
  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => {
      setIsVisible(false);
    }, 3000); // Se oculta después de 3 segundos

    return () => clearTimeout(timer);
  }, []);

  const handleHeaderMouseEnter = () => {
    setIsVisible(true);
  };

  const handleHeaderMouseLeave = () => {
    setIsVisible(false);
  };


  return (
    <>
      {/* Zona de activación invisible en la parte superior */}
      <div 
        className={styles.hoverZone}
        onMouseEnter={handleHeaderMouseEnter}
      />
      
      <header 
        className={styles.appHeader}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
        style={{
          transform: isVisible ? 'translateY(0)' : 'translateY(-85%)'
        }}
      >
        <div className={styles.logoContainer}>
          <Image
            src="/1kwords-logo.png"
            alt="1K Words Logo"
            width={180}
            height={50}
            priority
          />
        </div>

        <div className={styles.selectorWrapper}>
          <div className={styles.selectorText}>
            <h2>Revisión de Productos</h2>
            <p>Selecciona una SKU para comenzar el proceso de revisión.</p>
          </div>
        <SkuSearch
          skus={skus}
          onSelect={(sku) => {
            // setSelectedSku(item.sku) o navegar, etc.
            // aqyui en on skuChange cambiar para que reciba todo el objeto
            selectSku(sku as SkuWithImagesAndStatus );
          }}
        />

        </div>

        <div className={styles.clientInfo}>
          <h3>{clientName}</h3>
          <p>{clientProject}</p>
        </div>
      </header>
      
      {/* Espaciador para compensar el header fijo */}
      <div className={styles.headerSpacer} />
    </>
  );
}