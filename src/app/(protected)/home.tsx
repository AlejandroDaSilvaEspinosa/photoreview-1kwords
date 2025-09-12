"use client";

import { useState } from "react";
import ImageViewer from "@/components/ImageViewer";
import Header from "@/components/Header";
import styles from "./home.module.css";
import Image from 'next/image';

export default function Home({ skus, clientInfo }: { skus: string[]; clientInfo: {name: string; project: string} }) {
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  return (
    <main className={styles.main}>
      <Header
        skus={skus}
        loading={false}
        clientName={clientInfo.name}
        clientProject={clientInfo.project}
        onSkuChange={(e) => setSelectedSku(e)}
      />
      <div className={styles.content}>
        {selectedSku ? (
          <ImageViewer key={selectedSku} sku={selectedSku} />
        ) : (
          <div className={styles.placeholder}>
            {/* <p>Por favor, selecciona una SKU para ver sus imágenes.</p> */}
            <h2>Revisión de Productos</h2>
            <p>Selecciona una SKU para comenzar el proceso de revisión.</p>
            <div className={styles.skuGrid}>                
            {
                skus.map(sku => (
                    <div 
                    onClick={() => setSelectedSku(sku)}
                    
                    key={sku.sku} className={styles.skuCard}>
                        <Image
                            src={sku.images[0].listingImageUrl}
                            alt={sku.sku}
                            width={600}
                            height={600}
                            className={styles.thumbnail}
                            sizes={`100%`}
                            quality={100}
                        />
                        <p>{sku.sku}</p>
                    </div>
                ))
            }
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
