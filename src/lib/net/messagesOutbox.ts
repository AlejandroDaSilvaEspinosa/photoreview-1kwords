// src/lib/net/messagesOutbox.ts
"use client";

import { useMessagesStore } from "@/stores/messages";
import { emitToast } from "@/hooks/useToast";
import { MessageMeta } from "@/types/review";

/**
 * Outbox con debounce + batch + retry/backoff:
 * - Encola mensajes con clientNonce y tempId (negativo).
 * - Debounce (1s) para agrupar envíos.
 * - Batch POST /api/messages { messages: [...] } con mapeo por clientNonce.
 * - Reintentos con backoff y persistencia (localStorage).
 * - Reintenta solo, incluso si el evento `online` no llega (ticker con backoff).
 */

const OUTBOX_VERSION = 4;
const STORAGE_KEY = `rev_outbox_v${OUTBOX_VERSION}`;

const DEBOUNCE_MS = 500;
const MAX_BATCH = 24; // tamaño máx del batch
const MAX_RETRIES = 3; // por item (errores no-red)
const RETRY_BASE_MS = 900; // base para backoff
const RETRY_MAX_MS = 30_000; // techo de backoff
const RETRY_JITTER_MS = 250; // jitter para evitar sincronías

type QueueItem = {
  qid: string;
  threadId: number;
  tempId: number;
  clientNonce: string;
  text: string;
  isSystem?: boolean;
  createdAtIso: string;
  retries: number;
  lastError?: string;
};

type OutboxState = { q: QueueItem[] };

// ===== In-memory
const memory: OutboxState = { q: [] };
let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

let listenersBound = false;
let warnedOffline = false;

// Retry loop
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0; // solo para errores de red/offline

// ===== Utils
const online = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine;

const isNetworkError = (err: unknown): boolean => {
  const msg = String((err as any)?.message ?? err ?? "");
  return /network|fetch|Failed to fetch|TypeError|NetworkError|ERR_NETWORK/i.test(
    msg
  );
};

const uuid = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

/**
 * tempId seguro (negativo) combinando time + random + seq (todos separados)
 * time (ms) -> ~44 bits; random -> 8 bits; seq -> 8 bits. Total <= 52 bits (Number seguro).
 */
let _tmpSeq = 0;
const nextTempId = () => {
  const t = Date.now(); // ~2^44
  const r = Math.floor(Math.random() * 256); // 8 bits
  _tmpSeq = (_tmpSeq + 1) & 0xff; // 8 bits
  const n = t * 256 + (r << 8) + _tmpSeq; // <= 2^52
  return -n;
};

// ===== Storage
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
    } catch {
      //no Opp
    }
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

function removeByQid(qid: string) {
  const idx = memory.q.findIndex((x) => x.qid === qid);
  if (idx >= 0) {
    memory.q.splice(idx, 1);
    saveToStorage();
  }
}

function updateByQid(qid: string, patch: Partial<QueueItem>) {
  const idx = memory.q.findIndex((x) => x.qid === qid);
  if (idx >= 0) {
    memory.q[idx] = { ...memory.q[idx], ...patch };
    saveToStorage();
  }
}

// ===== Retry loop helpers
function resetRetry() {
  retryAttempt = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetrySoon() {
  if (!memory.q.length) {
    resetRetry();
    return;
  }
  if (retryTimer) return;
  const jitter = Math.random() * RETRY_JITTER_MS;
  const delay = Math.min(
    RETRY_BASE_MS * Math.pow(2, Math.max(0, retryAttempt++)) + jitter,
    RETRY_MAX_MS
  );
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!memory.q.length) {
      resetRetry();
      return;
    }
    // Si ya hay un flush debounced en curso, no hacemos nada; si no, lo disparamos.
    if (flushTimer == null) scheduleDebouncedFlush();
  }, delay);
}

// ===== Sender (batch)
type BatchInput = Array<{
  clientNonce: string;
  threadId: number;
  text: string;
  isSystem?: boolean;
  createdAt?: string;
}>;

type BatchOutputItem = {
  clientNonce: string;
  row?: any;
  error?: string;
};

type BatchResponse = { results: BatchOutputItem[] };

async function sendBatch(items: QueueItem[]): Promise<BatchResponse> {
  const messages: BatchInput = items.map((it) => ({
    clientNonce: it.clientNonce,
    threadId: it.threadId,
    text: it.text,
    isSystem: it.isSystem ?? false,
    createdAt: it.createdAtIso,
  }));

  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${txt ? `: ${txt}` : ""}`);
  }
  return res.json();
}

function scheduleDebouncedFlush() {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;

    // Si estamos offline o el navegador cree que lo estamos, no intentes ahora; programa retry.
    if (!online()) {
      scheduleRetrySoon();
      return;
    }

    flushInternal().catch((e) => {
      // Si falló por red, programa retry; si no, solo log.
      if (isNetworkError(e)) scheduleRetrySoon();
      else console.error("Outbox flush error:", e);
    });
  }, DEBOUNCE_MS);
}

async function flushInternal(): Promise<void> {
  if (flushing) return;
  if (!memory.q.length) {
    resetRetry();
    return;
  }
  if (!online()) {
    scheduleRetrySoon();
    return;
  }

  flushing = true;
  try {
    // Flush por tandas
    while (memory.q.length && online()) {
      const batch = memory.q.slice(0, MAX_BATCH);
      let resp: BatchResponse | null = null;

      try {
        resp = await sendBatch(batch);
        // éxito global → resetea el backoff
        resetRetry();
      } catch (err) {
        // Error “global” (red/servidor) → paramos y reintentamos luego
        if (isNetworkError(err) || !online()) {
          scheduleRetrySoon();
          break;
        }

        // Error no-red global → aumentar retries y descartar si agota
        for (const it of batch) {
          const nextRetries = (it.retries ?? 0) + 1;
          updateByQid(it.qid, {
            retries: nextRetries,
            lastError: String((err as any)?.message ?? err),
          });
          if (nextRetries >= MAX_RETRIES) {
            removeByQid(it.qid);
            emitToast({
              variant: "error",
              title: "Error enviando mensaje",
              description:
                "No se pudo enviar el mensaje después de varios intentos.",
              timeAgo: "",
              actionLabel: "",
              onAction: () => {},
              thumbUrl: "",
            });
          }
        }
        // programa retry para lo que quedó
        scheduleRetrySoon();
        break;
      }

      // Respuesta válida: procesamos item por item
      const { results = [] } = resp || {};
      const byNonce = new Map<string, BatchOutputItem>();
      for (const r of results) byNonce.set(r.clientNonce, r);

      for (const it of batch) {
        const r = byNonce.get(it.clientNonce);
        if (!r) {
          const nextRetries = (it.retries ?? 0) + 1;
          updateByQid(it.qid, {
            retries: nextRetries,
            lastError: "Missing result for clientNonce",
          });
          if (nextRetries >= MAX_RETRIES) {
            removeByQid(it.qid);
            emitToast({
              variant: "error",
              title: "Error enviando mensaje",
              description: "El servidor no devolvió confirmación del mensaje.",
              timeAgo: "",
              actionLabel: "",
              onAction: () => {},
              thumbUrl: "",
            });
          }
          continue;
        }

        if (r.error) {
          const nextRetries = (it.retries ?? 0) + 1;
          updateByQid(it.qid, { retries: nextRetries, lastError: r.error });
          if (nextRetries >= MAX_RETRIES) {
            removeByQid(it.qid);
            emitToast({
              variant: "error",
              title: "Mensaje no enviado",
              description: r.error,
              timeAgo: "",
              actionLabel: "",
              onAction: () => {},
              thumbUrl: "",
            });
          }
          continue;
        }

        // Éxito → confirmamos el optimista
        try {
          const real = r.row!;
          const { confirmMessage } = useMessagesStore.getState();
          confirmMessage(it.threadId, it.tempId, {
            id: real.id,
            thread_id: real.thread_id,
            text: real.text,
            created_at: real.created_at || real.createdAt || it.createdAtIso,
            updated_at:
              real.updated_at ||
              real.updatedAt ||
              real.created_at ||
              it.createdAtIso,
            created_by: real.created_by,
            created_by_username:
              real.created_by_username ?? real.author_username ?? undefined,
            created_by_display_name:
              real.created_by_display_name ??
              real.author_display_name ??
              undefined,
            is_system: !!real.is_system,
            meta: {
              clientNonce: it.clientNonce,
              localDelivery: "sent",
              isMine: true,
            } as any,
          } as any);
        } finally {
          removeByQid(it.qid);
        }
      }
    }
  } finally {
    flushing = false;
    // Si sigue habiendo cola (p. ej., paramos por error de red), asegura retry.
    if (memory.q.length) scheduleRetrySoon();
  }
}

// ===== Public API

export function initMessagesOutbox(): (() => void) | undefined {
  if (typeof window === "undefined") return undefined;
  loadFromStorage();

  // flush inicial (por si quedó cola)
  scheduleDebouncedFlush();

  if (!listenersBound) {
    listenersBound = true;

    const onOnline = () => {
      warnedOffline = false;
      resetRetry();
      scheduleDebouncedFlush();
    };

    const onOffline = () => {
      warnedOffline = false;
      // programa un retry a futuro (por si el navegador no emite 'online' luego)
      scheduleRetrySoon();
    };

    const onVisibility = () => {
      // al volver a enfocarse o mostrarse, intenta flushear si hay cola
      if (document.visibilityState === "visible" && memory.q.length) {
        scheduleDebouncedFlush();
      }
    };

    const onFocus = () => {
      if (memory.q.length) scheduleDebouncedFlush();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      listenersBound = false;
      resetRetry();
    };
  }

  return undefined;
}

export function flushOutbox(): void {
  warnedOffline = false;
  if (!memory.q.length) return;

  // cancela timers y fuerza un intento inmediato
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  resetRetry();

  void flushInternal();
}

/** Encola un mensaje normal del usuario. Devuelve tempId negativo. */
export function enqueueSendMessage(threadId: number, text: string): number {
  const tempId = nextTempId();
  const clientNonce = uuid();
  const createdAtIso = new Date().toISOString();

  const { addOptimistic } = useMessagesStore.getState();
  addOptimistic(threadId, tempId, {
    text,
    created_at: createdAtIso,
    updated_at: createdAtIso,
    created_by: "me",
    created_by_username: "Tú",
    created_by_display_name: "Tú",
    is_system: false,
    client_nonce: clientNonce,
    meta: { clientNonce, localDelivery: "sending" } as MessageMeta,
  });

  const item: QueueItem = {
    qid: uuid(),
    threadId,
    tempId,
    clientNonce,
    text,
    isSystem: false,
    createdAtIso,
    retries: 0,
  };

  push(item);

  if (!online() && !warnedOffline) {
    warnedOffline = true;
    emitToast({
      variant: "warning",
      title: "Sin conexión",
      description: "Enviaré los mensajes pendientes al recuperar la conexión.",
      timeAgo: "",
      actionLabel: "",
      onAction: () => {},
      thumbUrl: "",
    });
  }

  // intenta pronto; si no hay red, programará retry con backoff
  scheduleDebouncedFlush();
  return tempId;
}

/** Encola un mensaje de sistema. */
export function enqueueSendSystemMessage(
  threadId: number,
  text: string
): number {
  const tempId = nextTempId();
  const clientNonce = uuid();
  const createdAtIso = new Date().toISOString();

  const { addOptimistic } = useMessagesStore.getState();
  addOptimistic(threadId, tempId, {
    text,
    created_at: createdAtIso,
    updated_at: createdAtIso,
    created_by: "system",
    created_by_username: "system",
    created_by_display_name: "system",
    is_system: true,
    client_nonce: clientNonce,
    meta: { clientNonce, localDelivery: "sent" } as MessageMeta,
  });

  const item: QueueItem = {
    qid: uuid(),
    threadId,
    tempId,
    clientNonce,
    text,
    isSystem: true,
    createdAtIso,
    retries: 0,
  };

  push(item);
  scheduleDebouncedFlush();
  return tempId;
}

export function getOutboxStatus() {
  return {
    queueLength: memory.q.length,
    isProcessing: flushing,
    hasOfflineWarning: warnedOffline,
  };
}
