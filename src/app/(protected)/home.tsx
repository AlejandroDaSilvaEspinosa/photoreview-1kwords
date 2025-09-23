"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ImageViewer from "@/components/ImageViewer";
import Header from "@/components/Header";
import styles from "./home.module.css";
import type { SkuWithImagesAndStatus, SkuStatus } from "@/types/review";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import { useGlobalRealtimeToasts } from "@/hooks/useRealtimeToasts";
import { useStatusesStore } from "@/stores/statuses";
import { useWireAllStatusesRealtime } from "@/lib/realtime/useWireAllStatusesRealtime";

type Prefetched = { items: any[]; unseen: number } | null;

type Props = {
  username: string;
  skus: SkuWithImagesAndStatus[];
  clientInfo: { name: string; project: string };
};

/** Orden de grupos (ajústalo si quieres otra prioridad) */
const STATUS_ORDER: SkuStatus[] = [
  "pending_validation",
  "needs_correction",
  "reopened",
  "validated",
];

const STATUS_LABEL: Record<SkuStatus, string> = {
  pending_validation: "Pendiente de validación",
  needs_correction: "Con correcciones",
  reopened: "Reabierto",
  validated: "Validado",
};

export default function Home({ username, skus, clientInfo }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 🔸 Prefetch notificaciones
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

  // Índice por sku
  const bySku = useMemo(() => {
    const m = new Map<string, SkuWithImagesAndStatus>();
    for (const s of skus) m.set(s.sku, s);
    return m;
  }, [skus]);

    // 🔌 engancha realtime global de status
  useWireAllStatusesRealtime();

  const liveBySku = useStatusesStore((s) => s.bySku);

    // decide el estado efectivo por SKU: live si existe, si no el de props
  const effectiveSkus = useMemo(() => {
    return skus.map((s) => {
      const live = liveBySku[s.sku];
      return live
        ? {
            ...s,
            status: live.status,
            counts: {
              finished: Math.max(0, (live.images_total ?? 0) - (live.images_needing_fix ?? 0)),
              needs_correction: live.images_needing_fix ?? 0,
              total: live.images_total ?? s.counts.total,
            },
          }
        : s;
    });
  }, [skus, liveBySku]);

  // grupos ordenados
  const groups = useMemo(() => {
    const map = new Map<SkuStatus, SkuWithImagesAndStatus[]>();
    for (const s of effectiveSkus) {
      (map.get(s.status) || (map.set(s.status, []), map.get(s.status)!)).push(s);
    }
    const orderIndex = (k: SkuStatus) => STATUS_ORDER.indexOf(k);
    return Array.from(map.entries()).sort((a,b) => orderIndex(a[0]) - orderIndex(b[0]));
  }, [effectiveSkus]);


  // URL → selección
  const skuParam   = searchParams.get("sku");
  const imageParam = searchParams.get("image");
  const selectedSku: SkuWithImagesAndStatus | null = skuParam ? (bySku.get(skuParam) ?? null) : null;

  // ¿la imagen de la URL pertenece al sku seleccionado?
  const selectedImageName: string | null = useMemo(() => {
    if (!selectedSku || !imageParam) return null;
    return selectedSku.images.some((i) => i.name === imageParam) ? imageParam : null;
  }, [selectedSku, imageParam]);

  // Normaliza si ?image no pertenece al sku
  useEffect(() => {
    if (!selectedSku || !imageParam) return;
    const belongs = selectedSku.images.some((i) => i.name === imageParam);
    if (!belongs) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("image");
      router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
    }
  }, [selectedSku, imageParam, searchParams, pathname, router]);

  // Cambios de URL
  const selectSku = useCallback((sku: SkuWithImagesAndStatus | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (sku) {
      next.set("sku", sku.sku);
      const img = next.get("image");
      if (img && !sku.images.some((i) => i.name === img)) next.delete("image");
    } else {
      next.delete("sku"); next.delete("image");
    }
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router]);

  const selectImage = useCallback((imageName: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (imageName) next.set("image", imageName); else next.delete("image");
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
  }, [searchParams, pathname, router]);

  // Toasters
  const onOpenSku   = useCallback((sku: string) => selectSku(bySku.get(sku) ?? null), [selectSku, bySku]);
  const onOpenImage = useCallback((sku: string, img: string) => {
    const s = bySku.get(sku); if (!s) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("sku", s.sku);
    if (s.images.some((i) => i.name === img)) next.set("image", img); else next.delete("image");
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
  }, [bySku, pathname, router, searchParams]);
  useGlobalRealtimeToasts({ onOpenSku, onOpenImage });

  // ===== Agrupación por estado =====
  const allStatuses = useMemo<SkuStatus[]>(() => {
    const set = new Set<SkuStatus>();
    for (const s of skus) set.add(s.status);
    return Array.from(set);
  }, [skus]);

  // visibilidad de estados (multi-selección)
  const [visibleStatuses, setVisibleStatuses] = useState<Set<SkuStatus>>(new Set(allStatuses));
  useEffect(() => { setVisibleStatuses(new Set(allStatuses)); }, [allStatuses.join("|")]);

  const toggleStatus = (key: SkuStatus) => {
    setVisibleStatuses(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const showAll = () => setVisibleStatuses(new Set(allStatuses));



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
            selectedImageName={selectedImageName}
            onSelectImage={selectImage}
          />
        ) : (
          <div className={styles.placeholder}>
            <div className={styles.placeholderInner}>
              <h2>Revisión de Productos</h2>
              <p>Selecciona una SKU para comenzar el proceso de revisión.</p>

              {/* ===== Filtros (píldoras) por estado ===== */}
              <div className={styles.filtersBar} role="group" aria-label="Filtrar por estado">
                <button
                  type="button"
                  className={`${styles.pill} ${visibleStatuses.size === allStatuses.length ? styles.pillActive : ""}`}
                  onClick={showAll}
                  title="Mostrar todos los estados"
                >
                  Todos
                </button>
                {STATUS_ORDER
                  .filter(k => allStatuses.includes(k))
                  .map((k) => {
                    const count = effectiveSkus.reduce((acc, s) => acc + (s.status === k ? 1 : 0), 0);
                    const active = visibleStatuses.has(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        className={`${styles.pill} ${active ? styles.pillActive : ""}`}
                        aria-pressed={active}
                        onClick={() => toggleStatus(k)}
                        title={`${active ? "Ocultar" : "Mostrar"} ${STATUS_LABEL[k]}`}
                      >
                        <span className={styles.pillDot} data-status={k} />
                        {STATUS_LABEL[k]}
                        <span className={styles.pillCount}>{count}</span>
                      </button>
                    );
                  })}
              </div>
              {/* ===== Listado con separadores por estado ===== */}
              {groups
                .filter(([k]) => visibleStatuses.has(k))
                .map(([k, items]) => (
              <section key={k} className={styles.section}>
                <div
                  className={styles.statusHeading}
                  role="separator"
                  aria-label={`${STATUS_LABEL[k]} · ${items.length}`}
                >
                  {STATUS_LABEL[k]} · {items.length}
                </div>
                <div className={styles.skuGrid} role="list">
                    {items.map((sku) => (
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
                            width={600}
                            height={600}
                            className={styles.thumbnail}
                            sizes="(max-width: 900px) 50vw, 260px"
                            quality={100}
                            minSkeletonMs={180}
                            fallbackText={sku.sku.slice(0, 2).toUpperCase()}
                          />
                          <span className={styles.skuBadge}>{sku.sku}</span>
                        </div>
                        <span className={styles.openHint}>Abrir</span>
                      </button>
                    ))}
                  </div>
                </section>
                ))}

              {(skus.length === 0 || visibleStatuses.size === 0) && (
                <div className={styles.emptyState}>
                  No hay SKUs para los filtros seleccionados.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}