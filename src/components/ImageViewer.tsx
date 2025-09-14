"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import styles from "./ImageViewer.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThumbnailGrid from "./images/ThumbnailGrid";
import SidePanel from "./images/SidePanel";
import type { AnnotationThread, AnnotationState, ImageItem } from "@/types/review";
import { usePresence } from "@/lib/usePresence";
import { useImageGeometry } from "@/lib/useImageGeometry";
import { useSkuChannel } from "@/lib/useSkuChannel";

type ReviewsPayload = Record<string, { points?: AnnotationThread[] }>;

interface ImageViewerProps {
  sku: { sku: string; images: ImageItem[] };
  username?: string;
}

export default function ImageViewer({ sku, username }: ImageViewerProps) {
  const { images } = sku;
  const [annotations, setAnnotations] = useState<AnnotationState>({});
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const selectedImage = images[selectedImageIndex] ?? null;

  const onlineUsers = usePresence(sku.sku, username);

  // geometría
  const { wrapperRef, imgRef, box: imgBox, update } = useImageGeometry();

  // threadId -> image_name (para ubicar mensajes entrantes)
  const threadToImage = useRef<Map<number, string>>(new Map());

  // ====== DEDUPE STATE ======
  // Huellas de hilos creados localmente: "image|x|y" (x,y redondeados) -> tempId
  const pendingThreads = useRef<Map<string, number>>(new Map());

  // fingerprint estable para un hilo
  const fp = (image: string, x: number, y: number) =>
    `${image}|${Math.round(x * 1000) / 1000}|${Math.round(y * 1000) / 1000}`;

  // ====== CARGA INICIAL ======
  useEffect(() => {
    if (!sku || images.length === 0) return;
    (async () => {
      try {
        const res = await fetch(`/api/reviews/${sku.sku}`, { cache: "no-store" });
        if (!res.ok) return;
        const payload: ReviewsPayload = await res.json();

        const merged: AnnotationState = {};
        const map = new Map<number, string>();

        for (const img of images) {
          if (!img.name) continue;
          const list = payload[img.name]?.points ?? [];
          merged[img.name] = list;
          for (const t of list) map.set(t.id, img.name);
        }
        threadToImage.current = map;
        setAnnotations(merged);
        requestAnimationFrame(update);
      } catch {
        /* ignore */
      }
    })();
  }, [sku, images, update]);

  // ====== CREAR THREAD (optimista + reconciliación) ======
  const handleImageClick = async (e: React.MouseEvent) => {
    if (!selectedImage?.name) return;

    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return;

    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;

    const tempId = -Date.now();
    const newThread: AnnotationThread = { id: tempId, x, y, status: "pending", messages: [] };

    // guardamos huella para reconciliar con realtime
    const key = fp(selectedImage.name, x, y);
    pendingThreads.current.set(key, tempId);

    setAnnotations((prev) => ({
      ...prev,
      [selectedImage.name ]: [...(prev[selectedImage.name ] || []), newThread],
    }));
    setActiveThreadId(tempId);

    // HTTP (puede llegar antes o después que realtime)
    const created = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: sku.sku, imageName: selectedImage.name, x, y }),
    })
      .then((r) => r.json())
      .catch(() => null);

      //create a message saying that a thread was created
      const sysText = `Se ha creado un nuevo hilo de revisión.`;
      if (created?.threadId) {
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: created.threadId, text: sysText }),
        })
          .then((r) => r.json())
          .catch(() => null);
      }
      

    if (created?.threadId) {
      threadToImage.current.set(created.threadId, selectedImage.name);

      setAnnotations((prev) => {
        const list = prev[selectedImage.name ] || [];
        const already = list.some((t) => t.id === created.threadId); // realtime se adelantó
        const tempExists = list.some((t) => t.id === tempId);

        let next = list;
        if (already && tempExists) {
          // ya existe el real (realtime) -> quitamos el temporal
          next = list.filter((t) => t.id !== tempId);
        } else if (!already && tempExists) {
          // no existe el real -> sustituimos el temporal por el real
          next = list.map((t) => (t.id === tempId ? { ...t, id: created.threadId } : t));
        }
        return { ...prev, [selectedImage.name]: next };
      });

      // limpiamos huella
      pendingThreads.current.delete(key);
      setActiveThreadId(created.threadId);
    }
  };

  // ====== CREAR MENSAJE (optimista + reconciliación) ======
  const onAddMessage = async (threadId: number, text: string) => {
    if (!selectedImage?.name) return;

    const imgName = selectedImage.name;
    const tempId = -Date.now();
    const newMsg = { id: tempId, text, createdAt: new Date().toISOString() };

    setAnnotations((prev) => ({
      ...prev,
      [imgName]: (prev[imgName] || []).map((t) =>
        t.id === threadId ? { ...t, messages: [...t.messages, newMsg] } : t
      ),
    }));

    const created = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, text }),
    })
      .then((r) => r.json())
      .catch(() => null);
    console.log(created)
    if (created?.id) {
      setAnnotations((prev) => {
        console.log("hasReal")
        const list = prev[imgName] || [];
        const next = list.map((t) => {
          if (t.id !== threadId) return t;
          const hasReal = t.messages.some((m) => m.id === created.id); // realtime entró antes
          if (hasReal) {
            return { ...t, messages: t.messages.filter((m) => m.id === created.id || m.id >= 0) };
          }
          return {
            ...t,
            messages: t.messages.map((m) => (m.id === tempId ? { ...m, id: created.id } : m)),
          };
        });
        return { ...prev, [imgName]: next };
      });
    }
  };

  // ====== CAMBIAR ESTADO THREAD ======
  const onToggleThreadStatus = async (
    threadId: number,
    next: "pending" | "corrected" | "reopened"
  ) => {
    const imgName = selectedImage?.name;
    if (!imgName) return;

    setAnnotations((prev) => ({
      ...prev,
      [imgName]: (prev[imgName] || []).map((t) => (t.id === threadId ? { ...t, status: next } : t)),
    }));

    fetch("/api/threads/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, status: next }),
    }).catch(() => {});

    const sysText = `El estado del hilo ha sido cambiado a "${next}".`;
    onAddMessage(threadId, sysText)
  };

  // ====== NAV ======
  const selectImage = (index: number) => {
    setSelectedImageIndex(index);
    setActiveThreadId(null);
    requestAnimationFrame(update);
  };

  // ====== REALTIME HANDLERS (con dedupe) ======
  const upsertThread = useCallback(
    (imgName: string, row: { id: number; x: number; y: number; status: AnnotationThread["status"] }) => {
      setAnnotations((prev) => {
        const curr = prev[imgName] || [];
        const exists = curr.some((t) => t.id === row.id);
        // ¿hay un temporal con misma huella?
        const key = fp(imgName, row.x, row.y);
        const tempId = pendingThreads.current.get(key);

        let next = curr;
        if (typeof tempId === "number" && curr.some((t) => t.id === tempId)) {
          // convertimos el temporal en real
          next = curr.map((t) =>
            t.id === tempId ? { ...t, id: row.id, x: row.x, y: row.y, status: row.status } : t
          );
          pendingThreads.current.delete(key);
        } else if (!exists) {
          next = [...curr, { id: row.id, x: row.x, y: row.y, status: row.status, messages: [] }];
        } else {
          next = curr.map((t) => (t.id === row.id ? { ...t, x: row.x, y: row.y, status: row.status } : t));
        }
        return { ...prev, [imgName]: next };
      });
    },
    []
  );

  const removeThread = useCallback((imgName: string, id: number) => {
    console.log("test")
    setAnnotations((prev) => {
      const curr = prev[imgName] || [];
      return { ...prev, [imgName]: curr.filter((t) => t.id !== id) };
    });
  }, []);

  const upsertMessage = useCallback(
    (imgName: string, threadId: number, msg: { id: number; text: string; createdAt: string }) => {
      setAnnotations((prev) => {
        const curr = prev[imgName] || [];
        const next = curr.map((t) =>
          t.id === threadId
            ? t.messages.some((m) => m.id === msg.id)
              ? t
              : { ...t, messages: [...t.messages, msg] }
            : t
        );
        return { ...prev, [imgName]: next };
      });
    },
    []
  );

  const removeMessage = useCallback((imgName: string, threadId: number, messageId: number) => {
    setAnnotations((prev) => {
      const curr = prev[imgName] || [];
      const next = curr.map((t) =>
        t.id === threadId ? { ...t, messages: t.messages.filter((m) => m.id !== messageId) } : t
      );
      return { ...prev, [imgName]: next };
    });
  }, []);

  useSkuChannel(sku.sku, {
    onThreadInsert: (t) => {
      threadToImage.current.set(t.id, t.image_name);
      upsertThread(t.image_name, t);
    },
    onThreadUpdate: (t) => {
      threadToImage.current.set(t.id, t.image_name);
      upsertThread(t.image_name, t);
    },
    onThreadDelete: (t) => {
      const imgName = threadToImage.current.get(t.id) || t.image_name;
      if (!imgName) return;
      threadToImage.current.delete(t.id);
      removeThread(imgName, t.id);
    },
    onMessageInsert: (m) => {
      const imgName = threadToImage.current.get(m.thread_id);
      if (!imgName) return;
      upsertMessage(imgName, m.thread_id, { id: m.id, text: m.text, createdAt: m.created_at });
    },
    onMessageUpdate: (m) => {
      const imgName = threadToImage.current.get(m.thread_id);
      if (!imgName) return;
      upsertMessage(imgName, m.thread_id, { id: m.id, text: m.text, createdAt: m.created_at });
    },
    onMessageDelete: (m) => {
      const imgName = threadToImage.current.get(m.thread_id);
      if (!imgName) return;
      removeMessage(imgName, m.thread_id, m.id);
    },
  });

  // ====== DERIVADOS ======
  const threads: AnnotationThread[] = useMemo(
    () => (selectedImage ? annotations[selectedImage.name ] || [] : []),
    [annotations, selectedImage]
  );

  return (
    <div className={styles.viewerContainer}>
      <div className={styles.mainViewer}>
        <div className={styles.imageHeader}>
          <h1>Revisión de SKU: {sku.sku}</h1>
          <div className={styles.imageCounter}>{selectedImageIndex + 1} de {images.length}</div>
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
              src={selectedImage?.url }
              onClick={handleImageClick}
              alt={selectedImage?.name }
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
        name={selectedImage?.name }
        isValidated={false}
        threads={threads}
        onValidateSku={() => {}}
        onUnvalidateSku={() => {}}
        onAddMessage={onAddMessage}
        onDeleteThread={removeThread}
        onFocusThread={(id) => setActiveThreadId(id)}
        withCorrectionsCount={0}
        validatedImagesCount={0}
        totalCompleted={0}
        totalImages={images.length}
        onlineUsers={onlineUsers}
        currentUsername={username}
        onToggleThreadStatus={onToggleThreadStatus}
      />
    </div>
  );
}
