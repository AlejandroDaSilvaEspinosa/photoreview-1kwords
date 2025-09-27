// app/(protected)/home.tsx
"use client";

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  startTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ImageViewer from "@/components/ImageViewer";
import Header from "@/components/Header";
import styles from "./home.module.css";
import type { SkuWithImagesAndStatus, SkuStatus } from "@/types/review";
import { useWireAllStatusesRealtime } from "@/lib/realtime/useWireAllStatusesRealtime";
import { useStatusesStore } from "@/stores/statuses";
import { useHomeOverview } from "@/hooks/useHomeOverview";
import FilterPills from "@/components/home/FilterPills";
import StatusHeading from "@/components/home/StatusHeading";
import SkuCard from "@/components/home/SkuCard";
import { useImagesCatalogStore } from "@/stores/imagesCatalog";
import { emitToast, toastError } from "@/hooks/useToast";
import { localGetJSON, localSetJSON } from "@/lib/storage";
import { initMessagesOutbox } from "@/lib/net/messagesOutbox";

/**
 * DEV NOTES
 * - URL ↔ selección se mantiene con helpers replaceParams/select* (evita renders extra).
 * - Hidratamos catálogo de imágenes para thumbnails/toasts.
 * - Guardamos filtros en localStorage.
 */

type Prefetched = { items: any[]; unseen: number } | null;

type Props = {
  username: string;
  skus: SkuWithImagesAndStatus[];
  clientInfo: { name: string; project: string };
};

const STATUS_LABEL: Record<SkuStatus, string> = {
  pending_validation: "Pendiente de validación",
  needs_correction: "Con correcciones",
  validated: "Validado",
  reopened: "Reabierto",
};

const ALL: SkuStatus[] = [
  "pending_validation",
  "needs_correction",
  "validated",
  "reopened",
];
const LS_KEY = "home.filters.statuses.v1";

export default function Home({ username, skus, clientInfo }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Realtime statuses (SKUs/Imágenes)
  useWireAllStatusesRealtime();
  const liveBySku = useStatusesStore((s) => s.bySku);

  // Props + estado live
  const effectiveSkus = useMemo(() => {
    return skus.map((s) => {
      const live = liveBySku[s.sku];
      if (!live) return s;
      const total = live.images_total ?? s.counts.total;
      const needsFix = live.images_needing_fix ?? 0;
      return {
        ...s,
        status: live.status,
        counts: {
          finished: Math.max(0, total - needsFix),
          needs_correction: needsFix,
          total,
        },
      };
    });
  }, [skus, liveBySku]);

  useEffect(() => {
    const dispose = initMessagesOutbox();
    return () => dispose?.();
  }, []);

  // Hidrata catálogo de imágenes (para thumbnails/toasts)
  const hydrateImages = useImagesCatalogStore((s) => s.hydrateFromSkus);
  useEffect(() => {
    hydrateImages(effectiveSkus);
  }, [effectiveSkus, hydrateImages]);

  // Resúmenes y "unread"
  const { stats, unread } = useHomeOverview(effectiveSkus);

  // Prefetch notifs (no bloquea UI)
  const [notifPrefetch, setNotifPrefetch] = useState<Prefetched>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/notifications?limit=30", {
          cache: "no-store",
        });
        if (!alive) return;
        if (!res.ok)
          throw new Error("No se pudieron obtener las notificaciones.");
        const json = await res.json();
        setNotifPrefetch({ items: json.items ?? [], unseen: json.unseen ?? 0 });
      } catch (e) {
        setNotifPrefetch({ items: [], unseen: 0 });
        toastError(e, { title: "Fallo cargando notificaciones" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ==================== URL <-> selección helpers ====================
  const replaceParams = useCallback(
    (next: URLSearchParams) => {
      const current = `${pathname}${
        searchParams.size ? `?${searchParams}` : ""
      }`;
      const target = `${pathname}${
        next.toString() ? `?${next.toString()}` : ""
      }`;
      if (current !== target) {
        startTransition(() => router.replace(target, { scroll: false }));
      }
    },
    [pathname, router, searchParams]
  );

  const selectSku = useCallback(
    (sku: SkuWithImagesAndStatus | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (sku) {
        next.set("sku", sku.sku);
        const img = next.get("image");
        if (img && !sku.images.some((i) => i.name === img))
          next.delete("image");
      } else {
        next.delete("sku");
        next.delete("image");
      }
      next.delete("thread");
      replaceParams(next);
    },
    [searchParams, replaceParams]
  );

  const selectImage = useCallback(
    (imageName: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (imageName) next.set("image", imageName);
      else next.delete("image");
      next.delete("thread");
      replaceParams(next);
    },
    [searchParams, replaceParams]
  );

  const selectThread = useCallback(
    (threadId: number | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (threadId != null) next.set("thread", String(threadId));
      else next.delete("thread");
      replaceParams(next);
    },
    [searchParams, replaceParams]
  );

  const onOpenSku = useCallback(
    (sku: string) =>
      selectSku(effectiveSkus.find((s) => s.sku === sku) ?? null),
    [selectSku, effectiveSkus]
  );

  // URL params → selección actual
  const skuParam = searchParams.get("sku");
  const imageParam = searchParams.get("image");
  const threadParam = searchParams.get("thread");

  const bySku = useMemo(
    () => new Map(effectiveSkus.map((s) => [s.sku, s])),
    [effectiveSkus]
  );
  const selectedSku: SkuWithImagesAndStatus | null = skuParam
    ? bySku.get(skuParam) ?? null
    : null;

  const selectedImageName: string | null = useMemo(() => {
    if (!selectedSku || !imageParam) return null;
    return selectedSku.images.some((i) => i.name === imageParam)
      ? imageParam
      : null;
  }, [selectedSku, imageParam]);

  const selectedThreadId: number | null = useMemo(
    () =>
      threadParam && /^-?\d+$/.test(threadParam) ? Number(threadParam) : null,
    [threadParam]
  );

  // Evita incoherencias imagen/thread si la imagen no pertenece al SKU
  useEffect(() => {
    if (!selectedSku || !imageParam) return;
    const belongs = selectedSku.images.some((i) => i.name === imageParam);
    if (!belongs) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("image");
      next.delete("thread");
      replaceParams(next);
      emitToast({
        variant: "warning",
        title: "Imagen no pertenece al SKU",
        description: "Se ha limpiado la selección incoherente de URL.",
        durationMs: 3000,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSku, imageParam]);

  // ==================== Filtros (LocalStorage con util) ====================
  const [active, setActive] = useState<Set<SkuStatus>>(() => new Set(ALL));

  useEffect(() => {
    const arr = localGetJSON<SkuStatus[]>(LS_KEY);
    if (Array.isArray(arr) && arr.length) setActive(new Set(arr));
  }, []);

  useEffect(() => {
    localSetJSON(LS_KEY, Array.from(active)); // escribe en idle y con toast en caso de error
  }, [active]);

  const toggle = useCallback((s: SkuStatus) => {
    setActive((prev) => {
      const n = new Set(prev);
      n.has(s) ? n.delete(s) : n.add(s);
      if (n.size === 0) ALL.forEach((x) => n.add(x));
      return n;
    });
  }, []);

  // ==================== Derivados ====================
  const filtered = useMemo(
    () => effectiveSkus.filter((s) => active.has(s.status)),
    [effectiveSkus, active]
  );

  const grouped = useMemo(() => {
    const m = new Map<SkuStatus, SkuWithImagesAndStatus[]>();
    for (const s of filtered)
      (m.get(s.status) || (m.set(s.status, []), m.get(s.status)!)).push(s);
    return m;
  }, [filtered]);

  return (
    <main className={styles.main}>
      <Header
        skus={effectiveSkus}
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
            selectedThreadId={selectedThreadId}
            onSelectThread={selectThread}
          />
        ) : (
          <div className={styles.placeholder}>
            <div className={styles.placeholderInner}>
              <h2>Revisión de Productos</h2>
              <p>Selecciona una SKU para comenzar el proceso de revisión.</p>

              <FilterPills
                all={ALL}
                labels={STATUS_LABEL}
                totals={
                  Object.fromEntries(
                    ALL.map((s) => [
                      s,
                      effectiveSkus.filter((x) => x.status === s).length,
                    ])
                  ) as Record<SkuStatus, number>
                }
                active={active}
                onToggle={toggle}
              />

              {ALL.map((k) => {
                const items = grouped.get(k) ?? [];
                if (!items.length) return null;

                return (
                  <section key={k} className={styles.section}>
                    <StatusHeading
                      label={`${STATUS_LABEL[k]} · ${items.length}`}
                    />
                    <div className={styles.skuGrid} role="list">
                      {items.map((sku) => (
                        <SkuCard
                          key={sku.sku}
                          sku={sku}
                          unread={!!unread[sku.sku]}
                          perImageStats={stats[sku.sku] || {}}
                          onOpen={() => selectSku(sku)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
