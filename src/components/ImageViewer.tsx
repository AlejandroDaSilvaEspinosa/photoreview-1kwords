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
import ZoomOverlay from "@/components/images/ZoomOverlay";

type ReviewsPayload = Record<string, { points?: AnnotationThread[] }>;

interface ImageViewerProps {
  sku: { sku: string; images: ImageItem[] };
  username?: string;
}

type AnyStatus = AnnotationThread["status"];
type ParentTool = "zoom" | "pin";

export default function ImageViewer({ sku, username }: ImageViewerProps) {
  const { images } = sku;

  const [annotations, setAnnotations] = useState<AnnotationState>({});
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const selectedImage = images[selectedImageIndex] ?? null;

  const [zoomOverlay, setZoomOverlay] = useState<null | { x: number; y: number }>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const onlineUsers = usePresence(sku.sku, username);
  const { wrapperRef, imgRef, box: imgBox, update } = useImageGeometry();

  const threadToImage = useRef<Map<number, string>>(new Map());
  const pendingThreads = useRef<Map<string, { tempId: number; imgName: string }>>(new Map());

  // toolbox en el padre
  const [tool, setTool] = useState<ParentTool>("zoom");

  const fp = (image: string, x: number, y: number) =>
    `${image}|${Math.round(x * 1000) / 1000}|${Math.round(y * 1000) / 1000}`;

  // ====== CARGA INICIAL ======
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/reviews/${sku.sku}`, { cache: "no-store" });
        if (!res.ok) throw new Error("No se pudieron cargar las anotaciones");
        const payload: ReviewsPayload = await res.json();

        const merged: AnnotationState = {};
        const map = new Map<number, string>();

        for (const img of images) {
          if (!img.name) continue;
          const list = payload[img.name]?.points ?? [];
          merged[img.name] = list;
          for (const t of list) map.set(t.id, img.name);
        }
        if (!cancelled) {
          threadToImage.current = map;
          setAnnotations(merged);
          requestAnimationFrame(update);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Error de carga");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (images.length > 0) run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku, images]);

  // ====== HELPER: crear hilo en (xPct, yPct) ======
  const createThreadAt = useCallback(
    async (imgName: string, x: number, y: number) => {
      const tempId = -Date.now();
      const key = fp(imgName, x, y);

      const sysText = `**@${username ?? "usuario"}** ha creado un nuevo hilo de revisión.`;
      const sysOptimisticMsg = {
        id: tempId,
        text: sysText,
        createdAt: new Date().toISOString(),
        createdByName: "system",
        isSystem: true,
      };
      const tempThread: AnnotationThread = { id: tempId, x, y, status: "pending", messages: [sysOptimisticMsg] };

      setAnnotations((prev) => ({ ...prev, [imgName]: [...(prev[imgName] || []), tempThread] }));
      setActiveThreadId(tempId);
      setActiveKey(key);
      pendingThreads.current.set(key, { tempId, imgName });

      const created = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: sku.sku, imageName: imgName, x, y }),
      }).then((r) => r.json()).catch(() => null);

      if (created?.threadId) {
        const realId = created.threadId;
        threadToImage.current.set(realId, imgName);
        setActiveThreadId((prev) => (prev === tempId ? realId : prev));

        setAnnotations((prev) => {
          const list = prev[imgName] || [];
          const alreadyReal = list.some((t) => t.id === realId);
          if (alreadyReal) return { ...prev, [imgName]: list.filter((t) => t.id !== tempId) };
          return { ...prev, [imgName]: list.map((t) => (t.id === tempId ? { ...t, id: realId } : t)) };
        });

        const sysSaved = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: realId, text: sysText, isSystem: true }),
        }).then((r) => r.json()).catch(() => null);

        if (sysSaved?.id) {
          setAnnotations((prev) => {
            const list = prev[imgName] || [];
            const next = list.map((t) => {
              if (t.id !== realId) return t;
              const exists = t.messages.some((m) => m.id === sysSaved.id);
              const msgsBase = exists
                ? t.messages
                : [
                    ...t.messages,
                    {
                      id: sysSaved.id,
                      text: sysSaved.text ?? sysText,
                      createdAt: sysSaved.createdAt ?? new Date().toISOString(),
                      createdByName: sysSaved.createdByName || "system",
                      isSystem: true,
                    },
                  ];
              const msgs = msgsBase.filter((m) => !(m.id < 0 && m.isSystem && m.text === sysText));
              return { ...t, messages: msgs };
            });
            return { ...prev, [imgName]: next };
          });
        }
        pendingThreads.current.delete(key);
      } else {
        // revert
        setAnnotations((prev) => {
          const list = prev[imgName] || [];
          return { ...prev, [imgName]: list.filter((t) => t.id !== tempId) };
        });
        pendingThreads.current.delete(key);
        setActiveThreadId((prev) => (prev === tempId ? null : prev));
        setActiveKey((prev) => (prev === key ? null : prev));
      }
    },
    [sku.sku, username]
  );

  // ====== Abrir zoom donde se haga click (x,y relativos al wrapper de imagen) ======
  const openZoomAtEvent = (e: React.MouseEvent) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return;
    const xPct = ((e.clientX - r.left) / r.width) * 100;
    const yPct = ((e.clientY - r.top) / r.height) * 100;
    setZoomOverlay({ x: xPct, y: yPct });
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

  // ====== Mensajes ======
  const onAddMessage = async (threadId: number, text: string) => {
    if (!selectedImage?.name) return;
    const imgName = selectedImage.name;

    const tempId = -Date.now();
    const optimistic = {
      id: tempId, text,
      createdAt: new Date().toISOString(),
      createdByName: username || "Yo",
      isSystem: false,
    };

    setAnnotations((prev) => ({
      ...prev,
      [imgName]: (prev[imgName] || []).map((t) => (t.id === threadId ? { ...t, messages: [...t.messages, optimistic] } : t)),
    }));

    const created = await fetch("/api/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, text }),
    }).then((r) => r.json()).catch(() => null);

    if (created?.id) {
      const createdByName = created.createdByName || username || "Usuario";
      setAnnotations((prev) => {
        const list = prev[imgName] || [];
        const next = list.map((t) => {
          if (t.id !== threadId) return t;
          const already = t.messages.some((m) => m.id === created.id);
          if (already) return { ...t, messages: t.messages.filter((m) => m.id !== tempId) };
          return {
            ...t,
            messages: t.messages.map((m) =>
              m.id === tempId
                ? { ...m, id: created.id, createdAt: created.createdAt || m.createdAt, createdByName, isSystem: !!created.isSystem }
                : m
            ),
          };
        });
        return { ...prev, [imgName]: next };
      });
    }
  };

  // ====== Cambiar estado ======
  const onToggleThreadStatus = async (
    threadId: number,
    next: "pending" | "corrected" | "reopened" | "deleted"
  ) => {
    const imgName = selectedImage?.name;
    if (!imgName) return;

    const prevStatus =
      (annotations[imgName]?.find((t) => t.id === threadId)?.status as AnnotationThread["status"]) ?? "pending";

    setAnnotations((prev) => ({
      ...prev,
      [imgName]: (prev[imgName] || []).map((t) => (t.id === threadId ? { ...t, status: next } : t)),
    }));

    const res = await fetch("/api/threads/status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, status: next }),
    });

    if (!res.ok) {
      setAnnotations((prev) => ({
        ...prev,
        [imgName]: (prev[imgName] || []).map((t) => (t.id === threadId ? { ...t, status: prevStatus } : t)),
      }));
      return;
    }

    const payload = await res.json().catch(() => null);
    const sys = payload?.message as { id: number; text: string; createdAt: string; createdByName?: string } | undefined;

    if (sys?.id) {
      setAnnotations((prev) => {
        const list = prev[imgName] || [];
        const nextList = list.map((t) =>
          t.id === threadId
            ? t.messages.some((m) => m.id === sys.id)
              ? t
              : { ...t, messages: [...t.messages, { id: sys.id, text: sys.text, createdAt: sys.createdAt, createdByName: sys.createdByName || "Sistema", isSystem: true }] }
            : t
        );
        return { ...prev, [imgName]: nextList };
      });
    }
  };

  // ====== Borrado lógico rápido ======
  const removeThread = useCallback(async (imgName: string, id: number) => {
    setAnnotations((prev) => {
      const curr = prev[imgName] || [];
      return { ...prev, [imgName]: curr.filter((t) => t.id !== id) };
    });
    setActiveThreadId((prev) => (prev === id ? null : prev));
    await fetch(`/api/threads/status`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: id, status: "deleted" }),
    }).catch(() => {});
  }, []);

  // ====== NAV ======
  const selectImage = (index: number) => {
    setSelectedImageIndex(index);
    setActiveThreadId(null);
    setActiveKey(null);
    requestAnimationFrame(update);
  };

  // ====== REALTIME ======
  const upsertThread = useCallback((imgName: string, row: { id: number; x: number; y: number; status: AnyStatus }) => {
    if (row.status === "deleted") {
      setAnnotations((prev) => {
        const curr = prev[imgName] || [];
        if (!curr.some((t) => t.id === row.id)) return prev;
        return { ...prev, [imgName]: curr.filter((t) => t.id !== row.id) };
      });
      setActiveThreadId((prev) => (prev === row.id ? null : prev));
      return;
    }

    const key = fp(imgName, row.x, row.y);
    const pending = pendingThreads.current.get(key);

    if (pending) {
      setActiveThreadId((prev) => (prev === pending.tempId ? row.id : prev));
      setAnnotations((prev) => {
        const curr = prev[imgName] || [];
        const next = curr.map((t) =>
          t.id === pending.tempId ? { ...t, id: row.id, x: row.x, y: row.y, status: row.status as AnnotationThread["status"] } : t
        );
        return { ...prev, [imgName]: next };
      });
      pendingThreads.current.delete(key);
      return;
    }

    setAnnotations((prev) => {
      const curr = prev[imgName] || [];
      if (curr.some((t) => t.id === row.id)) {
        const next = curr.map((t) =>
          t.id === row.id ? { ...t, x: row.x, y: row.y, status: row.status as AnnotationThread["status"] } : t
        );
        return { ...prev, [imgName]: next };
      }
      return { ...prev, [imgName]: [...curr, { id: row.id, x: row.x, y: row.y, status: row.status as AnnotationThread["status"], messages: [] }] };
    });
  }, []);

  const upsertMessage = useCallback((imgName: string, threadId: number, msg: { id: number; text: string; createdAt: string; createdByName?: string; isSystem?: boolean }) => {
    setAnnotations((prev) => {
      const curr = prev[imgName] || [];
      const next = curr.map((t) => {
        if (t.id !== threadId) return t;
        const cleaned = (t.messages || []).filter((m) => !(m.id < 0 && m.isSystem && msg.isSystem && m.text === msg.text));
        const already = cleaned.some((m) => m.id === msg.id);
        return already ? { ...t, messages: cleaned } : { ...t, messages: [...cleaned, msg] };
      });
      return { ...prev, [imgName]: next };
    });
  }, []);

  const removeMessage = useCallback((imgName: string, threadId: number, messageId: number) => {
    setAnnotations((prev) => {
      const curr = prev[imgName] || [];
      const next = curr.map((t) => (t.id === threadId ? { ...t, messages: t.messages.filter((m) => m.id !== messageId) } : t));
      return { ...prev, [imgName]: next };
    });
  }, []);

  const channelHandlers = useMemo(() => ({
    onThreadInsert: (t: any) => { if (t?.id && t?.image_name) threadToImage.current.set(t.id, t.image_name); upsertThread(t.image_name, t); },
    onThreadUpdate: (t: any) => { if (t?.id && t?.image_name) threadToImage.current.set(t.id, t.image_name); upsertThread(t.image_name, t); },
    onThreadDelete: (t: any) => {
      const imgName = threadToImage.current.get(t.id) || t.image_name;
      if (!imgName) return;
      setAnnotations((prev) => {
        const curr = prev[imgName] || [];
        return { ...prev, [imgName]: curr.filter((x) => x.id !== t.id) };
      });
      setActiveThreadId((prev) => (prev === t.id ? null : prev));
    },
    onMessageInsert: (m: any) => {
      const imgName = threadToImage.current.get(m.thread_id);
      if (!imgName) return;
      const createdByName = m.created_by_display_name || m.created_by_username || "Usuario";
      upsertMessage(imgName, m.thread_id, { id: m.id, text: m.text, createdAt: m.created_at, createdByName, isSystem: !!m.is_system });
    },
    onMessageUpdate: (m: any) => {
      const imgName = threadToImage.current.get(m.thread_id);
      if (!imgName) return;
      const createdByName = m.created_by_display_name || m.created_by_username || "Usuario";
      upsertMessage(imgName, m.thread_id, { id: m.id, text: m.text, createdAt: m.created_at, createdByName, isSystem: !!m.is_system });
    },
    onMessageDelete: (m: any) => {
      const imgName = threadToImage.current.get(m.thread_id);
      if (!imgName) return;
      removeMessage(imgName, m.thread_id, m.id);
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [upsertThread, upsertMessage, removeMessage]);

  useSkuChannel(sku.sku, channelHandlers);

  // ====== Derivados ======
  const threads: AnnotationThread[] = useMemo(
    () => (selectedImage ? (annotations[selectedImage.name] || []).filter((t) => (t as any).status !== "deleted") : []),
    [annotations, selectedImage]
  );

  const resolvedActiveThreadId: number | null = useMemo(() => {
    if (!selectedImage) return null;
    const list = annotations[selectedImage.name] || [];
    if (activeThreadId != null && list.some((t) => t.id === activeThreadId)) return activeThreadId;
    if (activeKey) {
      const th = list.find((t) => fp(selectedImage.name!, t.x, t.y) === activeKey);
      if (th) return th.id;
    }
    return null;
  }, [annotations, selectedImage, activeThreadId, activeKey]);

  const colorByStatus = (status: AnnotationThread["status"]) =>
    status === "corrected" ? "#0FA958" : status === "reopened" ? "#FFB000" : "#FF0040";

  // cursor del visor principal según herramienta
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
          >‹</button>

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
              alt={selectedImage?.name}
              width={100}
              height={100}
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
                    boxShadow: isActive ? `0 0 0 3px rgba(255,255,255,.35), 0 0 10px ${bg}` : "none",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveThreadId(th.id);
                    if (selectedImage?.name) setActiveKey(fp(selectedImage.name, th.x, th.y));
                  }}
                  title={th.status === "corrected" ? "Corregido" : th.status === "reopened" ? "Reabierto" : "Pendiente"}
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
          >›</button>
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
        onAddMessage={onAddMessage}
        onDeleteThread={removeThread}
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
        onToggleThreadStatus={onToggleThreadStatus}
        loading={loading}
      />

      {zoomOverlay && selectedImage?.url && (
        <ZoomOverlay
          src={selectedImage.bigImgUrl || selectedImage.url}
          threads={threads as any}
          activeThreadId={activeThreadId}
          onFocusThread={(id: number) => setActiveThreadId(id)}
          onAddMessage={onAddMessage}
          onToggleThreadStatus={onToggleThreadStatus}
          onCreateThreadAt={(x, y) => {
            if (!selectedImage?.name) return;
            createThreadAt(selectedImage.name, x, y);
          }}
          onClose={() => setZoomOverlay(null)}
          initial={{ xPct: zoomOverlay.x, yPct: zoomOverlay.y, zoom: 1 }}
        />
      )}
    </div>
  );
}
