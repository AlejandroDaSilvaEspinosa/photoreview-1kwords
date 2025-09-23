"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ImageViewer.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThumbnailGrid from "./images/ThumbnailGrid";
import SidePanel from "./images/SidePanel";
import ZoomOverlay from "@/components/images/ZoomOverlay";

import type { ThreadStatus, SkuWithImagesAndStatus, Thread, MessageMeta, ThreadRow } from "@/types/review";

import { usePresence } from "@/lib/usePresence";
import { useImageGeometry } from "@/lib/useImageGeometry";
import { supabaseBrowser } from "@/lib/supabase/browser";

import { useThreadsStore } from "@/stores/threads";
import { useMessagesStore } from "@/stores/messages";
import type { Msg } from "@/stores/messages";
import { useWireSkuRealtime } from "@/lib/realtime/wireSkuRealtime";

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

  // STORES
  const byImage = useThreadsStore((s) => s.byImage);
  const hydrateForImage = useThreadsStore((s) => s.hydrateForImage);
  const setThreadMsgIds = useThreadsStore((s) => s.setMessageIds);
  const setThreadStatus = useThreadsStore((s) => s.setStatus);
  const createThreadOptimistic = useThreadsStore((s) => s.createOptimistic);
  const confirmCreate = useThreadsStore((s) => s.confirmCreate);
  const rollbackCreate = useThreadsStore((s) => s.rollbackCreate);
  const setActiveThreadIdStore = useThreadsStore((s) => s.setActiveThreadId);
  const pendingStatusMap = useThreadsStore((s) => s.pendingStatus);

  const setMsgsForThread   = useMessagesStore((s) => s.setForThread);
  const addOptimisticMsg   = useMessagesStore((s) => s.addOptimistic);
  const confirmMessage     = useMessagesStore((s) => s.confirmMessage);
  const moveThreadMessages = useMessagesStore((s) => s.moveThreadMessages);
  const markThreadRead     = useMessagesStore((s) => s.markThreadRead);
  const setSelfAuthId      = useMessagesStore((s) => s.setSelfAuthId);
  const msgsByThread       = useMessagesStore((s) => s.byThread);

  // Realtime
  useWireSkuRealtime(sku.sku);

  // UI state
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const selectedImage = images[selectedImageIndex] ?? null;

  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const [creatingThreadId, setCreatingThreadId] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tool, setTool] = useState<"zoom" | "pin">("zoom");
  const [showThreads, setShowThreads] = useState(true);
  const { wrapperRef, imgRef, box: imgBox, update } = useImageGeometry();
  const onlineUsers = usePresence(sku.sku, username);

  const [zoomOverlay, setZoomOverlay] =
    useState<null | { x: number; y: number; ax: number; ay: number }>(null);

  // Hidratar threads + mensajes + selfAuthId
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const sb = supabaseBrowser();
        const { data: authInfo } = await sb.auth.getUser();
        const myId = authInfo.user?.id ?? null;
        setSelfAuthId(myId);

        // 1) Threads
        const res = await fetch(`/api/reviews/${sku.sku}`, { cache: "no-store" });
        if (!res.ok) throw new Error("No se pudieron cargar las anotaciones");
        const payload: ReviewsPayload = await res.json();

        const allThreadIds: number[] = [];
        for (const img of images) {
          const name = img.name;
          if (!name) continue;

          const raw = payload[name]?.points ?? [];
          const rows: Thread[] = raw.map((t: ThreadRow) => ({
            id: t.id,
            x: round3(+t.x),
            y: round3(+t.y),
            status: t.status as ThreadStatus,
          }));

          hydrateForImage(name, rows);
          raw.forEach((r) => allThreadIds.push(r.id));
        }

        // 2) Mensajes
        if (allThreadIds.length) {
          const { data: msgs, error } = await sb
            .from("review_messages")
            .select(
              "id,thread_id,text,created_at,updated_at,created_by,created_by_username,created_by_display_name,is_system"
            )
            .in("thread_id", allThreadIds)
            .order("created_at", { ascending: true });

          if (error) throw error;

          const grouped: Record<number, Msg[]> = {};
          (msgs || []).forEach((m: any) => {
            const mine = !!myId && m.created_by === myId;
            const mm: Msg = {
              ...m,
              updated_at: m.updated_at ?? m.created_at,
              meta: { localDelivery: "sent", isMine: mine } as any,
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

    return () => {
      cancelled = true;
    };
  }, [sku.sku, images, hydrateForImage, setMsgsForThread, setThreadMsgIds, setSelfAuthId]);

   // ⌨️ Atajos de teclado globales (ignora cuando se está escribiendo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      const typing =
        el?.isContentEditable ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "select";
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (selectedImageIndex > 0) selectImage(selectedImageIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (selectedImageIndex < images.length - 1) selectImage(selectedImageIndex + 1);
      } else if (e.key === "z" || e.key === "Z") {
        setTool("zoom");
      } else if (e.key === "p" || e.key === "P") {
        setTool("pin");
      } else if (e.key === "t" || e.key === "T") {
        // 👈 toggle hilos
        setShowThreads((v) => !v);
      } else if (e.key === "Enter") {
        if (!zoomOverlay) setZoomOverlay({ x: 50, y: 50, ax: 0.5, ay: 0.5 });
      } else if (e.key === "Escape") {
        if (zoomOverlay) setZoomOverlay(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, selectedImageIndex, zoomOverlay]);

  
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
          createdByAuthId: (m as any).created_by ?? null,
          isSystem: !!m.is_system,
          meta: { localDelivery: m.meta?.localDelivery ?? "sent", isMine: (m.meta as any)?.isMine ?? false } as any,
        }));
        return { id: t.id, x: t.x, y: t.y, status: t.status, messages: list };
      });
  }, [byImage, msgsByThread, selectedImage]);

  const resolvedActiveThreadId: number | null = useMemo(() => {
    if (!activeThreadId) return null;
    if (!selectedImage?.name) return null;
    const list = byImage[selectedImage.name] || [];
    if (list.some((t) => t.id === activeThreadId)) return activeThreadId;
    if (activeKey) {
      const th = list.find((t) => fp(selectedImage.name!, Number(t.x), Number(t.y)) === activeKey);
      if (th) return th.id;
    }
    return null;
  }, [byImage, selectedImage, activeThreadId, activeKey]);

  // Crear hilo
  const createThreadAt = useCallback(
    async (imgName: string, x: number, y: number) => {
      const rx = round3(x);
      const ry = round3(y);

      const tempId = createThreadOptimistic(imgName, rx, ry);
      setCreatingThreadId(tempId);
      setActiveThreadId(tempId);
      setActiveThreadIdStore(tempId);
      setActiveKey(`${imgName}|${rx}|${ry}`);

      const sysText = `**@${username ?? "desconocido"}** ha creado un nuevo hilo de revisión.`;
      const tempMsgId = -Date.now() - Math.floor(Math.random() * 1000);

      addOptimisticMsg(tempId, tempMsgId, {
        text: sysText,
        created_at: new Date().toISOString(),
        created_by: "system",
        created_by_username: "system",
        created_by_display_name: "system",
        is_system: true,
        updated_at: new Date().toISOString(),
        meta: { localDelivery: "sent" } as MessageMeta,
      });

      const created = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: sku.sku, imageName: imgName, x: rx, y: ry }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      if (!created?.threadId) {
        rollbackCreate(tempId);
        setActiveThreadId(null);
        setActiveThreadIdStore(null);
        setCreatingThreadId(null);
        return;
      }

      const realId = created.threadId as number;

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
      setActiveThreadId((prev) => {
        const n = prev === tempId ? realId : prev;
        setActiveThreadIdStore(n ?? null);
        return n;
      });
      setCreatingThreadId(null);

      // Mensaje de sistema persistido
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
          created_at: sysCreated.created_at || sysCreated.createdAt || new Date().toISOString(),
          updated_at: sysCreated.updated_at || sysCreated.updatedAt || sysCreated.createdAt || new Date().toISOString(),
          created_by: sysCreated.created_by ?? "system",
          created_by_username: sysCreated.created_by_username ?? "system",
          created_by_display_name: sysCreated.created_by_display_name ?? "system",
          is_system: !!sysCreated.is_system,
          meta: { localDelivery: "sent" } as any,
        });
      }
    },
    [sku.sku, username, confirmCreate, rollbackCreate, addOptimisticMsg, confirmMessage, moveThreadMessages, setActiveThreadIdStore]
  );

  const addMessage = useCallback(
    async (threadId: number, text: string) => {
      if (creatingThreadId != null && threadId === creatingThreadId) return;

      const tempId = -Date.now();
      const now = new Date().toISOString();

      addOptimisticMsg(threadId, tempId, {
        text,
        created_at: now,
        updated_at: now,
        created_by: "me",
        created_by_username: username || "Tú",
        created_by_display_name: username || "Tú",
        is_system: false,
        meta: { localDelivery: "sending", isMine: true } as any,
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
          created_at: created.created_at || created.createdAt || now,
          updated_at: created.updated_at || created.updatedAt || created.createdAt || now,
          created_by: created.created_by,
          created_by_username: created.created_by_username ?? username ?? "Usuario",
          created_by_display_name: created.created_by_display_name ?? username ?? "Usuario",
          is_system: !!created.is_system,
          meta: { localDelivery: "sent", isMine: true } as any,
        });
      }
    },
    [addOptimisticMsg, confirmMessage, username, creatingThreadId]
  );

  const toggleThreadStatus = useCallback(
    async (_imgName: string, threadId: number, next: ThreadStatus) => {
      if (useThreadsStore.getState().pendingStatus.has(threadId)) return;

      const { byImage, threadToImage, beginStatusOptimistic, clearPendingStatus } = useThreadsStore.getState();
      const img = threadToImage.get(threadId) || "";
      const prev = byImage[img]?.find((t) => t.id === threadId)?.status ?? "pending";

      beginStatusOptimistic(threadId, prev, next);
      setThreadStatus(threadId, next);

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

      const ok = await fetch("/api/threads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, status: next }),
      })
        .then((r) => r.ok)
        .catch(() => false);

      if (!ok) {
        clearPendingStatus(threadId);
        setThreadStatus(threadId, prev);
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

  useEffect(() => {
    if (resolvedActiveThreadId) {
      markThreadRead(resolvedActiveThreadId).catch(() => {});
    }
  }, [resolvedActiveThreadId, markThreadRead]);



  const openZoomAtEvent = (e: React.MouseEvent) => {
    const r =
      (e.currentTarget as HTMLElement).getBoundingClientRect?.() ||
      imgRef.current?.getBoundingClientRect();
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
    setShowThreads(true)
    await createThreadAt(selectedImage.name, xPct, yPct);
  };

  const selectImage = (index: number) => {
    setSelectedImageIndex(index);
    setActiveThreadId(null);
    setActiveThreadIdStore(null);
    setActiveKey(null);
    requestAnimationFrame(update);
  };

  const parentCursor = tool === "pin" ? "crosshair" : "zoom-in";

  return (
    <div className={styles.viewerContainer}>
      <div className={styles.mainViewer}>
        <div className={styles.imageHeader}>
          <button className={styles.toolBtn} onClick={() => selectSku(null)} title="Volver">
            🏠
          </button>
          <h1 className={styles.title}>Revisión de SKU: <span className={styles.titleSku}>{sku.sku}</span></h1>
          <div className={styles.imageCounter}>
            {selectedImageIndex + 1} / {images.length}
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
            <button
              className={`${styles.toolBtn} ${showThreads ? styles.toolActive : ""}`}
              aria-pressed={showThreads}
              title={`${showThreads ? "Ocultar" : "Mostrar"} hilos — T`}
              onClick={() => setShowThreads((v) => !v)}
            >🧵</button>
          </div>

          <button
            className={`${styles.navButton} ${styles.navLeft}`}
            onClick={() => selectImage(selectedImageIndex - 1)}
            disabled={selectedImageIndex === 0}
            aria-label="Imagen anterior"
          >❮</button>

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

            {showThreads && threadsInImage.map((th, index) => {
              const topPx = imgBox.offsetTop + (th.y / 100) * imgBox.height;
              const leftPx = imgBox.offsetLeft + (th.x / 100) * imgBox.width;
              const bg = colorByStatus(th.status);
              const isActive = resolvedActiveThreadId === th.id;
              return (
                <div
                  key={th.id}
                  className={`${styles.annotationNode} ${isActive ? styles.nodeActive : ""}`}
                  style={{
                    top: `${topPx}px`,
                    left: `${leftPx}px`,
                    background: bg,
                    boxShadow: isActive ? `0 0 0 3px rgba(255,255,255,.35), 0 0 10px ${bg}` : "none",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveThreadId(th.id);
                    setActiveThreadIdStore(th.id);
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
          >❯</button>
           <div className={styles.shortcutHint} aria-hidden>
            ←/→ imagen · <b>Z</b> lupa · <b>P</b> anotar · <b>T</b> hilos on/off · <b>Enter</b> zoom · <b>Esc</b> cerrar
          </div>
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
          setActiveThreadIdStore(id);
          if (id) markThreadRead(id).catch(() => {});
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
        onToggleThreadStatus={(id: number, status: ThreadStatus) => {
          if (selectedImage?.name) toggleThreadStatus(selectedImage.name, id, status);
        }}
        loading={loading}
        /* Si tu SidePanel admite estos flags visuales, ya los tienes aquí */
        composeLocked={
          creatingThreadId != null && resolvedActiveThreadId != null && creatingThreadId === resolvedActiveThreadId
        }
        statusLocked={
          resolvedActiveThreadId != null && pendingStatusMap.has(resolvedActiveThreadId)
        }
      />

      {zoomOverlay && selectedImage?.url && (
        <ZoomOverlay
          src={selectedImage.bigImgUrl || selectedImage.url}
          threads={threadsInImage}
          activeThreadId={resolvedActiveThreadId}
          currentUsername={username}
          hideThreads={!showThreads} //
          setHideThreads={setShowThreads}
          onFocusThread={(id: number | null) => {
            setActiveThreadId(id);
            setActiveThreadIdStore(id);
            if (id) markThreadRead(id).catch(() => {});
          }}
          onAddThreadMessage={(threadId: number, text: string) => {
            if (creatingThreadId != null && threadId === creatingThreadId) return;
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
