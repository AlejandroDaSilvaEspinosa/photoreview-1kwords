"use client";

import { fetchJsonRetry } from "@/lib/net/retryFetch";
import { createVersionedCacheNS } from "@/lib/cache/versioned";
import { useMessagesStore } from "@/stores/messages";
import { emitToast } from "@/hooks/useToast";

// ===== Config =====
const OUTBOX_VER = 1;
const STORAGE_NS = "rev_outbox";
const outboxCache = createVersionedCacheNS<{ q: QueueItem[] }>(STORAGE_NS, OUTBOX_VER);

// Retries: 5s, 10s, 15s, 30s y después cada 30s.
const RETRY_STEPS_MS = [5000, 10000, 15000, 30000] as const;
const FINAL_INTERVAL_MS = 30000;

// ===== Tipos =====
type QueueItem = {
  qid: string;
  threadId: number;
  tempId: number;
  // Petición cruda, para que no tengamos que adivinar tu payload:
  request: {
    url: string;
    init: RequestInit;
  };
  attempt: number;        // Nº de reintentos realizados (no cuenta el primer intento fallido)
  nextAt: number;         // timestamp ms del próximo intento
  createdAt: number;
  lastError?: string;
};

type OutboxState = {
  q: QueueItem[];
};

// ===== Estado/worker en memoria =====
const memory: OutboxState = { q: [] };
let timer: number | null = null;
let running = false;
let warnedOffline = false;

// ===== Utilidades =====
const now = () => Date.now();
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Cálculo del próximo delay según nº de intentos previos
function nextDelayMs(attempt: number): number {
  // attempt: 0 -> 1ª reprogramación (5s), 1 -> 10s, 2 -> 15s, 3 -> 30s, >=4 -> 30s
  if (attempt < RETRY_STEPS_MS.length) return RETRY_STEPS_MS[attempt];
  return FINAL_INTERVAL_MS;
}

function load() {
  const payload = outboxCache.load("outbox");
  if (payload?.q) memory.q = payload.q;
}

function save() {
  outboxCache.save("outbox", { q: memory.q });
}

function scheduleTick(ms = 0) {
  if (timer != null) window.clearTimeout(timer);
  timer = window.setTimeout(tick, ms);
}

function pickNextDue(): QueueItem | null {
  if (!memory.q.length) return null;
  const t = now();
  // Tomamos el primero vencido por orden de nextAt (y estable por creación)
  memory.q.sort((a, b) => (a.nextAt - b.nextAt) || (a.createdAt - b.createdAt));
  return memory.q[0] && memory.q[0].nextAt <= t ? memory.q[0] : null;
}

function removeByQid(qid: string) {
  const i = memory.q.findIndex((x) => x.qid === qid);
  if (i >= 0) {
    memory.q.splice(i, 1);
    save();
  }
}

function reschedule(item: QueueItem, err: unknown) {
  item.attempt += 1;
  item.nextAt = now() + nextDelayMs(item.attempt - 1);
  item.lastError = (err as any)?.message ?? String(err ?? "Error");
  save();
}

// Dispara el worker cuando volvemos online
function onOnline() {
  scheduleTick(0);
}

async function tick() {
  if (running) return;
  running = true;

  try {
    // Si no hay elementos, no seguimos
    if (!memory.q.length) {
      return;
    }

    // Si estamos offline, reprogramamos un pulso suave y salimos
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (!warnedOffline) {
        warnedOffline = true;
        emitToast({
          variant: "warning",
          title: "Sin conexión",
          description: "Tus mensajes quedarán en cola y se enviarán al recuperar la conexión.",
          timeAgo: "",
          actionLabel: "",
          onAction: () => {},
          thumbUrl: "",
        });
      }
      scheduleTick(Math.min(FINAL_INTERVAL_MS, 5000));
      return;
    }

    warnedOffline = false;

    const due = pickNextDue();
    if (!due) {
      // No hay nada vencido: programa al siguiente vencimiento
      const nextAt = memory.q.reduce((min, it) => Math.min(min, it.nextAt), Number.POSITIVE_INFINITY);
      const delay = Math.max(0, nextAt - now());
      scheduleTick(delay);
      return;
    }

    // Procesamos un elemento (FIFO por nextAt/createdAt). Si quieres asegurar
    // estrictamente orden por hilo, puedes filtrar por threadId aquí.
    let real: any = null;
    try {
      // Un intento de envío (puedes ajustar retries internos si quieres)
      real = await fetchJsonRetry<any>(
        due.request.url,
        due.request.init,
        { retries: 0, timeoutMs: 10000, baseMs: 600 }
      );

      // Confirma el mensaje en el store
      const { confirmMessage } = useMessagesStore.getState();
      confirmMessage(due.threadId, due.tempId, real);

      // Extra: si tu realtime ya insertó antes el mensaje real, confirmMessage
      // lo maneja; y tu upsertFromRealtime elimina el optimista duplicado.
      removeByQid(due.qid);

      // Procesa el siguiente inmediatamente (si lo hay)
      scheduleTick(0);
    } catch (err) {
      // Falló: reprogramamos con la pauta pedida
      reschedule(due, err);
      scheduleTick(Math.max(0, due.nextAt - now()));
    }
  } finally {
    running = false;
  }
}

// ===== API pública =====

/**
 * Inicializa el outbox (idempotente).
 * Llámalo una vez en la app (p.ej. en el layout raíz cliente).
 */
export function initMessagesOutbox() {
  if (typeof window === "undefined") return;
  load();
  window.addEventListener("online", onOnline);
  scheduleTick(0);
}

/**
 * Cola una petición arbitraria (POST de crear mensaje) y crea el optimista.
 * Devuelve el tempId negativo generado.
 */
export function enqueueMessageRequest(
  threadId: number,
  makeRequest: () => { url: string; init: RequestInit },
  optimistic?: { text?: string; is_system?: boolean; created_at?: string }
): number {
  const tempId = -Math.floor(Date.now() + Math.random() * 1000);

  // 1) Añadimos optimista solo si hay texto
  const opt = optimistic ?? {};
  if (typeof opt.text === "string") {
    const { addOptimistic } = useMessagesStore.getState();
    addOptimistic(threadId, tempId, {
      text: opt.text,
      is_system: !!opt.is_system,
      created_at: opt.created_at ?? new Date().toISOString(),
    } as any);
  }

  // 2) Encolamos la petición
  const { url, init } = makeRequest();
  const item: QueueItem = {
    qid: uid(),
    threadId,
    tempId,
    request: { url, init },
    attempt: 0,
    nextAt: now(),
    createdAt: now(),
  };

  memory.q.push(item);
  save();
  scheduleTick(0);

  return tempId;
}
/**
 * Azúcar: encola un envío estándar a /api/messages con { threadId, text }.
 * Ajusta este helper si tu endpoint/payload difiere.
 */
export function enqueueSendMessage(threadId: number, text: string) {
  return enqueueMessageRequest(
    threadId,
    () => ({
      url: "/api/messages",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, text }),
      },
    }),
    { text }
  );
}
