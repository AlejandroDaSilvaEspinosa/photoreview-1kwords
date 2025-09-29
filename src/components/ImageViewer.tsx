"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import styles from "./ImageViewer.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThumbnailGrid from "./images/ThumbnailGrid";
import SidePanel from "./SidePanel";
import ZoomOverlay from "@/components/images/ZoomOverlay";
import type {
  ThreadStatus,
  SkuWithImagesAndStatus,
  Thread,
  ThreadRow,
  MessageMeta,
} from "@/types/review";
import { usePresence } from "@/lib/usePresence";
import { useImageGeometry } from "@/lib/useImageGeometry";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  useThreadsStore,
  threadsCacheApi as threadsCache,
} from "@/stores/threads";
import { useMessagesStore, Msg, messagesCache } from "@/stores/messages";
import { useWireSkuRealtime } from "@/lib/realtime/useWireSkuRealtime";
import { useShallow } from "zustand/react/shallow";
import { emitToast, toastError } from "@/hooks/useToast";
import { roundTo, pointKey } from "@/lib/common/coords";
import {
  enqueueSendMessage,
  enqueueSendSystemMessage,
} from "@/lib/net/messagesOutbox";

/**
 * ImageViewer
 * - Carga caché de threads+mensajes → marca source "cache"
 * - Fetch de threads+mensajes → marca source "live" (por hilo SOLO tras setMsgsForThread)
 * - Realtime INSERT de mensaje → evento "rev:thread-live" → ascenso a "live"
 * - Handshake de lectura: escucha "rev:thread-unread-ready" y ahí hace markThreadRead(tid)
 */

const colorByStatus = (s: ThreadStatus) =>
  s === "corrected" ? "#0FA958" : s === "reopened" ? "#FFB000" : "#FF0040";

const STATUS_LABEL: Record<ThreadStatus, string> = {
  pending: "Pendiente",
  corrected: "Corregido",
  reopened: "Reabierto",
  deleted: "Eliminado",
};

const EMPTY_ARR: [] = [];

type HydratedSource = "cache" | "live";

interface ImageViewerProps {
  sku: SkuWithImagesAndStatus;
  username: string;
  selectSku: (sku: SkuWithImagesAndStatus | null) => void;
  selectedImageName?: string | null;
  onSelectImage?: (name: string | null) => void;
  selectedThreadId?: number | null;
  onSelectThread?: (id: number | null) => void;
}

export default function ImageViewer({
  sku,
  username,
  selectSku,
  selectedImageName = null,
  onSelectImage,
  selectedThreadId = null,
  onSelectThread,
}: ImageViewerProps) {
  const { images } = sku;
  useWireSkuRealtime(sku.sku);

  // ===== Navegación / imagen seleccionada
  const [currentImageName, setCurrentImageName] = useState<string | null>(
    selectedImageName ?? images[0]?.name ?? null
  );
  const pendingUrlImageRef = useRef<string | null>(null);
  const suppressFollowThreadOnceRef = useRef<boolean>(false);
  const lastAppliedThreadRef = useRef<number | null>(null);

  useEffect(() => {
    pendingUrlImageRef.current = selectedImageName ?? images[0]?.name ?? null;
    setCurrentImageName(pendingUrlImageRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku.sku]);

  useEffect(() => {
    if (!selectedImageName) return;
    if (
      pendingUrlImageRef.current &&
      selectedImageName !== pendingUrlImageRef.current
    )
      return;
    if (selectedImageName !== currentImageName)
      setCurrentImageName(selectedImageName);
    if (pendingUrlImageRef.current === selectedImageName)
      pendingUrlImageRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImageName]);

  const selectedImageIndex = useMemo(() => {
    if (!currentImageName) return 0;
    const idx = images.findIndex((i) => i.name === currentImageName);
    return idx >= 0 ? idx : 0;
  }, [currentImageName, images]);
  const selectedImage = images[selectedImageIndex] ?? null;

  // ===== Stores
  const activeThreadId = useThreadsStore((s) => s.activeThreadId);
  const setActiveThreadId = useThreadsStore((s) => s.setActiveThreadId);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [creatingThreadId, setCreatingThreadId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<"zoom" | "pin">("zoom");
  const [showThreads, setShowThreads] = useState(true);

  const { wrapperRef, imgRef, box: imgBox, update } = useImageGeometry();
  const onlineUsers = usePresence(sku.sku, username);
  const [zoomOverlay, setZoomOverlay] = useState<null | {
    x: number;
    y: number;
    ax: number;
    ay: number;
  }>(null);

  // ===== Threads (imagen visible)
  const selectedImageKey = selectedImage?.name ?? "";
  const threadsRaw = useThreadsStore(
    useShallow((s) =>
      selectedImageKey ? s.byImage[selectedImageKey] ?? EMPTY_ARR : EMPTY_ARR
    )
  );

  // Reactivo: mapa threadId → imageName
  const threadToImage = useThreadsStore((s) => s.threadToImage);

  // Reactivo: listas por imagen del SKU
  const threadsByNeededImages = useThreadsStore(
    useShallow((s) => {
      const out: Record<
        string,
        { id: number; x: number; y: number; status: ThreadStatus }[]
      > = {};
      for (const img of images)
        out[img.name] = s.byImage[img.name] ?? EMPTY_ARR;
      return out;
    })
  );

  const threadToImageMapSize = threadToImage.size;
  const threadToImageStable = useThreadsStore((s) => s.threadToImage);

  const setMsgsForThread = useMessagesStore((s) => s.setForThread);
  const moveThreadMessages = useMessagesStore((s) => s.moveThreadMessages);
  const setSelfAuthId = useMessagesStore((s) => s.setSelfAuthId);
  const msgsByThread = useMessagesStore((s) => s.byThread);

  const hydrateForImage = useThreadsStore((s) => s.hydrateForImage);
  const setThreadMsgIds = useThreadsStore((s) => s.setMessageIds);
  const setThreadStatus = useThreadsStore((s) => s.setStatus);
  const createThreadOptimistic = useThreadsStore((s) => s.createOptimistic);
  const confirmCreate = useThreadsStore((s) => s.confirmCreate);
  const rollbackCreate = useThreadsStore((s) => s.rollbackCreate);
  const pendingStatusMap = useThreadsStore((s) => s.pendingStatus);

  // ===== Fuente de hidratación por hilo
  const [sourceByTid, setSourceByTid] = useState<Map<number, HydratedSource>>(
    new Map()
  );
  const markSource = useCallback((tid: number, src: HydratedSource) => {
    setSourceByTid((prev) => {
      const cur = prev.get(tid);
      if (cur === "live") return prev; // live manda
      if (cur === src) return prev;
      const m = new Map(prev);
      m.set(tid, src);
      return m;
    });
  }, []);
  // Upgrade a live cuando entre un INSERT realtime para el hilo (si estábamos en cache)
  useEffect(() => {
    const onLive = (e: any) => {
      const tid = e?.detail?.tid as number | undefined;
      if (!tid) return;
      setSourceByTid((prev) => {
        const cur = prev.get(tid);
        if (cur === "live") return prev;
        const m = new Map(prev);
        if (tid != resolvedActiveThreadId) {
          m.set(tid, "live");
        } else {
          m.set(tid, "cache");
        }
        return m;
      });
    };
    window.addEventListener("rev:thread-live", onLive);
    return () => window.removeEventListener("rev:thread-live", onLive);
  }, []);

  // Handshake: marcar read cuando ThreadChat avise (después de congelar divisor)
  useEffect(() => {
    const onUnreadReady = (e: any) => {
      const tid = e?.detail?.tid as number | undefined;
      if (!tid) return;
      const activeTid = useThreadsStore.getState().activeThreadId;
      if (activeTid && activeTid === tid) {
        requestAnimationFrame(() =>
          useMessagesStore.getState().markThreadRead(tid)
        );
      }
    };
    window.addEventListener("rev:thread-unread-ready", onUnreadReady);
    return () =>
      window.removeEventListener("rev:thread-unread-ready", onUnreadReady);
  }, []);

  // ========================== HIDRATACIÓN (cache + live)
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      // 1) Cache
      let servedFromCache = false;
      const cachedThreadIds: number[] = [];
      try {
        for (const img of images) {
          const name = img.name!;
          const cached = threadsCache.load(name);
          if (cached && cached.length) {
            hydrateForImage(name, cached);
            cached.forEach((t) => cachedThreadIds.push(t.id));
            servedFromCache = true;
          }
        }
        if (cachedThreadIds.length) {
          for (const tid of cachedThreadIds) {
            const cachedMsgs = messagesCache.load(tid);
            if (cachedMsgs) {
              setMsgsForThread(tid, cachedMsgs);
              setThreadMsgIds(
                tid,
                cachedMsgs
                  .map((m) => m.id as number)
                  .filter((x) => Number.isFinite(x))
              );
              markSource(tid, "cache");
            }
          }
        }
      } catch (e) {
        toastError(e, {
          title: "No se pudo leer el caché local",
          fallback: "Continuamos sin caché.",
        });
      }

      setLoadError(null);
      setLoading(!servedFromCache);

      try {
        // 2) Auth ID
        const sb = supabaseBrowser();
        const { data: authInfo, error: authErr } = await sb.auth.getUser();
        if (authErr) {
          toastError(authErr, {
            title: "No se pudo recuperar el usuario",
            fallback: "Continuamos sin usuario.",
          });
        }
        const myId = authInfo?.user?.id ?? null;
        setSelfAuthId(myId);

        // 3) Threads frescos
        const res = await fetch(`/api/reviews/${sku.sku}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (!res.ok) throw new Error("No se pudieron cargar las anotaciones.");
        const payload: Record<string, { points?: ThreadRow[] }> =
          await res.json();

        const allThreadIds: number[] = [];
        for (const img of images) {
          const name = img.name!;
          const raw = payload[name]?.points ?? [];
          const rows: Thread[] = raw.map((t: ThreadRow) => ({
            id: t.id,
            x: roundTo(+t.x, 3),
            y: roundTo(+t.y, 3),
            status: t.status as ThreadStatus,
          }));
          hydrateForImage(name, rows);
          raw.forEach((r) => allThreadIds.push(r.id));
        }

        // 4) Mensajes frescos (y marcar 'live' SOLO tras setMsgsForThread)
        if (allThreadIds.length) {
          const { data: msgs, error } = await sb
            .from("review_messages")
            .select(
              `
              id,thread_id,text,created_at,updated_at,created_by,created_by_username,created_by_display_name,is_system,
              meta:review_message_receipts!review_message_receipts_message_fkey ( user_id, read_at, delivered_at )
            `
            )
            .in("thread_id", allThreadIds)
            .order("created_at", { ascending: true });

          if (error) throw error;

          const grouped: Record<number, Msg[]> = {};
          (msgs || []).forEach((m: any) => {
            const mine = !!myId && m.created_by === myId;
            const receipts = (m.meta || []) as Array<{
              user_id: string;
              read_at: string | null;
              delivered_at: string | null;
            }>;
            let delivery: "sent" | "delivered" | "read" = "sent";
            if (mine) {
              const others = receipts.filter((r) => r.user_id !== myId);
              if (others.some((r) => r.read_at)) delivery = "read";
              else if (others.some((r) => r.delivered_at))
                delivery = "delivered";
            } else {
              const mineRec = receipts.find((r) => r.user_id === myId);
              if (mineRec?.read_at) delivery = "read";
              else if (mineRec?.delivered_at) delivery = "delivered";
            }
            const mm: Msg = {
              ...m,
              updated_at: m.updated_at ?? m.created_at,
              meta: { localDelivery: delivery, isMine: mine } as MessageMeta,
            };
            (grouped[m.thread_id] ||= []).push(mm);
          });

          const touched = new Set<number>();
          for (const tidStr of Object.keys(grouped)) {
            const tid = Number(tidStr);
            touched.add(tid);
            setMsgsForThread(tid, grouped[tid]);

            setThreadMsgIds(
              tid,
              grouped[tid].map((x) => x.id)
            );
            markSource(tid, "live");
          }

          // Hilos sin mensajes: asegúrate de fijar vacío como live
          for (const tid of allThreadIds) {
            if (!touched.has(tid)) {
              setMsgsForThread(tid, []);
              setThreadMsgIds(tid, []);
              markSource(tid, "live");
            }
          }
        }

        if (!cancelled) {
          setLoadError(null);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(
            servedFromCache
              ? "No se pudo actualizar (modo sin conexión)"
              : e?.message || "Error de carga"
          );
          setLoading(false);
          toastError(e, { title: "Fallo cargando anotaciones" });
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku.sku, images.map((i) => i.name).join("|")]);

  // ========================== Selección por URL (?thread=ID)
  useEffect(() => {
    if (suppressFollowThreadOnceRef.current) {
      suppressFollowThreadOnceRef.current = false;
      return;
    }
    if (selectedThreadId == null) {
      lastAppliedThreadRef.current = null;
      return;
    }
    if (lastAppliedThreadRef.current === selectedThreadId) return;

    let imgName = threadToImageStable.get(selectedThreadId) || null;

    if (!imgName) {
      for (const img of images) {
        const arr = threadsByNeededImages[img.name] || EMPTY_ARR;
        if (arr.some((t) => t.id === selectedThreadId)) {
          imgName = img.name;
          break;
        }
      }
    }
    if (!imgName) return;

    if (currentImageName !== imgName) {
      pendingUrlImageRef.current = imgName;
      setCurrentImageName(imgName);
      onSelectImage?.(imgName);
    }

    setActiveThreadId(selectedThreadId);
    lastAppliedThreadRef.current = selectedThreadId;

    if (imgName === selectedImage?.name) {
      const t = (threadsRaw || []).find((x) => x.id === selectedThreadId);
      if (t) setActiveKey(pointKey(imgName, t.x, t.y));
    }
  }, [
    selectedThreadId,
    images,
    currentImageName,
    onSelectImage,
    setActiveThreadId,
    selectedImage?.name,
    threadsRaw,
    loading,
    threadToImageStable,
    threadToImageMapSize,
    threadsByNeededImages,
  ]);

  // ========================== Derivados: inyecta meta.source para ThreadChat
  const threadsInImage: Thread[] = useMemo(() => {
    if (!selectedImage?.name) return [];
    return (threadsRaw || [])
      .filter((t) => t.status !== "deleted")
      .map((t) => {
        const list = (msgsByThread[t.id] || []).map((m) => ({
          id: m.id,
          text: m.text,
          createdAt: m.created_at,
          createdByName:
            m.created_by_display_name || m.created_by_username || "Desconocido",
          createdByAuthId: m.created_by ?? null,
          isSystem: !!m.is_system,
          meta: {
            localDelivery: m.meta?.localDelivery ?? "sent",
            isMine: m.meta?.isMine ?? false,
            clientNonce: m.meta?.clientNonce,
            displaySeq: m.meta?.displaySeq,
            displayNano: m.meta?.displayNano,
          } as MessageMeta,
        }));
        const src = sourceByTid.get(t.id);
        return {
          id: t.id,
          x: t.x,
          y: t.y,
          status: t.status,
          messages: list,
          meta: { source: src } as any,
        };
      });
  }, [selectedImage?.name, threadsRaw, msgsByThread, sourceByTid]);

  const resolvedActiveThreadId: number | null = useMemo(() => {
    if (!activeThreadId) return null;
    if (!selectedImage?.name) return null;
    if (threadsRaw.some((t) => t.id === activeThreadId)) return activeThreadId;
    if (activeKey) {
      const th = threadsRaw.find(
        (t) =>
          pointKey(selectedImage.name!, Number(t.x), Number(t.y)) === activeKey
      );
      if (th) return th.id;
    }
    return null;
  }, [threadsRaw, selectedImage, activeThreadId, activeKey]);

  // ========================== Acciones
  const createThreadAt = useCallback(
    async (imgName: string, x: number, y: number) => {
      const rx = roundTo(x, 3);
      const ry = roundTo(y, 3);
      suppressFollowThreadOnceRef.current = true;
      startTransition(() => onSelectThread?.(null));

      const tempId = createThreadOptimistic(imgName, rx, ry);
      setCreatingThreadId(tempId);
      setActiveThreadId(tempId);
      setActiveKey(pointKey(imgName, rx, ry));

      const sysText = `**@${
        username ?? "desconocido"
      }** ha creado un nuevo hilo de revisión.`;

      try {
        const created = await fetch("/api/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku: sku.sku,
            imageName: imgName,
            x: rx,
            y: ry,
          }),
        }).then((r) => (r.ok ? r.json() : null));

        if (!created?.threadId)
          throw new Error("El servidor no devolvió un ID de hilo.");

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

        {
          const current = useThreadsStore.getState().activeThreadId;
          const nextId = current === tempId ? realId : current;
          setActiveThreadId(nextId ?? null);
        }
        setCreatingThreadId(null);

        startTransition(() => {
          if (selectedThreadId !== realId) onSelectThread?.(realId);
        });

        try {
          enqueueSendSystemMessage(realId, sysText);
        } catch (e) {
          toastError(e, { title: "No se pudo encolar el mensaje del sistema" });
        }
      } catch (e) {
        rollbackCreate(tempId);
        setActiveThreadId(null);
        setCreatingThreadId(null);
        toastError(e, { title: "No se pudo crear el hilo" });
      }
    },
    [
      sku.sku,
      username,
      confirmCreate,
      rollbackCreate,
      moveThreadMessages,
      setActiveThreadId,
      onSelectThread,
      selectedThreadId,
      createThreadOptimistic,
    ]
  );

  const addMessage = useCallback(
    async (threadId: number, text: string) => {
      if (creatingThreadId != null && threadId === creatingThreadId) return;
      try {
        enqueueSendMessage(threadId, text);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = document.querySelector<HTMLElement>("[data-chat-list]");
            if (el) el.scrollTop = el.scrollHeight;
          });
        });
      } catch (e) {
        toastError(e, { title: "No se pudo encolar el mensaje" });
      }
    },
    [creatingThreadId]
  );

  const toggleThreadStatus = useCallback(
    async (_imgName: string, threadId: number, next: ThreadStatus) => {
      const {
        byImage,
        threadToImage,
        beginStatusOptimistic,
        clearPendingStatus,
      } = useThreadsStore.getState();
      const img = threadToImage.get(threadId) || "";
      const prev =
        byImage[img]?.find((t) => t.id === threadId)?.status ?? "pending";

      beginStatusOptimistic(threadId, prev, next);
      setThreadStatus(threadId, next);

      const tempText = `**@${
        username ?? "usuario"
      }** cambió el estado del hilo a "**${STATUS_LABEL[next]}**".`;
      try {
        enqueueSendSystemMessage(threadId, tempText);
      } catch {}

      try {
        const ok = await fetch("/api/threads/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId, status: next }),
        }).then((r) => r.ok);
        if (!ok) throw new Error("No se pudo actualizar el estado del hilo.");
      } catch (e) {
        clearPendingStatus(threadId);
        setThreadStatus(threadId, prev);
        toastError(e, { title: "No se pudo cambiar el estado" });
      }
    },
    [setThreadStatus, username]
  );

  const removeThread = useCallback(
    async (id: number) => {
      setThreadStatus(id, "deleted");
      try {
        await fetch(`/api/threads/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: id,
            status: "deleted" as ThreadStatus,
          }),
        });
      } catch (e) {
        toastError(e, { title: "No se pudo borrar el hilo" });
      }
      if (resolvedActiveThreadId === id)
        startTransition(() => onSelectThread?.(null));
    },
    [setThreadStatus, resolvedActiveThreadId, onSelectThread]
  );

  // ===== UI helpers
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

  const selectImage = (index: number) => {
    const name = images[index]?.name ?? null;
    setActiveThreadId(null);
    setActiveKey(null);
    suppressFollowThreadOnceRef.current = true;
    startTransition(() => onSelectThread?.(null));
    if (name) {
      pendingUrlImageRef.current = name;
      setCurrentImageName(name);
      onSelectImage?.(name);
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

  // ==========================
  //  Atajos de teclado
  // ==========================
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
        if (selectedImageIndex < images.length - 1)
          selectImage(selectedImageIndex + 1);
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

  return (
    <div className={styles.viewerContainer}>
      <div className={styles.mainViewer}>
        <div className={styles.imageHeader}>
          <button
            className={styles.toolBtn}
            onClick={() => selectSku(null)}
            title="Volver"
            aria-label="Volver al listado de SKUs"
          >
            🏠
          </button>
          <h1 className={styles.title}>
            Revisión de SKU: <span className={styles.titleSku}>{sku.sku}</span>
          </h1>
          <div className={styles.imageCounter} aria-live="polite">
            {selectedImageIndex + 1} / {images.length}
          </div>
        </div>

        <div className={styles.mainImageContainer}>
          <div className={styles.parentToolbox} aria-label="Herramientas">
            <button
              className={`${styles.toolBtn} ${
                tool === "zoom" ? styles.toolActive : ""
              }`}
              aria-pressed={tool === "zoom"}
              title="Lupa (abrir zoom)"
              onClick={() => setTool("zoom")}
            >
              🔍
            </button>
            <button
              className={`${styles.toolBtn} ${
                tool === "pin" ? styles.toolActive : ""
              }`}
              aria-pressed={tool === "pin"}
              title="Añadir nuevo hilo"
              onClick={() => setTool("pin")}
            >
              📍
            </button>
            <button
              className={`${styles.toolBtn} ${
                showThreads ? styles.toolActive : ""
              }`}
              aria-pressed={showThreads}
              title={`${showThreads ? "Ocultar" : "Mostrar"} hilos — T`}
              onClick={() => setShowThreads((v) => !v)}
            >
              🧵
            </button>
          </div>

          <button
            className={`${styles.navButton} ${styles.navLeft}`}
            onClick={() => selectImage(selectedImageIndex - 1)}
            disabled={selectedImageIndex === 0}
            aria-label="Imagen anterior"
          >
            ❮
          </button>

          <div
            className={styles.mainImageWrapper}
            ref={wrapperRef}
            style={{ cursor: parentCursor }}
          >
            {loading && (
              <div
                className={styles.overlayLoader}
                role="status"
                aria-live="polite"
              >
                <div className={styles.loaderSpinner} />
                <div className={styles.loaderText}>Cargando anotaciones…</div>
              </div>
            )}
            {loadError && !loading && (
              <div className={styles.overlayError} role="alert">
                {loadError}
              </div>
            )}

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
              fallbackText={(selectedImage?.name || "")
                .slice(0, 2)
                .toUpperCase()}
            />

            {showThreads &&
              (threadsRaw || []).map((th, index) => {
                if (th.status === "deleted") return null;
                const topPx = imgBox.offsetTop + (th.y / 100) * imgBox.height;
                const leftPx = imgBox.offsetLeft + (th.x / 100) * imgBox.width;
                const bg = colorByStatus(th.status);
                const isActive = activeThreadId === th.id;
                return (
                  <div
                    key={th.id}
                    className={`${styles.annotationNode} ${
                      isActive ? styles.nodeActive : ""
                    }`}
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
                      startTransition(() => onSelectThread?.(th.id));
                      if (selectedImage?.name)
                        setActiveKey(pointKey(selectedImage.name, th.x, th.y));
                    }}
                    title={STATUS_LABEL[th.status]}
                    aria-label={`Hilo #${index + 1} — ${
                      STATUS_LABEL[th.status]
                    }`}
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
            ❯
          </button>

          <div className={styles.shortcutHint} aria-hidden>
            ←/→ imagen · <b>Z</b> lupa · <b>P</b> anotar · <b>T</b> hilos on/off
            · <b>Enter</b> zoom · <b>Esc</b> cerrar
          </div>
        </div>

        <ThumbnailGrid
          images={images}
          selectedIndex={selectedImageIndex}
          onSelect={selectImage}
          threads={Object.fromEntries(
            images.map((img) => [
              img.name,
              (threadsByNeededImages[img.name] || []).map((t) => ({
                ...t,
                messages: [],
              })),
            ])
          )}
          validatedImages={{}}
        />
      </div>

      <SidePanel
        name={selectedImage?.name || ""}
        isValidated={false}
        threads={threadsInImage}
        activeThreadId={resolvedActiveThreadId}
        composeLocked={
          creatingThreadId != null &&
          activeThreadId != null &&
          creatingThreadId === activeThreadId
        }
        statusLocked={
          activeThreadId != null && pendingStatusMap.has(activeThreadId)
        }
        onValidateSku={() =>
          emitToast({
            variant: "info",
            title: "Acción no implementada",
            description: "La validación de SKU se implementa en otra capa.",
          })
        }
        onUnvalidateSku={() =>
          emitToast({
            variant: "info",
            title: "Acción no implementada",
            description:
              "Quitar validación del SKU se implementa en otra capa.",
          })
        }
        onAddThreadMessage={(threadId: number, text: string) => {
          try {
            if (selectedImage?.name) addMessage(threadId, text);
          } catch (e) {
            toastError(e, { title: "No se pudo enviar el mensaje" });
          }
        }}
        onDeleteThread={(id: number) => {
          try {
            removeThread(id);
          } catch (e) {
            toastError(e, { title: "No se pudo borrar el hilo" });
          }
        }}
        onFocusThread={(id: number | null) => {
          try {
            setActiveThreadId(id);
            startTransition(() => onSelectThread?.(id ?? null));
            if (selectedImage?.name && id) {
              const t = (threadsRaw || []).find((x) => x.id === id);
              if (t) setActiveKey(pointKey(selectedImage.name, t.x, t.y));
            }
          } catch (e) {
            toastError(e, { title: "No se pudo enfocar el hilo" });
          }
        }}
        onToggleThreadStatus={(id: number, status: ThreadStatus) => {
          try {
            if (selectedImage?.name)
              toggleThreadStatus(selectedImage.name, id, status);
          } catch (e) {
            toastError(e, { title: "No se pudo cambiar el estado del hilo" });
          }
        }}
        withCorrectionsCount={0}
        validatedImagesCount={0}
        totalCompleted={0}
        totalImages={images.length}
        onlineUsers={onlineUsers}
        loading={loading}
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
            try {
              setActiveThreadId(id);
              startTransition(() => onSelectThread?.(id ?? null));
            } catch (e) {
              toastError(e, { title: "No se pudo enfocar el hilo" });
            }
          }}
          onAddThreadMessage={(threadId: number, text: string) => {
            try {
              if (creatingThreadId != null && threadId === creatingThreadId)
                return;
              if (selectedImage?.name) addMessage(threadId, text);
            } catch (e) {
              toastError(e, { title: "No se pudo enviar el mensaje" });
            }
          }}
          onToggleThreadStatus={(id, status) => {
            try {
              if (selectedImage?.name)
                toggleThreadStatus(selectedImage.name, id, status);
            } catch (e) {
              toastError(e, { title: "No se pudo cambiar el estado del hilo" });
            }
          }}
          onCreateThreadAt={(x, y) => {
            try {
              if (selectedImage?.name) createThreadAt(selectedImage.name, x, y);
            } catch (e) {
              toastError(e, { title: "No se pudo crear el hilo" });
            }
          }}
          onDeleteThread={(id: number) => {
            try {
              if (selectedImage?.name) removeThread(id);
            } catch (e) {
              toastError(e, { title: "No se pudo borrar el hilo" });
            }
          }}
          initial={{
            xPct: zoomOverlay.x,
            yPct: zoomOverlay.y,
            zoom: 1,
            ax: zoomOverlay.ax,
            ay: zoomOverlay.ay,
          }}
          onClose={() => setZoomOverlay(null)}
        />
      )}
    </div>
  );
}
