"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Thread, ThreadState, ThreadStatus,SkuWithImagesAndStatus} from "@/types/review";
import { useSkuChannel } from "@/lib/useSkuChannel";



type ReviewsPayload = Record<string, { points?: Thread[] }>;

type ThreadRow = {
  id: number;
  sku: string;
  image_name: string;
  x: number;
  y: number;
  status: ThreadStatus;
};

type MessageRow = {
  id: number;
  thread_id: number;
  text: string;
  created_at: string;
  created_by?: string | null;
  created_by_username: string | null;
  created_by_display_name: string | null;
  is_system: boolean | null;
};

type ChannelHandlers = {
  onThreadInsert?: (t: ThreadRow) => void;
  onThreadUpdate?: (t: ThreadRow) => void;
  onThreadDelete?: (t: ThreadRow) => void;
  onMessageInsert?: (m: MessageRow) => void;
  onMessageUpdate?: (m: MessageRow) => void;
  onMessageDelete?: (m: MessageRow) => void;
};
const STATUS_LABEL = {
  pending: "Pendiente",
  corrected: "Corregido",
  reopened: "Reabierto",
  deleted: "Eliminado",
} as const;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const fp = (image: string, x: number, y: number) => `${image}|${round3(x)}|${round3(y)}`;

export function useThreads(selectedSku: SkuWithImagesAndStatus, username?: string) {
  const {sku, images} = selectedSku

  const [threads, setThreads] = useState<ThreadState>({});
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Mapa threadId -> imageName
  const threadToImage = useRef<Map<number, string>>(new Map());
  // Puntos pendientes: key -> { tempId, imgName }
  const pendingThreads = useRef<Map<string, { tempId: number; imgName: string }>>(new Map());

  // ====== CARGA INICIAL ======
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/reviews/${sku}`, { cache: "no-store" });
        if (!res.ok) throw new Error("No se pudieron cargar las anotaciones");
        const payload: ReviewsPayload = (await res.json()) as ReviewsPayload;

        const merged: ThreadState = {};
        const map = new Map<number, string>();

        for (const img of images) {
          const name = img.name;
          if (!name) continue;
          const list = payload[name]?.points ?? [];
          // Normaliza x/y a 3 decimales para estabilidad visual/keys
          const norm = list.map((t) => ({
            ...t,
            x: round3(typeof t.x === "number" ? t.x : Number(t.x)),
            y: round3(typeof t.y === "number" ? t.y : Number(t.y)),
          }));
          merged[name] = norm;
          for (const t of norm) map.set(t.id, name);
        }

        if (!cancelled) {
          threadToImage.current = map;
          setThreads(merged);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Error de carga";
          setLoadError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (images.length > 0) run();
    return () => {
      cancelled = true;
    };
  }, [sku, images]);

  // ====== Crear thread en (x,y) ======
  const createThreadAt = useCallback(
    async (imgName: string, x: number, y: number) => {
      // Redondea para que coincida con las claves/keys
      const rx = round3(x);
      const ry = round3(y);
      const key = fp(imgName, rx, ry);

      const tempId = -Date.now();

      const sysText = `**@${username ?? "usuario"}** ha creado un nuevo hilo de revisión.`;
      const sysOptimisticMsg = {
        id: -Math.floor(Math.random() * 1e9) - 1, // id temporal distinto al del hilo
        text: sysText,
        createdAt: new Date().toISOString(),
        createdByName: "system",
        isSystem: true,
      };

      const tempThread: Thread = {
        id: tempId,
        x: rx,
        y: ry,
        status: "pending",
        messages: [sysOptimisticMsg],
      };

      setThreads((prev) => ({
        ...prev,
        [imgName]: [...(prev[imgName] || []), tempThread],
      }));
      setActiveThreadId(tempId);
      setActiveKey(key);
      pendingThreads.current.set(key, { tempId, imgName });

      const created = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, imageName: imgName, x: rx, y: ry }),
      })
        .then((r) => r.json())
        .catch(() => null);

      if (created?.threadId) {
        const realId = created.threadId as number;
        threadToImage.current.set(realId, imgName);
        setActiveThreadId((prev) => (prev === tempId ? realId : prev));

        setThreads((prev) => {
          const list = prev[imgName] || [];
          const existsReal = list.some((t) => t.id === realId);
          if (existsReal) {
            return { ...prev, [imgName]: list.filter((t) => t.id !== tempId) };
          }
          return {
            ...prev,
            [imgName]: list.map((t) => (t.id === tempId ? { ...t, id: realId } : t)),
          };
        });

        // Mensaje del sistema en backend (auditoría + realtime)
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: realId, text: sysText, isSystem: true }),
        }).catch(() => null);

        pendingThreads.current.delete(key);
      } else {
        // Revertir si falla
        setThreads((prev) => {
          const list = prev[imgName] || [];
          return { ...prev, [imgName]: list.filter((t) => t.id !== tempId) };
        });
        pendingThreads.current.delete(key);
        setActiveThreadId((prev) => (prev === tempId ? null : prev));
        setActiveKey((prev) => (prev === key ? null : prev));
      }
    },
    [sku, username]
  );

  // ====== Mensajes ======
  const addMessage = useCallback(
    async (imgName: string, threadId: number, text: string) => {
      const tempId = -Date.now();
      const optimistic = {
        id: tempId,
        text,
        createdAt: new Date().toISOString(),
        createdByName: username || "Yo",
        isSystem: false,
      };

      setThreads((prev) => ({
        ...prev,
        [imgName]: (prev[imgName] || []).map((t) =>
          t.id === threadId ? { ...t, messages: [...t.messages, optimistic] } : t
        ),
      }));

      const created = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, text }),
      })
        .then((r) => r.json())
        .catch(() => null);

      if (created?.id) {
        const createdId = created.id as number;
        const createdAt = (created.createdAt as string) || new Date().toISOString();
        const createdByName = (created.createdByName as string) || username || "Usuario";

        // Si el realtime ya metió el mensaje, esto no hará nada. Si no, sustituye el optimista.
        setThreads((prev) => {
          const list = prev[imgName] || [];
          const next = list.map((t) => {
            if (t.id !== threadId) return t;
            const replaced = t.messages.map((m) =>
              m.id === tempId
                ? { ...m, id: createdId, createdAt, createdByName, isSystem: !!created.isSystem }
                : m
            );
            return { ...t, messages: replaced };
          });
          return { ...prev, [imgName]: next };
        });
      }
    },
    [username]
  );

  // ====== Cambiar estado ======
  const toggleThreadStatus = useCallback(
    async (imgName: string, threadId: number, next: ThreadStatus) => {
      const prevStatus =
        (threads[imgName]?.find((t) => t.id === threadId)?.status as ThreadStatus) ?? "pending";

      // 1) Optimista: cambia status
      setThreads((prev) => ({
        ...prev,
        [imgName]: (prev[imgName] || []).map((t) => (t.id === threadId ? { ...t, status: next } : t)),
      }));

      // 2) Optimista: añade mensaje de sistema (id temporal negativo)
      const text = `**@${username ?? "usuario"}** cambió el estado del hilo a "**${STATUS_LABEL[next]}**".`;
      const tempMsgId = -Math.floor(Math.random() * 1e9) - 1;

      setThreads((prev) => ({
        ...prev,
        [imgName]: (prev[imgName] || []).map((t) =>
          t.id === threadId
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  {
                    id: tempMsgId,
                    text,
                    createdAt: new Date().toISOString(),
                    createdByName: "Sistema",
                    isSystem: true,
                  },
                ],
              }
            : t
        ),
      }));

      // 3) Llamada a API (no añadimos su mensaje aquí; esperamos realtime)
      const res = await fetch("/api/threads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, status: next }),
      }).catch(() => null);

      if (!res || !("ok" in res) || !res.ok) {
        // Revert si falla: status + quitar el optimista
        setThreads((prev) => ({
          ...prev,
          [imgName]: (prev[imgName] || []).map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  status: prevStatus,
                  messages: t.messages.filter((m) => m.id !== tempMsgId),
                }
              : t
          ),
        }));
      }
    },
    [threads, username]
  );


  // ====== Borrado lógico (optimista) ======
  const removeThread = useCallback(async (imgName: string, id: number) => {
    setThreads((prev) => {
      const curr = prev[imgName] || [];
      return { ...prev, [imgName]: curr.filter((t) => t.id !== id) };
    });
    setActiveThreadId((prev) => (prev === id ? null : prev));
    await fetch(`/api/threads/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: id, status: "deleted" as ThreadStatus }),
    }).catch(() => {});
  }, []);

  // ====== REALTIME reconciliación ======
  const upsertThread = useCallback((imgName: string, row: ThreadRow) => {
    // Normaliza coordenadas para coherencia visual
    const rx = round3(row.x);
    const ry = round3(row.y);

    if (row.status === "deleted") {
      setThreads((prev) => {
        const curr = prev[imgName] || [];
        if (!curr.some((t) => t.id === row.id)) return prev;
        return { ...prev, [imgName]: curr.filter((t) => t.id !== row.id) };
      });
      setActiveThreadId((prev) => (prev === row.id ? null : prev));
      return;
    }

    const key = fp(imgName, rx, ry);
    const pending = pendingThreads.current.get(key);

    if (pending) {
      // Sustituye el hilo temporal por el real
      setActiveThreadId((prev) => (prev === pending.tempId ? row.id : prev));
      // Alinea también la activeKey por si el backend normalizó x/y
      setActiveKey((prev) => (prev ? key : prev));

      setThreads((prev) => {
        const curr = prev[imgName] || [];
        const next = curr.map((t) =>
          t.id === pending.tempId ? { ...t, id: row.id, x: rx, y: ry, status: row.status } : t
        );
        return { ...prev, [imgName]: next };
      });
      pendingThreads.current.delete(key);
      return;
    }

    // Upsert normal
    setThreads((prev) => {
      const curr = prev[imgName] || [];
      const idx = curr.findIndex((t) => t.id === row.id);
      if (idx >= 0) {
        const copy = curr.slice();
        copy[idx] = { ...copy[idx], x: rx, y: ry, status: row.status };
        return { ...prev, [imgName]: copy };
      }
      return {
        ...prev,
        [imgName]: [
          ...curr,
          { id: row.id, x: rx, y: ry, status: row.status, messages: [] },
        ],
      };
    });
  }, []);

  const upsertMessage = useCallback(
    (
      imgName: string,
      threadId: number,
      msg: { id: number; text: string; createdAt: string; createdByName?: string; isSystem?: boolean }
    ) => {
      setThreads((prev) => {
        const curr = prev[imgName] || [];
        const next = curr.map((t) => {
          if (t.id !== threadId) return t;

          // 1) Limpia duplicado optimista (system y no-system)
          const cleaned = (t.messages || []).filter((m) => {
            if (m.id >= 0) return true;
            if (m.text !== msg.text) return true;
            if (!!m.isSystem !== !!msg.isSystem) return true;
            // si no es system, intenta comparar autor cuando esté presente
            if (!msg.isSystem) {
              const a = (m.createdByName || "").toLowerCase();
              const b = (msg.createdByName || "").toLowerCase();
              if (a && b && a !== b) return true;
            }
            // Es un optimista que coincide con el real → eliminar
            return false;
          });

          // 2) Si ya existe por id, actualiza (por si viene un UPDATE)
          const byId = cleaned.findIndex((m) => m.id === msg.id);
          if (byId >= 0) {
            const copy = cleaned.slice();
            copy[byId] = { ...copy[byId], ...msg };
            // orden estable por fecha (opcional pero ayuda al no-flicker)
            copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            return { ...t, messages: copy };
          }

          // 3) Si no existe, añade y ordena por fecha
          const added = [...cleaned, msg].sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt)
          );
          return { ...t, messages: added };
        });
        return { ...prev, [imgName]: next };
      });
    },
    []
  );

  const removeMessage = useCallback((imgName: string, threadId: number, messageId: number) => {
    setThreads((prev) => {
      const curr = prev[imgName] || [];
      const next = curr.map((t) =>
        t.id === threadId ? { ...t, messages: t.messages.filter((m) => m.id !== messageId) } : t
      );
      return { ...prev, [imgName]: next };
    });
  }, []);

  // Handlers para el canal realtime
  const channelHandlers: ChannelHandlers = useMemo(
    () => ({
      onThreadInsert: (t) => {
        if (!t?.id || !t?.image_name) return;
        threadToImage.current.set(t.id, t.image_name);
        upsertThread(t.image_name, t);
      },
      onThreadUpdate: (t) => {
        if (!t?.id || !t?.image_name) return;
        threadToImage.current.set(t.id, t.image_name);
        upsertThread(t.image_name, t);
      },
      onThreadDelete: (t) => {
        const imgName = threadToImage.current.get(t.id) || t.image_name;
        if (!imgName) return;
        setThreads((prev) => {
          const curr = prev[imgName] || [];
          return { ...prev, [imgName]: curr.filter((x) => x.id !== t.id) };
        });
        setActiveThreadId((prev) => (prev === t.id ? null : prev));
      },
      onMessageInsert: (m) => {
        const imgName = threadToImage.current.get(m.thread_id);
        if (!imgName) return;
        const createdByName = m.created_by_display_name || m.created_by_username || "Usuario";
        upsertMessage(imgName, m.thread_id, {
          id: m.id,
          text: m.text,
          createdAt: m.created_at,
          createdByName,
          isSystem: !!m.is_system,
        });
      },
      onMessageUpdate: (m) => {
        const imgName = threadToImage.current.get(m.thread_id);
        if (!imgName) return;
        const createdByName = m.created_by_display_name || m.created_by_username || "Usuario";
        upsertMessage(imgName, m.thread_id, {
          id: m.id,
          text: m.text,
          createdAt: m.created_at,
          createdByName,
          isSystem: !!m.is_system,
        });
      },
      onMessageDelete: (m) => {
        const imgName = threadToImage.current.get(m.thread_id);
        if (!imgName) return;
        removeMessage(imgName, m.thread_id, m.id);
      },
    }),
    [upsertThread, upsertMessage, removeMessage]
  );

  // Suscripción realtime
  useSkuChannel(sku, channelHandlers);

  return {
    // estado
    threads,
    activeThreadId,
    activeKey,
    loading,
    loadError,
    // acciones
    createThreadAt,
    addMessage,
    toggleThreadStatus,
    removeThread,
    setActiveThreadId,
    setActiveKey,
  };
}
