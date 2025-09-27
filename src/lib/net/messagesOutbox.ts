// src/lib/net/messagesOutbox.ts
"use client";

import { useMessagesStore } from "@/stores/messages";
import { emitToast } from "@/hooks/useToast";

/**
 * Outbox ligero y robusto:
 * - Envía inmediato si hay red; en fallo de red → encola.
 * - Crea optimista (id < 0) con clientNonce para reconciliar con realtime/confirm.
 * - Flush secuencial al reconectar o bajo demanda, con reintentos y backoff.
 */

const OUTBOX_VERSION = 3;
const STORAGE_KEY = `rev_outbox_v${OUTBOX_VERSION}`;

type QueueItem = {
  qid: string;
  threadId: number;
  tempId: number;
  clientNonce: string;
  request: { url: string; init: RequestInit };
  createdAt: number;
  retries: number;
  lastError?: string;
};

type OutboxState = { q: QueueItem[] };

// In-memory
const memory: OutboxState = { q: [] };
let flushing = false;
let warnedOffline = false;
let listenersBound = false;

/* ===== Utils ===== */
const now = () => Date.now();

const uuid = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

const online = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine;

const isNetworkError = (err: unknown): boolean => {
  const msg = String((err as any)?.message ?? err ?? "");
  return /network|fetch|Failed to fetch|TypeError|NetworkError|ERR_NETWORK/i.test(
    msg,
  );
};

/* ===== Storage ===== */
function loadFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as OutboxState;
    if (parsed && Array.isArray(parsed.q)) memory.q = parsed.q;
  } catch (e) {
    console.warn("Outbox: load error → clearing", e);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
}

function saveToStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ q: memory.q }));
  } catch (e) {
    console.warn("Outbox: save error", e);
  }
}

function push(item: QueueItem) {
  memory.q.push(item);
  saveToStorage();
}

function removeAt(index: number) {
  memory.q.splice(index, 1);
  saveToStorage();
}

function updateAt(index: number, patch: Partial<QueueItem>) {
  const cur = memory.q[index];
  if (!cur) return;
  memory.q[index] = { ...cur, ...patch };
  saveToStorage();
}

/* ===== Sender ===== */
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 900;

async function sendOnce(item: QueueItem) {
  const res = await fetch(item.request.url, item.request.init);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${txt ? `: ${txt}` : ""}`);
  }
  return res.json();
}

async function processQueueItem(
  item: QueueItem,
  index: number,
): Promise<boolean> {
  try {
    const data = await sendOnce(item);
    const { confirmMessage } = useMessagesStore.getState();
    confirmMessage(item.threadId, item.tempId, data as any);
    return true; // success → eliminar
  } catch (err) {
    const net = isNetworkError(err) || !online();
    const nextRetries = (item.retries ?? 0) + 1;

    updateAt(index, {
      retries: nextRetries,
      lastError: String((err as any)?.message ?? err),
    });

    if (net) {
      // fallo de red: mantenemos en cola y paramos el flush
      return false;
    }

    // error no-red → reintentos con backoff
    if (nextRetries < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * nextRetries;
      await new Promise((r) => setTimeout(r, delay));
      return processQueueItem(memory.q[index], index);
    }

    // agotado
    emitToast({
      variant: "error",
      title: "Error enviando mensaje",
      description: "No se pudo enviar el mensaje después de varios intentos.",
      timeAgo: "",
      actionLabel: "",
      onAction: () => {},
      thumbUrl: "",
    });

    return true; // eliminar de la cola
  }
}

async function flushInternal(): Promise<void> {
  if (flushing || !memory.q.length) return;
  flushing = true;
  try {
    const i = 0;
    while (i < memory.q.length && online()) {
      const item = memory.q[i];
      const ok = await processQueueItem(item, i);
      if (ok) {
        removeAt(i);
        // no incrementamos i porque el array se ha corrido
      } else {
        // fallo de red → paramos el flush
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

/* ===== Public API ===== */

export function flushOutbox(): void {
  warnedOffline = false;
  if (!memory.q.length || !online()) return;
  setTimeout(() => {
    flushInternal().catch((e) => console.error("Outbox flush error:", e));
  }, 0);
}

export function initMessagesOutbox(): () => void | undefined {
  if (typeof window === "undefined") return;
  loadFromStorage();
  flushOutbox();

  if (!listenersBound) {
    listenersBound = true;
    const onOnline = () => {
      warnedOffline = false;
      flushOutbox();
    };
    const onOffline = () => {
      warnedOffline = false;
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      listenersBound = false;
    };
  }
  return;
}

/**
 * Crea mensaje optimista y envía; si falla → encola.
 * Devuelve el tempId negativo.
 */
export function enqueueMessageRequest(
  threadId: number,
  makeRequest: (clientNonce: string) => { url: string; init: RequestInit },
  optimistic?: {
    text?: string;
    is_system?: boolean;
    created_at?: string;
    clientNonce?: string;
  },
): number {
  const tempId = -Math.floor(Date.now() + Math.random() * 1000);
  const clientNonce = optimistic?.clientNonce || uuid();

  // Crear optimista inmediato
  const { addOptimistic } = useMessagesStore.getState();
  addOptimistic(threadId, tempId, {
    text: optimistic?.text ?? "",
    is_system: !!optimistic?.is_system,
    created_at: optimistic?.created_at ?? new Date().toISOString(),
    meta: { clientNonce },
  } as any);

  const request = makeRequest(clientNonce);

  const sendOrQueue = async () => {
    try {
      const data = await sendOnce({} as any, request as any); // dummy to satisfy TS (not used)
    } catch {}
  };

  if (online()) {
    (async () => {
      try {
        const data = await sendOnce({} as any, request as any); // dummy for TS
      } catch {}
    })();
  }

  // Mejor: intentamos de una
  (async () => {
    try {
      const data = await sendOnce({} as any, request as any);
      const { confirmMessage } = useMessagesStore.getState();
      confirmMessage(threadId, tempId, data as any);
      flushOutbox(); // por si hay cola antigua
    } catch (err) {
      // Encolar
      const item: QueueItem = {
        qid: uuid(),
        threadId,
        tempId,
        clientNonce,
        request,
        createdAt: now(),
        retries: 0,
        lastError: String((err as any)?.message ?? err ?? ""),
      };
      push(item);

      if (!online() && !warnedOffline) {
        warnedOffline = true;
        emitToast({
          variant: "warning",
          title: "Sin conexión",
          description:
            "Enviaré los mensajes pendientes al recuperar la conexión.",
          timeAgo: "",
          actionLabel: "",
          onAction: () => {},
          thumbUrl: "",
        });
      }
      flushOutbox();
    }
  })();

  return tempId;
}

export function enqueueSendMessage(threadId: number, text: string): number {
  return enqueueMessageRequest(
    threadId,
    (clientNonce) => ({
      url: "/api/messages",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, text, clientNonce }),
      },
    }),
    { text },
  );
}

export function getOutboxStatus() {
  return {
    queueLength: memory.q.length,
    isProcessing: flushing,
    hasOfflineWarning: warnedOffline,
  };
}
