// src/lib/net/receiptsOutbox.ts
"use client";

import { useMessagesStore } from "@/stores/messages";
import { emitToast } from "@/hooks/useToast";

/**
 * ReceiptsOutbox
 * - Cola/batch de confirmaciones de entrega/lectura.
 * - Debounce y backoff con jitter.
 * - Dedupe por messageId y promoción de estado: read > delivered.
 * - Persistencia en sessionStorage para no repetir tras refresh.
 * - Optimismo local inmediato (aplica delivered/read en el store).
 */

type ReceiptKind = "delivered" | "read";

const DEBOUNCE_MS = 300; // ventana corta para agrupar
const MAX_BATCH = 256;
const RETRY_BASE_MS = 900;
const RETRY_MAX_MS = 30_000;
const RETRY_JITTER_MS = 250;

const MEM_KEY = "rev:rcpt:sent:v2"; // session memory de recibos confirmados

// Memoria de enviados esta sesión: id -> "d" | "r" (read tapa delivered)
let sentMem: Map<number, "d" | "r"> = new Map();

function loadSentMem() {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(MEM_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as [number, "d" | "r"][];
    if (Array.isArray(arr)) sentMem = new Map(arr);
  } catch {
    /* ignore */
  }
}
function saveSentMem() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      MEM_KEY,
      JSON.stringify(Array.from(sentMem.entries()))
    );
  } catch {
    /* ignore */
  }
}

// Cola en memoria: id -> kind (read gana)
const queue = new Map<number, ReceiptKind>();

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let flushing = false;

const online = () =>
  typeof navigator === "undefined" ? true : navigator.onLine;

function scheduleDebounced() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, DEBOUNCE_MS);
}
function scheduleRetry() {
  if (retryTimer || !queue.size) return;
  const jitter = Math.random() * RETRY_JITTER_MS;
  const delay = Math.min(
    RETRY_BASE_MS * Math.pow(2, Math.max(0, retryAttempt++)) + jitter,
    RETRY_MAX_MS
  );
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!queue.size) return;
    scheduleDebounced();
  }, delay);
}
function resetRetry() {
  retryAttempt = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function promote(a: ReceiptKind | undefined, b: ReceiptKind): ReceiptKind {
  if (a === "read" || b === "read") return "read";
  return "delivered";
}

function optimisticLocal(ids: number[], kind: ReceiptKind) {
  const st = useMessagesStore.getState();
  const uid = st.selfAuthId;
  if (!ids.length) return;

  if (kind === "read") {
    // Aplica read en el store (requiere userId); si no hay uid aún, no optimices (se enviará igual)
    if (uid) {
      for (const id of ids) st.upsertReceipt(id, uid, new Date().toISOString());
    }
  } else {
    // delivered local para mensajes ajenos que estén en "sent"
    st.markDeliveredLocalIfSent(ids);
  }
}

async function postReceipts(payload: {
  readIds?: number[];
  deliveredIds?: number[];
}) {
  const res = await fetch("/api/messages/receipts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${txt ? `: ${txt}` : ""}`);
  }
}

async function flushNow(): Promise<void> {
  if (flushing) return;
  if (!queue.size) return;
  if (!online()) {
    scheduleRetry();
    return;
  }

  flushing = true;
  try {
    // Construir lote respetando promoción y memoria de sesión
    const toRead: number[] = [];
    const toDelivered: number[] = [];

    for (const [id, kind] of queue) {
      // Si ya se envió 'read' en esta sesión, salta
      const mem = sentMem.get(id);
      if (mem === "r") {
        queue.delete(id);
        continue;
      }
      if (kind === "read") {
        toRead.push(id);
      } else {
        // delivered: solo si memoria no tiene 'd' ni 'r'
        if (!mem) toDelivered.push(id);
      }
    }

    // Optimismo local
    if (toDelivered.length) optimisticLocal(toDelivered, "delivered");
    if (toRead.length) optimisticLocal(toRead, "read");

    if (!toDelivered.length && !toRead.length) {
      // Nada que enviar (todo promovido o memorizado)
      queue.clear();
      return;
    }

    // Enviar en una sola llamada con shape combinado
    const payload: { readIds?: number[]; deliveredIds?: number[] } = {};
    if (toRead.length) payload.readIds = toRead.slice(0, MAX_BATCH);
    if (toDelivered.length)
      payload.deliveredIds = toDelivered.slice(0, MAX_BATCH);

    await postReceipts(payload);

    // Marcar enviados en memoria y limpiar queue
    if (payload.deliveredIds) {
      for (const id of payload.deliveredIds) {
        // Solo set 'd' si no hay 'r'
        if (sentMem.get(id) !== "r") sentMem.set(id, "d");
        queue.delete(id);
      }
    }
    if (payload.readIds) {
      for (const id of payload.readIds) {
        sentMem.set(id, "r"); // read tapa delivered
        queue.delete(id);
      }
    }
    saveSentMem();
    resetRetry();

    // Si quedaron más en cola (por límite de lote), vuelve a programar
    if (queue.size) scheduleDebounced();
  } catch (e) {
    // Mantén en cola y reintenta
    scheduleRetry();
    emitToast({
      variant: "warning",
      title: "No se pudieron confirmar recibos",
      description: "Reintentaremos automáticamente en segundo plano.",
      timeAgo: "",
      actionLabel: "",
      onAction: () => {},
      thumbUrl: "",
    });
  } finally {
    flushing = false;
  }
}

/* ============ API pública ============ */

export function initReceiptsOutbox(): () => void {
  if (typeof window === "undefined") return () => {};

  loadSentMem();

  const onOnline = () => {
    resetRetry();
    scheduleDebounced();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") scheduleDebounced();
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("visibilitychange", onVisibility);

  // Primer intento por si quedó cola (otra pestaña la rellenó, etc.)
  scheduleDebounced();

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("visibilitychange", onVisibility);
    if (flushTimer) clearTimeout(flushTimer);
    if (retryTimer) clearTimeout(retryTimer);
  };
}

/** Encola delivered para ids (solo ajenos, dedupe y promoción interna). */
export function enqueueDelivered(ids: number[]) {
  if (!ids?.length) return;
  for (const id of ids) {
    // Si ya tenemos 'read' en queue o mem, ignora delivered
    const mem = sentMem.get(id);
    if (mem === "r") continue;
    const prev = queue.get(id);
    queue.set(id, promote(prev, "delivered"));
  }
  scheduleDebounced();
}

/** Encola read para ids (promueve y tapa delivered). */
export function enqueueRead(ids: number[]) {
  if (!ids?.length) return;
  for (const id of ids) {
    queue.set(id, "read");
  }
  scheduleDebounced();
}

/** “Poke” manual (p.ej. al cambiar de hilo/visibilidad). */
export function pokeReceiptsFlushSoon() {
  scheduleDebounced();
}
