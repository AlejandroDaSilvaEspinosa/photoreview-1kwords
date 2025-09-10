// Fichero: src/components/Header.tsx
"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import styles from './Header.module.css';

interface HeaderProps {
  skus: string[];
  loading: boolean;
  clientName: string;
  clientProject: string;
  onSkuChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}

export default function Header({ skus, loading, clientName, clientProject, onSkuChange }: HeaderProps) {
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
          {loading ? (
            <p style={{ color: '#a0a0a0' }}>Cargando SKUs...</p>
          ) : (
            <select 
              onChange={onSkuChange} 
              defaultValue="" 
              className={styles.skuSelector}
            >
              <option value="" disabled>-- Elige un producto --</option>
              {skus.map(sku => (
                <option key={sku} value={sku}>
                  {sku}
                </option>
              ))}
            </select>
          )}
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