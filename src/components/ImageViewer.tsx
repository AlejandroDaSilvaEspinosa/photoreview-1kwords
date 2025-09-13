"use client";

import React, { useEffect, useMemo, useState } from "react";
import styles from "./ImageViewer.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThumbnailGrid from "./images/ThumbnailGrid";
import SidePanel from "./images/SidePanel";
import type { AnnotationThread, AnnotationState, ImageItem } from "@/types/review";
import { usePresence } from "@/lib/usePresence";
import { useImageGeometry } from "@/lib/useImageGeometry";

/** Reviews payload: { [name]: { points?: AnnotationThread[] } } */
type ReviewsPayload = Record<string, { points?: AnnotationThread[] }>;

interface ImageViewerProps {
  sku: {
    sku: string;
    images: ImageItem[];
  };
  username?: string;
}

export default function ImageViewer({ sku, username }: ImageViewerProps) {
  const { images } = sku;
  const [annotations, setAnnotations] = useState<AnnotationState>({});
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  const selectedImage = images[selectedImageIndex] ?? null;
  const onlineUsers = usePresence(sku.sku, username);

  // 👇 usamos el hook en lugar de duplicar lógica
  const { wrapperRef, imgRef, box: imgBox, update } = useImageGeometry();

  /** Cargar anotaciones */
  useEffect(() => {
    if (!sku || images.length === 0) return;
    (async () => {
      try {
        const res = await fetch(`/api/reviews/${sku.sku}`);
        if (!res.ok) return;
        const payload: ReviewsPayload = await res.json();
        console.log(payload)
        const merged: AnnotationState = {};
        for (const img of images) {
          if (!img.name) continue;
          merged[img.name] = payload[img.name]?.points ?? [];
        }
        setAnnotations(merged);
        requestAnimationFrame(update); // recalcular geometría después
      } catch {
        /* ignorar */
      }
    })();
  }, [sku, images, update]);

  /** Añadir thread */
  const handleImageClick = async (event: React.MouseEvent) => {
    if (!selectedImage) return;
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return;

    const x = ((event.clientX - r.left) / r.width) * 100;
    const y = ((event.clientY - r.top) / r.height) * 100;

    const tempId = -Date.now();
    const newThread: AnnotationThread = { id: tempId, x, y, status: "pending", messages: [] };

    setAnnotations((prev) => ({
      ...prev,
      [selectedImage.name || ""]: [...(prev[selectedImage.name || ""] || []), newThread],
    }));
    setActiveThreadId(tempId);

    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: sku.sku, imageName: selectedImage.name, x, y }),
    }).then((r) => r.json());

    if (res?.threadId) {
      setAnnotations((prev) => ({
        ...prev,
        [selectedImage.name || ""]: (prev[selectedImage.name || ""] || []).map((t) =>
          t.id === tempId ? { ...t, id: res.threadId } : t
        ),
      }));
      setActiveThreadId(res.threadId);
    }
  };

  /** Añadir mensaje */
  const onAddMessage = async (threadId: number, text: string) => {
    if (!selectedImage?.name) return;

    const tempId = -Date.now();
    const newMsg = { id: tempId, text, createdAt: new Date().toISOString() };

    setAnnotations((prev) => ({
      ...prev,
      [selectedImage.name || ""]: (prev[selectedImage.name || ""] || []).map((t) =>
        t.id === threadId ? { ...t, messages: [...t.messages, newMsg] } : t
      ),
    }));

    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, text }),
    }).then((r) => r.json());

    if (res?.messageId) {
      setAnnotations((prev) => ({
        ...prev,
        [selectedImage.name || ""]: (prev[selectedImage.name || ""] || []).map((t) =>
          t.id === threadId
            ? { ...t, messages: t.messages.map((m) => (m.id === tempId ? { ...m, id: res.messageId } : m)) }
            : t
        ),
      }));
    }
  };

  /** Selección de imagen */
  const selectImage = (index: number) => {
    setSelectedImageIndex(index);
    setActiveThreadId(null);
    requestAnimationFrame(update);
  };

  /** Derivados */
  const threads: AnnotationThread[] = useMemo(
    () => (selectedImage ? annotations[selectedImage.name || ""] || [] : []),
    [annotations, selectedImage]
  );

  return (
    <div className={styles.viewerContainer}>
      <div className={styles.mainViewer}>
        <div className={styles.imageHeader}>
          <h1>Revisión de SKU: {sku.sku}</h1>
          <div className={styles.imageCounter}>
            {selectedImageIndex + 1} de {images.length}
          </div>
        </div>

        <div className={styles.mainImageContainer}>
          <button
            className={`${styles.navButton} ${styles.navLeft}`}
            onClick={() => selectImage(selectedImageIndex - 1)}
            disabled={selectedImageIndex === 0}
          >
            ‹
          </button>

          <div className={styles.mainImageWrapper} ref={wrapperRef}>
            <ImageWithSkeleton
              ref={imgRef}
              src={selectedImage?.url || ""}
              onClick={handleImageClick}
              alt={selectedImage?.name || ""}
              width={600}
              height={600}
              className={styles.mainImage}
              sizes="100%"
              quality={100}
              minSkeletonMs={220}
              onReady={update}
              fallbackText={selectedImage?.name?.slice(0, 2).toUpperCase()}
            />

            {threads.map((th, index) => {
              const topPx = imgBox.offsetTop + (th.y / 100) * imgBox.height;
              const leftPx = imgBox.offsetLeft + (th.x / 100) * imgBox.width;
              return (
                <div
                  key={th.id}
                  className={`${styles.annotationNode} ${activeThreadId === th.id ? "activeNode" : ""}`}
                  style={{ top: `${topPx}px`, left: `${leftPx}px` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveThreadId(th.id);
                  }}
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
        onValidateSku={() => {}}
        onUnvalidateSku={() => {}}
        onAddMessage={onAddMessage}
        onDeleteThread={() => {}}
        onFocusThread={(id) => setActiveThreadId(id)}
        withCorrectionsCount={0}
        validatedImagesCount={0}
        totalCompleted={0}
        totalImages={images.length}
        onlineUsers={onlineUsers}
        currentUsername={username}
        onToggleThreadStatus={() => {}}
      />
    </div>
  );
}
