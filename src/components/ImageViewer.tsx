// src/components/ImageViewer.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ImageViewer.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThumbnailGrid from "./images/ThumbnailGrid";
import SidePanel from "./images/SidePanel";
import ZoomOverlay from "@/components/images/ZoomOverlay";

import type { ThreadStatus, SkuWithImagesAndStatus, Thread, MessageMeta } from "@/types/review";
import type { ThreadRow } from "@/lib/supabase";

import { usePresence } from "@/lib/usePresence";
import { useImageGeometry } from "@/lib/useImageGeometry";

// 🔌 Stores + realtime
import { useThreadsStore } from "@/stores/threads";
import { useMessagesStore } from "@/stores/messages";
import type { Msg } from "@/stores/messages";
import { useWireSkuRealtime } from "@/lib/realtime/wireSkuRealtime";

// ===== helpers =====
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const fp = (image: string, x: number, y: number) => `${image}|${round3(x)}|${round3(y)}`;
const colorByStatus = (s: ThreadStatus) =>
  s === "corrected" ? "#0FA958" : s === "reopened" ? "#FFB000" : "#FF0040";
const STATUS_LABEL: Record<ThreadStatus, string> = {
  pending: "Pendiente",
  corrected: "Corregido",
  reopened: "Reabierto",
  deleted: "Eliminado",
};

type ReviewsPayload = Record<string, { points?: ThreadRow[]; messagesByThread?: Record<number, any[]> }>;

interface ImageViewerProps {
  sku: SkuWithImagesAndStatus;
  username: string;
  selectSku: (sku: SkuWithImagesAndStatus | null) => void;
}

export default function ImageViewer({ sku, username, selectSku }: ImageViewerProps) {
  const { images } = sku;

  // ========= STORES & REALTIME =========
  const byImage = useThreadsStore((s) => s.byImage);
  const hydrateForImage = useThreadsStore((s) => s.hydrateForImage);
  const setThreadMsgIds = useThreadsStore((s) => s.setMessageIds);
  const setThreadStatus = useThreadsStore((s) => s.setStatus);
  const createThreadOptimistic = useThreadsStore((s) => s.createOptimistic)
  const confirmCreate = useThreadsStore((s) => s.confirmCreate);
  const rollbackCreate = useThreadsStore((s) => s.rollbackCreate);

  const setMsgsForThread   = useMessagesStore((s) => s.setForThread);
  const addOptimisticMsg   = useMessagesStore((s) => s.addOptimistic);
  const confirmMessage     = useMessagesStore((s) => s.confirmMessage);
  const moveThreadMessages = useMessagesStore((s) => s.moveThreadMessages);
  const markThreadRead     = useMessagesStore((s) => s.markThreadRead);
  const msgsByThread       = useMessagesStore((s) => s.byThread);

  // suscripción realtime para este SKU
  useWireSkuRealtime(sku.sku);

  // ========= estado local UI =========
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const selectedImage = images[selectedImageIndex] ?? null;

  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tool, setTool] = useState<"zoom" | "pin">("zoom");
  const { wrapperRef, imgRef, box: imgBox, update } = useImageGeometry();
  const onlineUsers = usePresence(sku.sku, username);

  // ========= hidratar stores (threads + mensajes) =========
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // 1) Cargamos threads por imagen
        const res = await fetch(`/api/reviews/${sku.sku}`, { cache: "no-store" });
        if (!res.ok) throw new Error("No se pudieron cargar las anotaciones");
        const payload: ReviewsPayload = await res.json();

        const allThreadIds: number[] = [];

        for (const img of images) {
          const name = img.name;
          if (!name) continue;

          const raw = payload[name]?.points ?? [];
          // 👇 mapea SOLO a la forma Thread (sin props extra)
          const rows: Thread[] = raw.map((t: ThreadRow) => ({
            id: t.id,
            x: round3(+t.x),
            y: round3(+t.y),
            status: t.status as ThreadStatus,
          }));

          hydrateForImage(name, rows);
          raw.forEach((r) => allThreadIds.push(r.id)); // usa ids reales de la respuesta
        }

        // 2) Cargamos MENSAJES en un solo query por todos los thread_id
        if (allThreadIds.length) {
          const sb = (await import("@/lib/supabase")).supabaseBrowser();
          const { data: msgs, error } = await sb
            .from("review_messages")
            .select(
              "id,thread_id,text,created_at,updated_at,created_by,created_by_username,created_by_display_name,is_system"
            )
            .in("thread_id", allThreadIds)
            .order("created_at", { ascending: true });

          if (error) throw error;

          // 3) Agrupar por thread_id y volcar en la store
          const grouped: Record<number, Msg[]> = {};
          (msgs || []).forEach((m: any) => {
            const mm: Msg = {
              ...m,
              // por si updated_at viene null
              updated_at: m.updated_at ?? m.created_at,
              meta: { localDelivery: "sent"} as MessageMeta,
            };
            (grouped[m.thread_id] ||= []).push(mm);
          });

          for (const tidStr of Object.keys(grouped)) {
            const tid = Number(tidStr);
            setMsgsForThread(tid, grouped[tid]);
            setThreadMsgIds(tid, grouped[tid].map((x) => x.id));
          }
        }
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || "Error de carga");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sku.sku, images, hydrateForImage, setMsgsForThread, setThreadMsgIds]);

  // ========= derivados para la UI =========
  const threadsInImage: Thread[] = useMemo(() => {
    if (!selectedImage?.name) return [];
    const rows = byImage[selectedImage.name] || [];
    return rows
      .filter((t) => t.status !== "deleted")
      .map((t) => {
        const list = (msgsByThread[t.id] || []).map((m) => ({
          id: m.id,
          text: m.text,
          createdAt: m.created_at,
          createdByName: m.created_by_display_name || m.created_by_username || "Usuario",
          isSystem: !!m.is_system,
          meta: { localDelivery: m.meta?.localDelivery ?? "sent" } as MessageMeta,
        }));
        return { id: t.id, x: t.x, y: t.y, status: t.status, messages: list };
      });
  }, [byImage, msgsByThread, selectedImage]);

  const resolvedActiveThreadId: number | null = useMemo(() => {
    if (!selectedImage?.name) return null;
    const list = byImage[selectedImage.name] || [];
    if (list.some((t) => t.id === activeThreadId)) return activeThreadId;
    if (activeKey) {
      const th = list.find((t) => fp(selectedImage.name!, Number(t.x), Number(t.y)) === activeKey);
      if (th) return th.id;
    }
    return null;
  }, [byImage, selectedImage, activeThreadId, activeKey]);

  // ========= acciones =========

  const createThreadAt = useCallback(
    async (imgName: string, x: number, y: number) => {
      const rx = round3(x);
      const ry = round3(y);

      // 1) Hilo optimista (usa el helper que devuelve el tempId real)
      const tempId = createThreadOptimistic(imgName, rx, ry);
      setActiveThreadId(tempId);
      setActiveKey(`${imgName}|${rx}|${ry}`);

      // 2) Mensaje de sistema optimista
      const sysText = `**@${username ?? "usuario"}** ha creado un nuevo hilo de revisión.`;
      const tempMsgId = -Date.now() - Math.floor(Math.random() * 1000);

      addOptimisticMsg(tempId, tempMsgId, {
        text: sysText,
        created_at: new Date().toISOString(),
        created_by: "system",
        created_by_username: "system",
        created_by_display_name: "system",
        is_system: true,
        updated_at: new Date().toISOString(),
        meta: { localDelivery: "sent" } as MessageMeta
      });

      // 3) POST → hilo real
      const created = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: sku.sku, imageName: imgName, x: rx, y: ry }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      if (!created?.threadId) {
        rollbackCreate(tempId);
        return;
      }

      const realId = created.threadId as number;

      // 4) Confirmar hilo y mover mensajes temp -> real
      const realRow: ThreadRow = {
        id: realId,
        sku: sku.sku,
        image_name: imgName,
        x: rx,
        y: ry,
        status: "pending",
      } as any;

      confirmCreate(tempId, realRow);
      moveThreadMessages(tempId, realId);
      setActiveThreadId((prev) => (prev === tempId ? realId : prev));

      // 5) Persistir mensaje de sistema y confirmar el optimista
      const sysCreated = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: realId, text: sysText, isSystem: true }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      if (sysCreated?.id) {
        confirmMessage(realId, tempMsgId, {
          id: sysCreated.id,
          thread_id: realId,
          text: sysText,
          created_at: sysCreated.createdAt || new Date().toISOString(),
          updated_at: sysCreated.updatedAt || sysCreated.createdAt || new Date().toISOString(),
          created_by: "system",
          created_by_username: "system",
          created_by_display_name: "system",
          is_system: true,
          meta: { localDelivery: "sent" },
        });
      }
    },
    [sku.sku, username, confirmCreate, rollbackCreate, addOptimisticMsg, confirmMessage, moveThreadMessages]
  );

  const addMessage = useCallback(
    async (threadId: number, text: string) => {
      const tempId = -Date.now();
      addOptimisticMsg(threadId, tempId, {
        text,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: username,
        created_by_username: username || "Tú",
        created_by_display_name: username || "Tú",
        is_system: false,
        meta: { localDelivery: "sending" },
      });

      const created = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, text }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      if (created?.id) {
        confirmMessage(threadId, tempId, {
          id: created.id,
          thread_id: threadId,
          text,
          created_at: created.createdAt || new Date().toISOString(),
          updated_at: created.updatedAt || created.createdAt || new Date().toISOString(),
          created_by: created.createdBy || username,
          created_by_username: created.createdByName || username || "Usuario",
          created_by_display_name: created.createdByName || username || "Usuario",
          is_system: !!created.isSystem,
          meta: { localDelivery: "sent" },
        });
      }
    },
    [addOptimisticMsg, confirmMessage, username]
  );

  const toggleThreadStatus = useCallback(
    async (_imgName: string, threadId: number, next: ThreadStatus) => {
      // 0) lee el estado anterior para poder revertir si falla
      const { byImage, threadToImage } = useThreadsStore.getState();
      const img = threadToImage.get(threadId) || "";
      const prev = byImage[img]?.find((t) => t.id === threadId)?.status ?? "pending";

      // 1) Optimista: cambiar estado del hilo en la UI
      setThreadStatus(threadId, next);

      // 2) Optimista: añadir mensaje de sistema
      const tempId = -Math.floor(Math.random() * 1e9) - 1;
      const sysText = `**@${username ?? "usuario"}** cambió el estado del hilo a "**${STATUS_LABEL[next]}**".`;

      addOptimisticMsg(threadId, tempId, {
        text: sysText,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: "system",
        created_by_username: "system",
        created_by_display_name: "Sistema",
        is_system: true,
        meta: { localDelivery: "sending" } as MessageMeta,
      });

      // 3) Llamada al backend
      const ok = await fetch("/api/threads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, status: next }),
      })
        .then((r) => r.ok)
        .catch(() => false);

      if (!ok) {
        // 4) Revertir si falla
        setThreadStatus(threadId, prev);
        // (opcional) eliminar/invalidar optimista
        return;
      }
    },
    [setThreadStatus, addOptimisticMsg, username]
  );

  const removeThread = useCallback(async (id: number) => {
    setThreadStatus(id, "deleted");
    await fetch(`/api/threads/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: id, status: "deleted" as ThreadStatus }),
    }).catch(() => {});
  }, [setThreadStatus]);

  // marcar lectura cuando se enfoca un hilo
  useEffect(() => {
    if (resolvedActiveThreadId && username) {
      markThreadRead(resolvedActiveThreadId, username).catch(() => {});
    }
  }, [resolvedActiveThreadId, username, markThreadRead]);

  // ========= UI handlers =========
  const [zoomOverlay, setZoomOverlay] =
    useState<null | { x: number; y: number; ax: number; ay: number }>(null);

  const openZoomAtEvent = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect?.() || imgRef.current?.getBoundingClientRect();
    if (!r) return;
    const xPct = ((e.clientX - r.left) / r.width) * 100;
    const yPct = ((e.clientY - r.top) / r.height) * 100;
    const ax = (e.clientX - r.left) / r.width;
    const ay = (e.clientY - r.top) / r.height;
    setZoomOverlay({ x: xPct, y: yPct, ax, ay });
  };

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
    await createThreadAt(selectedImage.name, xPct, yPct);
  };

  const selectImage = (index: number) => {
    setSelectedImageIndex(index);
    setActiveThreadId(null);
    setActiveKey(null);
    requestAnimationFrame(update);
  };

  const parentCursor = tool === "pin" ? "crosshair" : "zoom-in";

  return (
    <div className={styles.viewerContainer}>
      <div className={styles.mainViewer}>
        <div className={styles.imageHeader}>
          <button className={styles.toolBtn} onClick={() => selectSku(null)}>🏠</button>
          <h1>Revisión de SKU: {sku.sku}</h1>
          <div className={styles.imageCounter}>
            {selectedImageIndex + 1} de {images.length}
          </div>
        </div>

        <div className={styles.mainImageContainer}>
          <div className={styles.parentToolbox} aria-label="Herramientas">
            <button
              className={`${styles.toolBtn} ${tool === "zoom" ? styles.toolActive : ""}`}
              aria-pressed={tool === "zoom"}
              title="Lupa (abrir zoom)"
              onClick={() => setTool("zoom")}
            >🔍</button>
            <button
              className={`${styles.toolBtn} ${tool === "pin" ? styles.toolActive : ""}`}
              aria-pressed={tool === "pin"}
              title="Añadir nuevo hilo"
              onClick={() => setTool("pin")}
            >📍</button>
          </div>

          <button
            className={`${styles.navButton} ${styles.navLeft}`}
            onClick={() => selectImage(selectedImageIndex - 1)}
            disabled={selectedImageIndex === 0}
            aria-label="Imagen anterior"
          >‹</button>

          <div className={styles.mainImageWrapper} ref={wrapperRef} style={{ cursor: parentCursor }}>
            {loading && (
              <div className={styles.overlayLoader}>
                <div className={styles.loaderSpinner} />
                <div className={styles.loaderText}>Cargando anotaciones…</div>
              </div>
            )}
            {loadError && !loading && <div className={styles.overlayError}>{loadError}</div>}

            <ImageWithSkeleton
              priority
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

            {threadsInImage.map((th, index) => {
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
          >›</button>
        </div>

        <ThumbnailGrid
          images={images}
          selectedIndex={selectedImageIndex}
          onSelect={selectImage}
          threads={Object.fromEntries(
            images.map((img) => [img.name, (byImage[img.name] || []).map((t) => ({ ...t, messages: [] }))])
          )}
          validatedImages={{}}
        />
      </div>

      <SidePanel
        name={selectedImage?.name || ""}
        isValidated={false}
        threads={threadsInImage}
        activeThreadId={resolvedActiveThreadId}
        onValidateSku={() => {}}
        onUnvalidateSku={() => {}}
        onAddThreadMessage={(threadId: number, text: string) => {
          if (selectedImage?.name) addMessage(threadId, text);
        }}
        onDeleteThread={(id: number) => removeThread(id)}
        onFocusThread={(id: number | null) => {
          setActiveThreadId(id);
          if (id && username) markThreadRead(id, username).catch(() => {});
          if (selectedImage?.name && id) {
            const t = (byImage[selectedImage.name] || []).find((x) => x.id === id);
            if (t) setActiveKey(fp(selectedImage.name, t.x, t.y));
          }
        }}
        withCorrectionsCount={0}
        validatedImagesCount={0}
        totalCompleted={0}
        totalImages={images.length}
        onlineUsers={onlineUsers}
        currentUsername={username}
        onToggleThreadStatus={(id: number, status: ThreadStatus) => {
          if (selectedImage?.name) toggleThreadStatus(selectedImage.name, id, status);
        }}
        loading={loading}
      />

      {zoomOverlay && selectedImage?.url && (
        <ZoomOverlay
          src={selectedImage.bigImgUrl || selectedImage.url}
          threads={threadsInImage}
          activeThreadId={resolvedActiveThreadId}
          currentUsername={username}
          onFocusThread={(id: number | null) => {
            setActiveThreadId(id);
            if (id && username) markThreadRead(id, username).catch(() => {});
          }}
          onAddThreadMessage={(threadId: number, text: string) => {
            if (selectedImage?.name) addMessage(threadId, text);
          }}
          onToggleThreadStatus={(id, status) => {
            if (selectedImage?.name) toggleThreadStatus(selectedImage.name, id, status);
          }}
          onCreateThreadAt={(x, y) => {
            if (selectedImage?.name) createThreadAt(selectedImage.name, x, y);
          }}
          onDeleteThread={(id: number) => {
            if (selectedImage?.name) removeThread(id);
          }}
          initial={{ xPct: zoomOverlay.x, yPct: zoomOverlay.y, zoom: 1, ax: zoomOverlay.ax, ay: zoomOverlay.ay }}
          onClose={() => setZoomOverlay(null)}
        />
      )}
    </div>
  );
}
