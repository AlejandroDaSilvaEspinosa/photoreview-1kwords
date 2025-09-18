"use client";

import React, { useMemo, useState } from "react";
import styles from "./ImageViewer.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThumbnailGrid from "./images/ThumbnailGrid";
import SidePanel, { Thread } from "./images/SidePanel";
import type { AnnotationThread, ImageItem } from "@/types/review";
import { usePresence } from "@/lib/usePresence";
import { useImageGeometry } from "@/lib/useImageGeometry";
import { useThreads } from "@/lib/useThreads";
import ZoomOverlay from "@/components/images/ZoomOverlay";

interface ImageViewerProps {
  sku: { sku: string; images: ImageItem[] };
  username?: string;
}

type ParentTool = "zoom" | "pin";

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const fp = (image: string, x: number, y: number) => `${image}|${round3(x)}|${round3(y)}`;

export default function ImageViewer({ sku, username }: ImageViewerProps) {
  const { images } = sku;

  const {
    annotations,
    activeThreadId,
    setActiveThreadId,
    activeKey,
    setActiveKey,
    createThreadAt,
    addMessage,
    toggleThreadStatus,
    removeThread,
    loading,
    loadError,
  } = useThreads(sku.sku, images, username);

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const selectedImage = images[selectedImageIndex] ?? null;

  const [zoomOverlay, setZoomOverlay] =
  useState<null | { x: number; y: number; ax: number; ay: number }>(null);

  const onlineUsers = usePresence(sku.sku, username);
  const { wrapperRef, imgRef, box: imgBox, update } = useImageGeometry();

  const [tool, setTool] = useState<ParentTool>("zoom");

  // ====== Abrir zoom donde se haga click (x,y relativos al wrapper de imagen) ======
  const openZoomAtEvent = (e: React.MouseEvent) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return;
    const xPct = ((e.clientX - r.left) / r.width) * 100;
    const yPct = ((e.clientY - r.top) / r.height) * 100;
    const ax = (e.clientX - r.left) / r.width;   // [0..1]
    const ay = (e.clientY - r.top) / r.height;   // [0..1]
    setZoomOverlay({ x: xPct, y: yPct, ax, ay });
  };

  // ====== Click sobre la imagen del visor principal ======
  const handleImageClick = async (e: React.MouseEvent) => {
    if (!selectedImage?.name) return;
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;

    if (tool === "zoom") {
      openZoomAtEvent(e);
      return;
    }
    // tool === 'pin' → crear hilo
    await createThreadAt(selectedImage.name, xPct, yPct);
  };

  // ====== NAV ======
  const selectImage = (index: number) => {
    setSelectedImageIndex(index);
    setActiveThreadId(null);
    setActiveKey(null);
    requestAnimationFrame(update);
  };

  // Derivados
  const threads: AnnotationThread[] = useMemo(() => {
    if (!selectedImage?.name) return [];
    const list = annotations[selectedImage.name] || [];
    return list.filter((t) => t.status !== "deleted");
  }, [annotations, selectedImage]);

  const resolvedActiveThreadId: number | null = useMemo(() => {
    if (!selectedImage?.name) return null;
    const list = annotations[selectedImage.name] || [];
    if (activeThreadId != null && list.some((t) => t.id === activeThreadId)) return activeThreadId;
    if (activeKey) {
      const th = list.find((t) => fp(selectedImage.name!, Number(t.x), Number(t.y)) === activeKey);
      if (th) return th.id;
    }
    return null;
  }, [annotations, selectedImage, activeThreadId, activeKey]);

  const colorByStatus = (status: AnnotationThread["status"]) =>
    status === "corrected" ? "#0FA958" : status === "reopened" ? "#FFB000" : "#FF0040";

  const parentCursor = tool === "pin" ? "crosshair" : "zoom-in";

  return (
    <div className={styles.viewerContainer}>
      <div className={styles.mainViewer}>
        <div className={styles.imageHeader}>
          <h1>Revisión de SKU: {sku.sku}</h1>
          <div className={styles.imageCounter}>{selectedImageIndex + 1} de {images.length}</div>
        </div>

        <div className={styles.mainImageContainer}>
          {/* TOOLBOX del padre */}
          <div className={styles.parentToolbox} aria-label="Herramientas">
            <button
              className={`${styles.toolBtn} ${tool === "zoom" ? styles.toolActive : ""}`}
              aria-pressed={tool === "zoom"}
              title="Lupa (abrir zoom)"
              onClick={() => setTool("zoom")}
            >
              🔍
            </button>
            <button
              className={`${styles.toolBtn} ${tool === "pin" ? styles.toolActive : ""}`}
              aria-pressed={tool === "pin"}
              title="Añadir anotación"
              onClick={() => setTool("pin")}
            >
              📍
            </button>
          </div>

          <button
            className={`${styles.navButton} ${styles.navLeft}`}
            onClick={() => selectImage(selectedImageIndex - 1)}
            disabled={selectedImageIndex === 0}
            aria-label="Imagen anterior"
          >
            ‹
          </button>

          <div
            className={styles.mainImageWrapper}
            ref={wrapperRef}
            style={{ cursor: parentCursor }}
          >
            {loading && (
              <div className={styles.overlayLoader}>
                <div className={styles.loaderSpinner} />
                <div className={styles.loaderText}>Cargando anotaciones…</div>
              </div>
            )}
            {loadError && !loading && <div className={styles.overlayError}>{loadError}</div>}

            <ImageWithSkeleton
              ref={imgRef}
              src={selectedImage?.url}
              onClick={handleImageClick}
              alt={selectedImage?.name || "Imagen"}
              width={100}
              height={100}
              className={styles.mainImage}
              sizes="100vw"
              quality={100}
              minSkeletonMs={220}
              onReady={update}
              fallbackText={(selectedImage?.name || "").slice(0, 2).toUpperCase()}
            />

            {threads.map((th, index) => {
              const topPx = imgBox.offsetTop + (th.y / 100) * imgBox.height;
              const leftPx = imgBox.offsetLeft + (th.x / 100) * imgBox.width;
              const bg = colorByStatus(th.status);
              const isActive = resolvedActiveThreadId === th.id;
              return (
                <div
                  key={th.id}
                  className={`${styles.annotationNode} ${isActive ? "activeNode" : ""}`}
                  style={{
                    top: `${topPx}px`,
                    left: `${leftPx}px`,
                    background: bg,
                    boxShadow: isActive
                      ? `0 0 0 3px rgba(255,255,255,.35), 0 0 10px ${bg}`
                      : "none",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveThreadId(th.id);
                    if (selectedImage?.name) setActiveKey(fp(selectedImage.name, th.x, th.y));
                  }}
                  title={
                    th.status === "corrected"
                      ? "Corregido"
                      : th.status === "reopened"
                      ? "Reabierto"
                      : "Pendiente"
                  }
                >
                  {index + 1}
                </div>
              );
            })}
          </div>

          <button
            className={`${styles.navButton} ${styles.navRight}`}
            onClick={() => selectImage(selectedImageIndex + 1)}
            disabled={selectedImageIndex === images.length - 1}
            aria-label="Imagen siguiente"
          >
            ›
          </button>
        </div>

        <ThumbnailGrid
          images={images}
          selectedIndex={selectedImageIndex}
          onSelect={selectImage}
          annotations={annotations}
          validatedImages={{}}
        />
      </div>

      <SidePanel
        name={selectedImage?.name || ""}
        isValidated={false}
        threads={threads}
        activeThreadId={resolvedActiveThreadId}
        onValidateSku={() => {}}
        onUnvalidateSku={() => {}}
        onAddMessage={(threadId, text) => {
          if (selectedImage?.name) addMessage(selectedImage.name, threadId, text);
        }}
        onDeleteThread={(imageName: string, id: number) => {
          // Usa el nombre que te pasan, no dependas del seleccionado
          removeThread(imageName, id);
        }}
        onFocusThread={(id) => {
          setActiveThreadId(id);
          if (selectedImage?.name) {
            const t = (annotations[selectedImage.name] || []).find((x) => x.id === id);
            if (t) setActiveKey(fp(selectedImage.name, t.x, t.y));
          }
        }}
        withCorrectionsCount={0}
        validatedImagesCount={0}
        totalCompleted={0}
        totalImages={images.length}
        onlineUsers={onlineUsers}
        currentUsername={username}
        onToggleThreadStatus={(id, status) => {
          if (selectedImage?.name) toggleThreadStatus(selectedImage.name, id, status);
        }}
        loading={loading}
      />

      {zoomOverlay && selectedImage?.url && (
        <ZoomOverlay
          src={selectedImage.bigImgUrl || selectedImage.url}
          threads={threads as Thread[]}
          activeThreadId={resolvedActiveThreadId}
          onFocusThread={(id: number) => setActiveThreadId(id)}
          onAddMessage={(threadId, text) => {
            if (selectedImage?.name) addMessage(selectedImage.name, threadId, text);
          }}
          onToggleThreadStatus={(id, status) => {
            if (selectedImage?.name) toggleThreadStatus(selectedImage.name, id, status);
          }}
          onCreateThreadAt={(x, y) => {
            if (selectedImage?.name) createThreadAt(selectedImage.name, x, y);
          }}
          initial={{ xPct: zoomOverlay.x, yPct: zoomOverlay.y, zoom: 1, ax: zoomOverlay.ax, ay: zoomOverlay.ay }}
          onClose={() => setZoomOverlay(null)}
        />
      )}
    </div>
  );
}
