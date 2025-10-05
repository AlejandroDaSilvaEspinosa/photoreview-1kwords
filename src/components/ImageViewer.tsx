// ==============================
// File: src/components/ImageViewer.tsx
// ==============================
"use client";

import React, {
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
  startTransition,
} from "react";
import styles from "./ImageViewer.module.css";
import ImageWithSkeleton from "@/components/ImageWithSkeleton";
import ThumbnailGrid from "@/components/images/ThumbnailGrid";
import SidePanel from "@/components/SidePanel";
import ZoomOverlay from "@/components/images/ZoomOverlay";
import type {
  ThreadStatus,
  SkuWithImagesAndStatus,
  Thread,
  ThreadRow,
  MessageMeta,
  SkuStatus,
} from "@/types/review";
import { usePresence } from "@/lib/usePresence";
import { useImageGeometry } from "@/lib/useImageGeometry";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  useThreadsStore,
  threadsCacheApi as threadsCache,
} from "@/stores/threads";
import {
  useMessagesStore,
  Msg,
  messagesCache,
  hasUnreadInThread,
} from "@/stores/messages";
import { useWireSkuRealtime } from "@/lib/realtime/useWireSkuRealtime";
import { useShallow } from "zustand/react/shallow";
import { emitToast, toastError } from "@/hooks/useToast";
import { roundTo, pointKey } from "@/lib/common/coords";
import {
  enqueueSendMessage,
  enqueueSendSystemMessage,
} from "@/lib/net/messagesOutbox";
import Modal from "@/components/ui/Modal";
import NextSkuCard from "@/components/NextSkuCard";
import { useStatusesStore } from "@/stores/statuses";
import { useDotNumbers } from "@/contexts/DotNumbersProvider";

import SearchIcon from "@/icons/search.svg";
import EyeOffIncon from "@/icons/eye-off.svg";
import PinIcon from "@/icons/pin.svg";
import HomeIcon from "@/icons/home.svg";
import ChatIcon from "@/icons/chat.svg";

/** ===== Utils y constantes ===== */
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

type ThreadCounts = {
  pending: number;
  reopened: number;
  corrected: number;
  total: number;
};

interface ImageViewerProps {
  sku: SkuWithImagesAndStatus;
  username: string;
  selectSku: (sku: SkuWithImagesAndStatus | null) => void;
  selectedImageName?: string | null;
  onSelectImage?: (
    name: string | null,
    opts?: { preserveThread?: boolean }
  ) => void;
  selectedThreadId?: number | null;
  onSelectThread?: (id: number | null) => void;
  nextSkuCandidate?: SkuWithImagesAndStatus | null;
  onGoToSku?: (skuCode: string) => void;
}

export default function ImageViewer({
  sku,
  username,
  selectSku,
  selectedImageName = null,
  onSelectImage,
  selectedThreadId = null,
  onSelectThread,
  nextSkuCandidate = null,
  onGoToSku,
}: ImageViewerProps) {
  const { images } = sku;
  useWireSkuRealtime(sku.sku);

  // Hook de numeración estable compartida
  const dot = useDotNumbers();

  // ======= modal de validación
  const [validatedModalOpen, setValidatedModalOpen] = useState(false);

  // ======= SKU status + locks
  const skuStatus = sku.status; // "pending_validation" | "needs_correction" | "validated" | "reopened"
  const isSkuValidated = skuStatus === "validated";
  const [skuStatusBusy, setSkuStatusBusy] = useState(false);
  const imagesReadyToValidate = sku.counts?.finished ?? 0;
  const totalImages = images.length;

  // ======= Navegación / imagen seleccionada
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

  // ===== Refs/Stores/UI state
  const { wrapperRef, imgRef, box: imgBox, update } = useImageGeometry();
  const onlineUsers = usePresence(sku.sku, username);

  const activeThreadId = useThreadsStore((s) => s.activeThreadId);
  const setActiveThreadId = useThreadsStore((s) => s.setActiveThreadId);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // 🔁 Varios creates en paralelo (Set) para evitar colisiones
  const [creatingThreadIds, setCreatingThreadIds] = useState<Set<number>>(
    () => new Set()
  );

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<"zoom" | "pin">("zoom");
  const [showThreads, setShowThreads] = useState(true);
  const [zoomOverlay, setZoomOverlay] = useState<null | {
    x: number;
    y: number;
    ax: number;
    ay: number;
  }>(null);

  const defaultTool = "zoom";
  const resetTool = () => setTool(defaultTool);

  // ===== Threads (imagen visible)
  const selectedImageKey = selectedImage?.name ?? "";
  const threadsRaw = useThreadsStore(
    useShallow((s) =>
      selectedImageKey ? s.byImage[selectedImageKey] ?? EMPTY_ARR : EMPTY_ARR
    )
  );

  const threadToImage = useThreadsStore((s) => s.threadToImage);

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

  // Lista para render (filtrada; SIN reordenar). Numeración viene del provider.
  const threadsForRender = useMemo(
    () => (threadsRaw ?? EMPTY_ARR).filter((t: any) => t.status !== "deleted"),
    [threadsRaw]
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

  // Fuente de hidratación por hilo
  const [sourceByTid, setSourceByTid] = useState<Map<number, HydratedSource>>(
    new Map()
  );
  const markSource = useCallback((tid: number, src: HydratedSource) => {
    setSourceByTid((prev) => {
      const cur = prev.get(tid);
      if (cur === "live" || cur === src) return prev;
      const m = new Map(prev);
      m.set(tid, src);
      return m;
    });
  }, []);

  // Eventos DOM para marcar "live" + read when active
  useEffect(() => {
    const onLive = (e: any) => {
      const tid = e?.detail?.tid as number | undefined;
      if (!tid) return;
      setSourceByTid((prev) => {
        const cur = prev.get(tid);
        if (cur === "live") return prev;
        const m = new Map(prev);
        const activeTid = useThreadsStore.getState().activeThreadId;
        m.set(tid, tid !== activeTid ? "live" : "cache");
        return m;
      });
    };
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
    window.addEventListener("rev:thread-live", onLive);
    window.addEventListener("rev:thread-unread-ready", onUnreadReady);
    return () => {
      window.removeEventListener("rev:thread-live", onLive);
      window.removeEventListener("rev:thread-unread-ready", onUnreadReady);
    };
  }, []);

  /** ==================== HIDRATACIÓN (cache + live) ==================== */
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
        if (authErr)
          toastError(authErr, {
            title: "No se pudo recuperar el usuario",
            fallback: "Continuamos sin usuario.",
          });
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

        // 4) Mensajes frescos
        if (allThreadIds.length) {
          const { data: msgs, error } = await sb
            .from("review_messages")
            .select(
              `id,thread_id,text,created_at,updated_at,created_by,created_by_username,created_by_display_name,is_system,
               meta:review_message_receipts!review_message_receipts_message_fkey ( user_id, read_at, delivered_at )`
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
          setLoadError("No se pudo actualizar (modo sin conexión)");
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

  /** ==================== Selección por URL (?thread=ID) ==================== */
  useEffect(() => {
    if (suppressFollowThreadOnceRef.current) {
      suppressFollowThreadOnceRef.current = false;
      return;
    }
    if (lastAppliedThreadRef.current === selectedThreadId) return;

    if (selectedThreadId == null) {
      lastAppliedThreadRef.current = null;
      setActiveThreadId(null);
      return;
    }

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
      onSelectImage?.(imgName, { preserveThread: true });
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

  /** ==================== Derivados para ThreadChat ==================== */
  const threadsInImage: Thread[] = useMemo(() => {
    if (!selectedImage?.name) return [] as any;
    return (threadsRaw || [])
      .filter((t) => t.status !== "deleted")
      .map((t) => {
        const list = (msgsByThread[t.id] || []).map((m) => ({
          id: m.id,
          text: m.text,
          createdAt: m.created_at,
          createdByName:
            m.created_by_display_name || m.created_by_username || "Desconocido",
          createdByAuthId: (m as any).created_by ?? null,
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
        } as Thread;
      });
  }, [selectedImage?.name, threadsRaw, msgsByThread, sourceByTid]);

  const resolvedActiveThreadId: number | null = useMemo(() => {
    if (!activeThreadId) return null;
    if (!selectedImage?.name) return null;
    if ((threadsRaw || []).some((t: any) => t.id === activeThreadId))
      return activeThreadId;
    if (activeKey) {
      const th = (threadsRaw || []).find(
        (t: any) =>
          pointKey(selectedImage.name!, Number(t.x), Number(t.y)) === activeKey
      );
      if (th) return th.id;
    }
    return null;
  }, [threadsRaw, selectedImage, activeThreadId, activeKey]);

  /** ==================== Contadores para todo el SKU ==================== */
  const threadStats: ThreadCounts = useMemo(() => {
    let pending = 0,
      reopened = 0,
      corrected = 0;
    for (const key of Object.keys(threadsByNeededImages)) {
      const list = (threadsByNeededImages as any)[key] as Thread[];
      for (const t of list) {
        if (t.status === "deleted") continue;
        if (t.status === "pending") pending++;
        else if (t.status === "reopened") reopened++;
        else if (t.status === "corrected") corrected++;
      }
    }
    const total = pending + reopened + corrected;
    return { pending, reopened, corrected, total };
  }, [threadsByNeededImages]);

  /** =============== Reglas extra para VALIDAR SKU (UI + guardas) =============== */
  const blockedByNeedsCorrection = skuStatus === "needs_correction";
  const canValidateByRules = !blockedByNeedsCorrection;

  /** ==================== Acciones de estado del SKU ==================== */
  const upsertSkuStatus = useStatusesStore((s) => s.upsertSku);

  const handleValidateSku = useCallback(async () => {
    if (!canValidateByRules) {
      emitToast({
        variant: "warning",
        title: "No se puede validar",
        description: "El SKU tiene correcciones pendientes.",
      });
      return;
    }
    try {
      setSkuStatusBusy(true);
      const response = await fetch("/api/sku/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: sku.sku, status: "validated" }),
      }).then((r) => r);
      if (!response.ok) {
        toastError(response.body, { title: "Fallo al validar el SKU" });
        return;
      }
      resetTool();
      // Optimista
      upsertSkuStatus({
        sku: sku.sku,
        status: "validated" as SkuStatus,
        images_total: sku.counts.total,
        images_needing_fix: 0,
        updated_at: new Date().toISOString(),
      });
      setValidatedModalOpen(true);
    } catch (e) {
      toastError(e, { title: "Fallo al validar el SKU" });
    } finally {
      setSkuStatusBusy(false);
    }
  }, [canValidateByRules, sku.sku, sku.counts.total, upsertSkuStatus]);

  const handleReopenSku = useCallback(async () => {
    try {
      setSkuStatusBusy(true);
      const ok = await fetch("/api/sku/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: sku.sku, status: "reopened" }),
      }).then((r) => r.ok);
      if (!ok) throw new Error("No se pudo reabrir el SKU.");
      upsertSkuStatus({
        sku: sku.sku,
        status: "reopened" as any,
        images_total: sku.counts.total,
        images_needing_fix: sku.counts.needs_correction,
        updated_at: new Date().toISOString(),
      });
      emitToast({
        variant: "success",
        title: "SKU reabierto",
        description: "Puedes volver a añadir hilos y mensajes.",
      });
    } catch (e) {
      toastError(e, { title: "Fallo al reabrir el SKU" });
    } finally {
      setSkuStatusBusy(false);
    }
  }, [sku.sku, sku.counts.total, sku.counts.needs_correction, upsertSkuStatus]);

  /** ==================== Acciones de hilos ==================== */
  const createThreadAt = useCallback(
    async (imgName: string, x: number, y: number) => {
      if (isSkuValidated) {
        emitToast({
          variant: "warning",
          title: "SKU validado",
          description:
            "Este SKU está validado. Reábrelo para poder crear hilos nuevos.",
        });
        return;
      }
      const rx = roundTo(x, 3);
      const ry = roundTo(y, 3);
      suppressFollowThreadOnceRef.current = true;

      const tempId = createThreadOptimistic(imgName, rx, ry);
      setCreatingThreadIds((prev) => {
        const n = new Set(prev);
        n.add(tempId);
        return n;
      });

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

        // SOLO promociona selección si este temp sigue siendo el activo
        const curActive = useThreadsStore.getState().activeThreadId;
        if (curActive === tempId) {
          setActiveThreadId(realId);
          startTransition(() => {
            if (selectedThreadId !== realId) onSelectThread?.(realId);
          });
        }

        // Quita este temp del set de "creating"
        setCreatingThreadIds((prev) => {
          const n = new Set(prev);
          n.delete(tempId);
          return n;
        });

        try {
          enqueueSendSystemMessage(realId, sysText);
        } catch {
          /* opcional */
        }
      } catch (e) {
        rollbackCreate(tempId);
        // Limpia este temp del set creating
        setCreatingThreadIds((prev) => {
          const n = new Set(prev);
          n.delete(tempId);
          return n;
        });
        // Si el activo era el temp borrado, límpialo
        const curActive = useThreadsStore.getState().activeThreadId;
        if (curActive === tempId) setActiveThreadId(null);

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
      isSkuValidated,
    ]
  );

  const addMessage = useCallback(
    async (threadId: number, text: string) => {
      if (isSkuValidated) {
        emitToast({
          variant: "warning",
          title: "SKU validado",
          description:
            "Este SKU está validado. Reábrelo para escribir mensajes.",
        });
        return;
      }
      // Si el hilo está en creación (temp), no permitimos aún
      if (creatingThreadIds.has(threadId)) return;

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
    [isSkuValidated, creatingThreadIds]
  );

  const toggleThreadStatus = useCallback(
    async (_imgName: string, threadId: number, next: ThreadStatus) => {
      if (isSkuValidated) {
        emitToast({
          variant: "warning",
          title: "SKU validado",
          description:
            "Este SKU está validado. Reábrelo para cambiar el estado de los hilos.",
        });
        return;
      }

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
      } catch {
        /* opcional */
      }

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
    [setThreadStatus, username, isSkuValidated]
  );

  const removeThread = useCallback(
    async (id: number) => {
      if (isSkuValidated) {
        emitToast({
          variant: "warning",
          title: "SKU validado",
          description: "Este SKU está validado. Reábrelo para borrar hilos.",
        });
        return;
      }
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
      // Nada extra: el provider reenumera al detectar borrados.
    },
    [setThreadStatus, resolvedActiveThreadId, onSelectThread, isSkuValidated]
  );

  /** ==================== UI helpers ==================== */
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

  const selectImage = useCallback(
    (index: number) => {
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
    },
    [images, onSelectImage, onSelectThread, setActiveThreadId, update]
  );

  const handleImageClick = async (e: React.MouseEvent) => {
    if (!selectedImage?.name) return;
    if (tool === "zoom") {
      openZoomAtEvent(e);
      return;
    }
    if (tool !== "pin") return;
    if (isSkuValidated) {
      emitToast({
        variant: "warning",
        title: "SKU validado",
        description: "Este SKU está validado. Reábrelo para crear hilos.",
      });
      return;
    }
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    setShowThreads(true);
    await createThreadAt(selectedImage.name, xPct, yPct);
  };

  const parentCursor =
    tool === "pin" && !isSkuValidated ? "crosshair" : "zoom-in";

  /** ==================== Atajos ==================== */
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
        if (!isSkuValidated) setTool("pin");
        else
          emitToast({
            variant: "warning",
            title: "SKU validado",
            description: "Este SKU está validado. Reábrelo para crear hilos.",
          });
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
  }, [
    images.length,
    selectedImageIndex,
    zoomOverlay,
    isSkuValidated,
    selectImage,
  ]);

  /** ==================== Unread por imagen ==================== */
  const unreadByImage = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const img of images) {
      const arr = threadsByNeededImages[img.name] || EMPTY_ARR;
      out[img.name] = (arr as Thread[]).some(
        (t) => t.status !== "deleted" && hasUnreadInThread(t.id)
      );
    }
    return out;
  }, [images, threadsByNeededImages]);

  const imageStatusByName = useMemo(() => {
    const out: Record<string, "finished" | "needs_correction"> = {};
    for (const img of images) {
      const s = (img as any)?.status;
      if (s === "finished" || s === "needs_correction") out[img.name] = s;
    }
    return out;
  }, [images]);

  /** ==================== Swipe en móvil ==================== */
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchEndX.current = null;
    };
    const handleTouchMove = (e: TouchEvent) => {
      touchEndX.current = e.touches[0].clientX;
    };
    const handleTouchEnd = () => {
      if (
        touchStartX.current != null &&
        touchEndX.current != null &&
        Math.abs(touchStartX.current - touchEndX.current) > 50
      ) {
        const dir = touchStartX.current - touchEndX.current;
        if (dir > 0 && selectedImageIndex < images.length - 1)
          selectImage(selectedImageIndex + 1);
        else if (dir < 0 && selectedImageIndex > 0)
          selectImage(selectedImageIndex - 1);
      }
      touchStartX.current = null;
      touchEndX.current = null;
    };
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [images.length, selectedImageIndex, imgRef, selectImage]);

  /** ==================== Render ==================== */
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
            <HomeIcon />
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
              <SearchIcon />
            </button>

            <button
              className={`${styles.toolBtn} ${
                tool === "pin" ? styles.toolActive : ""
              } ${isSkuValidated && styles.disabled}`}
              aria-pressed={tool === "pin"}
              title={
                isSkuValidated
                  ? "SKU validado (bloqueado)"
                  : "Añadir nuevo hilo"
              }
              onClick={() =>
                !isSkuValidated
                  ? setTool("pin")
                  : emitToast({
                      variant: "warning",
                      title: "SKU validado",
                      description:
                        "Este SKU está validado. Reábrelo para crear hilos.",
                    })
              }
            >
              <PinIcon />
            </button>

            <button
              className={`${styles.toolBtn} ${
                !showThreads ? styles.toolActive : ""
              }`}
              aria-pressed={!showThreads}
              title={`${showThreads ? "Ocultar" : "Mostrar"} hilos — T`}
              onClick={() => setShowThreads((v) => !v)}
            >
              <EyeOffIncon />
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

            {/* Dots: numeración estable compartida via DotNumbersProvider */}
            {showThreads &&
              threadsForRender.map((th, idxRender) => {
                const topPx = imgBox.offsetTop + (th.y / 100) * imgBox.height;
                const leftPx = imgBox.offsetLeft + (th.x / 100) * imgBox.width;
                const bg = colorByStatus(th.status);
                const isActive = resolvedActiveThreadId === th.id;
                const hasUnread = hasUnreadInThread(th.id);
                const num = dot?.getNumber(th.x, th.y) ?? idxRender + 1;

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
                    aria-label={`Hilo #${num} — ${STATUS_LABEL[th.status]}`}
                  >
                    {num}
                    {hasUnread && (
                      <div
                        className={styles.unreadBadge}
                        title="Mensajes sin leer"
                      >
                        <ChatIcon />
                      </div>
                    )}
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

        {/* Strip de thumbnails + card a la derecha */}
        <div className={styles.bottomStrip}>
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
            unreadByImage={unreadByImage}
            imageStatusByName={imageStatusByName}
          />
          {nextSkuCandidate && nextSkuCandidate.sku !== sku.sku && (
            <NextSkuCard
              sku={nextSkuCandidate}
              onGo={(code) => onGoToSku?.(code)}
              title="Siguiente SKU listo"
            />
          )}
        </div>
      </div>

      {/* ===== SidePanel con el botón único + reglas de validación ===== */}
      <SidePanel
        name={selectedImage?.name || ""}
        skuStatus={skuStatus}
        skuStatusBusy={skuStatusBusy}
        onValidateSku={handleValidateSku}
        onUnvalidateSku={handleReopenSku}
        threads={threadsInImage}
        activeThreadId={resolvedActiveThreadId}
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
        onlineUsers={onlineUsers}
        loading={loading}
        initialCollapsed={false}
        composeLocked={
          !!(
            resolvedActiveThreadId &&
            creatingThreadIds.has(resolvedActiveThreadId)
          )
        }
        statusLocked={
          resolvedActiveThreadId != null &&
          pendingStatusMap.has(resolvedActiveThreadId)
        }
        validationLock={isSkuValidated}
        pendingStatusIds={new Set(Array.from(pendingStatusMap.keys()))}
        imagesReadyToValidate={imagesReadyToValidate}
        totalImages={totalImages}
        skuThreadCounts={threadStats}
        blockValidateByNeedsCorrection={blockedByNeedsCorrection}
      />

      {/* Modal de éxito tras validar */}
      <Modal
        open={validatedModalOpen}
        onClose={() => setValidatedModalOpen(false)}
        title={`SKU ${sku.sku} validado con éxito`}
      >
        <p>Puedes continuar con el siguiente SKU.</p>
        {nextSkuCandidate ? (
          <NextSkuCard
            sku={nextSkuCandidate}
            onGo={(code) => {
              setValidatedModalOpen(false);
              onGoToSku?.(code);
            }}
            title="Siguiente SKU listo"
          />
        ) : (
          <p>No hay más SKUs pendientes en tu selección.</p>
        )}
      </Modal>

      {zoomOverlay && selectedImage?.url && (
        <ZoomOverlay
          imageName={selectedImage?.name || ""}
          src={selectedImage.bigImgUrl || selectedImage.url}
          threads={threadsInImage}
          activeThreadId={resolvedActiveThreadId}
          currentUsername={username}
          hideThreads={!showThreads}
          setHideThreads={setShowThreads}
          validationLock={isSkuValidated}
          pendingStatusIds={new Set(Array.from(pendingStatusMap.keys()))}
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
              if (creatingThreadIds.has(threadId)) return;
              if (selectedImage?.name) addMessage(threadId, text);
            } catch (e) {
              toastError(e, { title: "No se pudo enviar el mensaje" });
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
          onCreateThreadAt={(x: number, y: number) => {
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
