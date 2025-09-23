"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ImageViewer.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThumbnailGrid from "./images/ThumbnailGrid";
import SidePanel from "./images/SidePanel";
import ZoomOverlay from "@/components/images/ZoomOverlay";

import type {
  ThreadStatus,
  SkuWithImagesAndStatus,
  Thread,
  MessageMeta,
  ThreadRow,
  ThreadMessage,
  DeliveryState,
} from "@/types/review";

import { usePresence } from "@/lib/usePresence";
import { useImageGeometry } from "@/lib/useImageGeometry";
import { supabaseBrowser } from "@/lib/supabase/browser";

import { useThreadsStore } from "@/stores/threads";
import { useMessagesStore } from "@/stores/messages";
import type { Msg } from "@/stores/messages";
import { useWireSkuRealtime } from "@/lib/realtime/wireSkuRealtime";
import { useShallow } from "zustand/react/shallow";

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

type ReviewsPayload = Record<string, { points?: ThreadRow[] }>;
const EMPTY_ARR: any[] = [];

interface ImageViewerProps {
  sku: SkuWithImagesAndStatus;
  username: string;
  selectSku: (sku: SkuWithImagesAndStatus | null) => void;
  selectedImageName?: string | null; // ← nombre desde URL
  onSelectImage?: (name: string | null) => void; // ← escribe a URL
}

export default function ImageViewer({
  sku,
  username,
  selectSku,
  selectedImageName = null,
  onSelectImage,
}: ImageViewerProps) {
  const { images } = sku;

  // Realtime por SKU
  useWireSkuRealtime(sku.sku);

  // ===== Navegación sin rebotes: UI manda por nombre y la URL sigue =====
  const [currentImageName, setCurrentImageName] = useState<string | null>(
    selectedImageName ?? images[0]?.name ?? null
  );
  const pendingUrlImageRef = useRef<string | null>(null);

  // Si cambia el SKU, resetea la imagen actual
  useEffect(() => {
    pendingUrlImageRef.current = selectedImageName ?? images[0]?.name ?? null;
    setCurrentImageName(pendingUrlImageRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku.sku]);

  // Sincroniza con la URL, ignorando props “viejas” mientras hay navegación pendiente
  useEffect(() => {
    if (!selectedImageName) return;
    if (pendingUrlImageRef.current && selectedImageName !== pendingUrlImageRef.current) return;
    if (selectedImageName !== currentImageName) setCurrentImageName(selectedImageName);
    if (pendingUrlImageRef.current === selectedImageName) pendingUrlImageRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImageName]);

  // Índice e imagen derivados SIEMPRE del nombre
  const selectedImageIndex = useMemo(() => {
    if (!currentImageName) return 0;
    const idx = images.findIndex((i) => i.name === currentImageName);
    return idx >= 0 ? idx : 0;
  }, [currentImageName, images]);

  const selectedImage = images[selectedImageIndex] ?? null;

  // ===== UI state =====
  // 👉 Fuente ÚNICA: store (sin useState local)
  const activeThreadId = useThreadsStore((s) => s.activeThreadId);
  const setActiveThreadId = useThreadsStore((s) => s.setActiveThreadId);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [creatingThreadId, setCreatingThreadId] = useState<number | null>(null);

  // Loader solo si realmente falta hidratar
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tool, setTool] = useState<"zoom" | "pin">("zoom");
  const [showThreads, setShowThreads] = useState(true);
  const { wrapperRef, imgRef, box: imgBox, update } = useImageGeometry();
  const onlineUsers = usePresence(sku.sku, username);

  const [zoomOverlay, setZoomOverlay] =
    useState<null | { x: number; y: number; ax: number; ay: number }>(null);

  // ==========================
  //  STORES (selecciones finas)
  // ==========================
  const selectedImageKey = selectedImage?.name ?? "";
  const threadsRaw = useThreadsStore(
    useShallow((s) => (selectedImageKey ? s.byImage[selectedImageKey] ?? EMPTY_ARR : EMPTY_ARR))
  );

  const threadsByNeededImages = useThreadsStore(
    useShallow((s) => {
      const out: Record<string, { id: number; x: number; y: number; status: ThreadStatus }[]> = {};
      for (const img of images) out[img.name] = s.byImage[img.name] ?? EMPTY_ARR;
      return out;
    })
  );

  // Mensajes
  const setMsgsForThread   = useMessagesStore((s) => s.setForThread);
  const addOptimisticMsg   = useMessagesStore((s) => s.addOptimistic);
  const confirmMessage     = useMessagesStore((s) => s.confirmMessage);
  const moveThreadMessages = useMessagesStore((s) => s.moveThreadMessages);
  const markThreadRead     = useMessagesStore((s) => s.markThreadRead);
  const setSelfAuthId      = useMessagesStore((s) => s.setSelfAuthId);
  const msgsByThread       = useMessagesStore((s) => s.byThread);

  // Threads store helpers
  const hydrateForImage        = useThreadsStore((s) => s.hydrateForImage);
  const setThreadMsgIds        = useThreadsStore((s) => s.setMessageIds);
  const setThreadStatus        = useThreadsStore((s) => s.setStatus);
  const createThreadOptimistic = useThreadsStore((s) => s.createOptimistic);
  const confirmCreate          = useThreadsStore((s) => s.confirmCreate);
  const rollbackCreate         = useThreadsStore((s) => s.rollbackCreate);
  const pendingStatusMap       = useThreadsStore((s) => s.pendingStatus);

  // ==========================
  //  HIDRATACIÓN (solo cuando falte y solo por SKU)
  // ==========================
  useEffect(() => {
    const cancelled = false;

    (async () => {
      const storeNow = useThreadsStore.getState();
      const missing = images.filter(
        (img) => img.name && !(storeNow.byImage[img.name] && storeNow.byImage[img.name].length)
      );

      if (missing.length === 0) {
        setLoadError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);
      try {
        const sb = supabaseBrowser();
        const { data: authInfo } = await sb.auth.getUser();
        const myId = authInfo.user?.id ?? null;
        setSelfAuthId(myId);

        const res = await fetch(`/api/reviews/${sku.sku}`, { cache: "no-store" });
        if (!res.ok) throw new Error("No se pudieron cargar las anotaciones");
        const payload: ReviewsPayload = await res.json();

        const allThreadIds: number[] = [];

        // Hidratar solo las que faltan
        for (const img of missing) {
          const name = img.name!;
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

        if (allThreadIds.length) {
          const { data: msgs, error } = await sb
            .from("review_messages")
            .select(
              `id,thread_id,text,created_at,updated_at,created_by,created_by_username,created_by_display_name,is_system,
                meta:review_message_receipts!review_message_receipts_message_fkey(
                user_id,
                read_at,
                delivered_at
              )
              `
            )
            .in("thread_id", allThreadIds)
            .order("created_at", { ascending: true });

          if (error) throw error;

          const grouped: Record<number, Msg[]> = {};
          (msgs || []).forEach((m) => {
            const deliveryStatus: DeliveryState = m.meta.some(mm=> mm.read_at) ? "read" : m.meta.some(mm=> mm.delivered_at) ? "delivered" : "sent"
            const mine = !!myId && m.created_by === myId;
            const mm: Msg = {
              ...m,
              updated_at: m.updated_at ?? m.created_at,
              meta: { localDelivery: deliveryStatus, isMine: mine } as MessageMeta,
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

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku.sku]);

  // ==========================
  //  Atajos de teclado
  // ==========================
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      const typing = el?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
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

  // ==========================
  //  Derivados solo de la imagen visible
  // ==========================
  const threadsInImage: Thread[] = useMemo(() => {
    if (!selectedImage?.name) return [];
    return threadsRaw
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
  }, [selectedImage?.name, threadsRaw, msgsByThread]);

  const resolvedActiveThreadId: number | null = useMemo(() => {
    if (!activeThreadId) return null;
    if (!selectedImage?.name) return null;
    if (threadsRaw.some((t) => t.id === activeThreadId)) return activeThreadId;
    if (activeKey) {
      const th = threadsRaw.find((t) => fp(selectedImage.name!, Number(t.x), Number(t.y)) === activeKey);
      if (th) return th.id;
    }
    return null;
  }, [threadsRaw, selectedImage, activeThreadId, activeKey]);

  // ==========================
  //  Acciones
  // ==========================
  const createThreadAt = useCallback(
    async (imgName: string, x: number, y: number) => {
      const rx = round3(x);
      const ry = round3(y);

      const tempId = createThreadOptimistic(imgName, rx, ry);
      setCreatingThreadId(tempId);
      setActiveThreadId(tempId); // solo store
      setActiveKey(`${imgName}|${rx}|${ry}`);

      const sysText = `**@${username ?? "desconocido"}** ha creado un nuevo hilo de revisión.`;
      const tempMsgId = -Date.now() - Math.floor(Math.random() * 1000);

      addOptimisticMsg(tempId, tempMsgId, {
        text: sysText,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: "system",
        created_by_username: "system",
        created_by_display_name: "system",
        is_system: true,
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

      // sincroniza store: si el activo era el temp, cámbialo al real
      {
        const current = useThreadsStore.getState().activeThreadId;
        const nextId = current === tempId ? realId : current;
        setActiveThreadId(nextId ?? null);
      }
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
          updated_at:
            sysCreated.updated_at || sysCreated.updatedAt || sysCreated.createdAt || new Date().toISOString(),
          created_by: sysCreated.created_by ?? "system",
          created_by_username: sysCreated.created_by_username ?? "system",
          created_by_display_name: sysCreated.created_by_display_name ?? "system",
          is_system: !!sysCreated.is_system,
          meta: { localDelivery: "sent" } as any,
        });
      }
    },
    [
      sku.sku,
      username,
      confirmCreate,
      rollbackCreate,
      addOptimisticMsg,
      confirmMessage,
      moveThreadMessages,
      setActiveThreadId,
    ]
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
        } as Msg);
      }
    },
    [addOptimisticMsg, confirmMessage, username, creatingThreadId]
  );

  const toggleThreadStatus = useCallback(
    async (_imgName: string, threadId: number, next: ThreadStatus) => {
      if (useThreadsStore.getState().pendingStatus.has(threadId)) return;

      const { byImage, threadToImage, beginStatusOptimistic, clearPendingStatus } =
        useThreadsStore.getState();
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

  const removeThread = useCallback(
    async (id: number) => {
      setThreadStatus(id, "deleted");
      await fetch(`/api/threads/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: id, status: "deleted" as ThreadStatus }),
      }).catch(() => {});
    },
    [setThreadStatus]
  );

  useEffect(() => {
    if (resolvedActiveThreadId) {
      markThreadRead(resolvedActiveThreadId).catch(() => {});
    }
  }, [resolvedActiveThreadId, markThreadRead]);

  // ===== Helpers UI =====
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

  // Navegación: UI optimista por nombre + URL; sin tocar índice directamente
  const selectImage = (index: number) => {
    const name = images[index]?.name ?? null;

    setActiveThreadId(null); // solo store
    setActiveKey(null);

    if (name) {
      pendingUrlImageRef.current = name; // marca navegación pendiente
      setCurrentImageName(name);         // UI inmediata sin flash
      onSelectImage?.(name);             // URL se actualiza
    } else {
      pendingUrlImageRef.current = null;
      const fallback = images[0]?.name ?? null;
      setCurrentImageName(fallback);
      onSelectImage?.(fallback);
    }
    requestAnimationFrame(update);
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
    setShowThreads(true);
    await createThreadAt(selectedImage.name, xPct, yPct);
  };

  const parentCursor = tool === "pin" ? "crosshair" : "zoom-in";

  const thumbThreads = useMemo(
    () =>
      Object.fromEntries(
        images.map((img) => [
          img.name,
          (threadsByNeededImages[img.name] || []).map((t) => ({ ...t, messages: [] })),
        ])
      ),
    [images, threadsByNeededImages]
  );

  return (
    <div className={styles.viewerContainer}>
      <div className={styles.mainViewer}>
        <div className={styles.imageHeader}>
          <button className={styles.toolBtn} onClick={() => selectSku(null)} title="Volver">🏠</button>
          <h1 className={styles.title}>Revisión de SKU: <span className={styles.titleSku}>{sku.sku}</span></h1>
          <div className={styles.imageCounter}>{selectedImageIndex + 1} / {images.length}</div>
        </div>

        <div className={styles.mainImageContainer}>
          <div className={styles.parentToolbox} aria-label="Herramientas">
            <button className={`${styles.toolBtn} ${tool === "zoom" ? styles.toolActive : ""}`} aria-pressed={tool === "zoom"} title="Lupa (abrir zoom)" onClick={() => setTool("zoom")}>🔍</button>
            <button className={`${styles.toolBtn} ${tool === "pin" ? styles.toolActive : ""}`} aria-pressed={tool === "pin"} title="Añadir nuevo hilo" onClick={() => setTool("pin")}>📍</button>
            <button className={`${styles.toolBtn} ${showThreads ? styles.toolActive : ""}`} aria-pressed={showThreads} title={`${showThreads ? "Ocultar" : "Mostrar"} hilos — T`} onClick={() => setShowThreads((v) => !v)}>🧵</button>
          </div>

          <button className={`${styles.navButton} ${styles.navLeft}`} onClick={() => selectImage(selectedImageIndex - 1)} disabled={selectedImageIndex === 0} aria-label="Imagen anterior">❮</button>

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
              minSkeletonMs={0}
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
                    setActiveThreadId(th.id); // solo store
                    if (selectedImage?.name) setActiveKey(fp(selectedImage.name, th.x, th.y));
                  }}
                  title={th.status === "corrected" ? "Corregido" : th.status === "reopened" ? "Reabierto" : "Pendiente"}
                >
                  {index + 1}
                </div>
              );
            })}
          </div>

          <button className={`${styles.navButton} ${styles.navRight}`} onClick={() => selectImage(selectedImageIndex + 1)} disabled={selectedImageIndex === images.length - 1} aria-label="Imagen siguiente">❯</button>

          <div className={styles.shortcutHint} aria-hidden>
            ←/→ imagen · <b>Z</b> lupa · <b>P</b> anotar · <b>T</b> hilos on/off · <b>Enter</b> zoom · <b>Esc</b> cerrar
          </div>
        </div>

        <ThumbnailGrid
          images={images}
          selectedIndex={selectedImageIndex}
          onSelect={selectImage}
          threads={thumbThreads}
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
          setActiveThreadId(id); // solo store
          if (id) markThreadRead(id).catch(() => {});
          if (selectedImage?.name && id) {
            const t = (threadsRaw || []).find((x) => x.id === id);
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
        composeLocked={
          creatingThreadId != null &&
          resolvedActiveThreadId != null &&
          creatingThreadId === resolvedActiveThreadId
        }
        statusLocked={resolvedActiveThreadId != null && pendingStatusMap.has(resolvedActiveThreadId)}
      />

      {zoomOverlay && selectedImage?.url && (
        <ZoomOverlay
          src={selectedImage.bigImgUrl || selectedImage.url}
          threads={threadsInImage}
          activeThreadId={resolvedActiveThreadId}
          currentUsername={username}
          hideThreads={!showThreads}
          setHideThreads={setShowThreads}
          onFocusThread={(id: number | null) => {
            setActiveThreadId(id); // solo store
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
