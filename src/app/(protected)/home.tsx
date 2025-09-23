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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 🔸 prefetch de notificaciones en background
  const [notifPrefetch, setNotifPrefetch] = useState<Prefetched>(null);
  useEffect(() => {
    let alive = true;
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

  // ✅ URL como única fuente de verdad
  const skuParam = searchParams.get("sku");
  const selectedSku: SkuWithImagesAndStatus | null = skuParam ? (bySku.get(skuParam) ?? null) : null;

  // Cambia solo la URL (no estado local)
  const selectSku = useCallback((sku: SkuWithImagesAndStatus | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (sku) {
      next.set("sku", sku.sku);
    } else {
      next.delete("sku");
      next.delete("image");
    }
    router.replace(
      `${pathname}${next.toString() ? `?${next.toString()}` : ""}`,
      { scroll: false }
    );
  }, [searchParams, pathname, router]);

  const onOpenSku = useCallback(
    (sku: string) => selectSku(bySku.get(sku) ?? null),
    [selectSku, bySku]
  );

  const onOpenImage = useCallback((sku: string, _img: string) => {
    const s = bySku.get(sku);
    if (!s) return;
    selectSku(s);
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
            <div className={styles.placeholderInner}>
              <h2>Revisión de Productos</h2>
              <p>Selecciona una SKU para comenzar el proceso de revisión.</p>

              <div className={styles.sectionDivider}><span>Listado de SKUs</span></div>

              <div className={styles.skuGrid} role="list">
                {skus.map((sku) => (
                  <button
                    key={sku.sku}
                    type="button"
                    role="listitem"
                    className={styles.skuCard}
                    onClick={() => selectSku(sku)}
                    title={`Abrir SKU ${sku.sku}`}
                  >
                    <div className={styles.thumbWrap}>
                      <ImageWithSkeleton
                        src={sku.images[0]?.listingImageUrl}
                        alt={sku.sku}
                        width={200}
                        height={200}
                        className={styles.thumbnail}
                        sizes="(max-width: 900px) 50vw, 260px"
                        quality={100}
                        minSkeletonMs={180}
                        loading="lazy"
                        fallbackText={sku.sku.slice(0, 2).toUpperCase()}
                      />
                      <span className={styles.skuBadge}>{sku.sku}</span>
                    </div>
                    <span className={styles.openHint}>Abrir</span>
                  </button>
                ))}
                {skus.length === 0 && (
                  <div className={styles.emptyState}>
                    No hay SKUs disponibles por ahora.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
