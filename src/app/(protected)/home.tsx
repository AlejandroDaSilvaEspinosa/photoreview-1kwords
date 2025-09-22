// src/app/(whatever)/home.tsx  (tu fichero Home)
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ImageViewer from "@/components/ImageViewer";
import Header from "@/components/Header";
import styles from "./home.module.css";
import type { SkuWithImagesAndStatus } from "@/types/review";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import { useGlobalRealtimeToasts } from "@/hooks/useRealtimeToasts";

type Prefetched = { items: any[]; unseen: number } | null;

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

  // 🔸 prefetch de notificaciones en background
  const [notifPrefetch, setNotifPrefetch] = useState<Prefetched>(null);
  useEffect(() => {
    let alive = true;
    // fondo (no bloquea render); si quieres aún más suave: requestIdleCallback
    (async () => {
      const res = await fetch("/api/notifications?limit=30", { cache: "no-store" }).catch(() => null);
      if (!alive) return;
      if (res?.ok) {
        const json = await res.json();
        setNotifPrefetch({ items: json.items ?? [], unseen: json.unseen ?? 0 });
      } else {
        setNotifPrefetch({ items: [], unseen: 0 });
      }
    })();
    return () => { alive = false; };
  }, []);

  const bySku = useMemo(() => {
    const m = new Map<string, SkuWithImagesAndStatus>();
    for (const s of skus) m.set(s.sku, s);
    return m;
  }, [skus]);

  useEffect(() => {
    const skuParam = searchParams.get("sku");
    if (!skuParam) return;
    const fromParam = bySku.get(skuParam);
    if (fromParam && fromParam !== selectedSku) setSelectedSku(fromParam);
  }, [searchParams, bySku, selectedSku]);

  const selectSku = (sku: SkuWithImagesAndStatus | null) => {
    setSelectedSku(sku);
    const next = new URLSearchParams(searchParams.toString());
    if (sku) next.set("sku", sku.sku);
    else { next.delete("sku"); next.delete("image"); }
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
  };

  const onOpenSku = useCallback((sku: string) => selectSku(bySku.get(sku) ?? null), [selectSku, bySku]);
  const onOpenImage = useCallback((sku: string, img: string) => {
    const s = bySku.get(sku);
    if (!s) return; selectSku(s);
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
        onOpenSku={onOpenSku}
        notificationsInitial={notifPrefetch}
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
                <div key={sku.sku} className={styles.skuCard} onClick={() => selectSku(sku)}>
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
