"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ImageViewer from "@/components/ImageViewer";
import Header from "@/components/Header";
import styles from "./home.module.css";
import type { SkuWithImagesAndStatus } from "@/types/review";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import {useGlobalRealtimeToasts} from "@/hooks/useRealtimeToasts"

type Props = {
  username: string;
  skus: SkuWithImagesAndStatus[];
  clientInfo: { name: string; project: string };
};

export default function Home({ username, skus, clientInfo }: Props) {
  const [selectedSku, setSelectedSku] = useState<SkuWithImagesAndStatus | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  


  // Índice por sku para búsquedas O(1)
  const bySku = useMemo(() => {
    const m = new Map<string, SkuWithImagesAndStatus>();
    for (const s of skus) m.set(s.sku, s);
    return m;
  }, [skus]);

  // Al montar / cuando cambie el query param ?sku=..., selecciona ese SKU
  useEffect(() => {
    const skuParam = searchParams.get("sku");
    if (!skuParam) {
      // Si no hay param y hay algo seleccionado, no lo tocamos (o deselecciona si prefieres)
      return;
    }
    const fromParam = bySku.get(skuParam);
    if (fromParam && fromParam !== selectedSku) {
      setSelectedSku(fromParam);
    }
  }, [searchParams, bySku, selectedSku]);

  // Helper para seleccionar SKU y sincronizar URL (?sku=...)
  const selectSku = (sku: SkuWithImagesAndStatus | null) => {
    setSelectedSku(sku);
    const next = new URLSearchParams(searchParams.toString());
    if (sku) {
      next.set("sku", sku.sku);
    } else {
      next.delete("sku");
      // si también soportas ?image=..., borra aquí:
      next.delete("image");
    }
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, {
      scroll: false,
    });
  };
  const onOpenSku = useCallback((sku: string) => selectSku(bySku.get(sku) ?? null), [selectSku, bySku]);
  const onOpenImage = useCallback((sku: string, img: string) => {
    const s = bySku.get(sku);
    if (!s) return;
    selectSku(s);
    // si añades ?image=... podrías sincronizar aquí
  }, [bySku, selectSku]);

  useGlobalRealtimeToasts({ onOpenSku, onOpenImage });
  
  return (
    <main className={styles.main}>
      <Header
        skus={skus}
        loading={false}
        clientName={clientInfo.name}
        clientProject={clientInfo.project}
        selectSku={selectSku} 
      />
      <div className={styles.content}>
        {selectedSku ? (
          <ImageViewer
            username={username}
            key={selectedSku.sku}
            sku={selectedSku}
            selectSku={selectSku} 
          />
        ) : (
          <div className={styles.placeholder}>
            <h2>Revisión de Productos</h2>
            <p>Selecciona una SKU para comenzar el proceso de revisión.</p>

            <div className={styles.skuGrid}>
              {skus.map((sku) => (
                <div
                  key={sku.sku}
                  className={styles.skuCard}
                  onClick={() => selectSku(sku)} // ⬅️ sincroniza con URL
                >
                  <ImageWithSkeleton
                    src={sku.images[0]?.listingImageUrl}
                    alt={sku.sku}
                    width={600}
                    height={600}
                    className={styles.thumbnail}
                    sizes="100%"
                    quality={100}
                  />
                  <p>{sku.sku}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
