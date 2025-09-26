// src/lib/net/messagesOutbox.ts
"use client";

import { useMessagesStore } from "@/stores/messages";
import { emitToast } from "@/hooks/useToast";

/**
 * Outbox ligero y estable:
 * - Envío inmediato si hay conexión; si falla por red/offline → encola una vez.
 * - Siempre crea optimista (id < 0) con clientNonce para reconciliar con realtime/confirm.
 * - Flush secuencial al recuperar conexión o cuando lo invocas.
 */

const OUTBOX_VER = 2;
const STORAGE_KEY = `rev_outbox_v${OUTBOX_VER}`;

type QueueItem = {
  qid: string;
  threadId: number;
  tempId: number;
  clientNonce: string;
  request: { url: string; init: RequestInit };
  createdAt: number;
};

type OutboxState = { q: QueueItem[] };

const memory: OutboxState = { q: [] };
let flushing = false;
let warnedOffline = false;

/* ===== Utils ===== */
const now = () => Date.now();
const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

const isOnline = () => typeof navigator === "undefined" || navigator.onLine;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as OutboxState;
    if (parsed?.q && Array.isArray(parsed.q)) memory.q = parsed.q;
  } catch {}
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ q: memory.q }));
  } catch {}
}

function push(item: QueueItem) {
  memory.q.push(item);
  save();
}

function shift(): QueueItem | undefined {
  const it = memory.q.shift();
  save();
  return it;
}

/* ===== Flush secuencial ===== */
async function flushInternal() {
  if (flushing) return;
  flushing = true;
  try {
    while (memory.q.length && isOnline()) {
      const item = memory.q[0];

      try {
        const res = await fetch(item.request.url, item.request.init);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        const { confirmMessage } = useMessagesStore.getState();
        confirmMessage(item.threadId, item.tempId, json as any);

        shift();
      } catch (e) {
        const offline = !isOnline();
        const msg = String((e as any)?.message || e || "");
        const networky = /network|fetch|Failed to fetch|TypeError/i.test(msg);

        if (offline || networky) {
          if (!warnedOffline && offline) {
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
          break; // parar flush, esperar reconexión
        }
        // Si es 4xx/5xx no transitorio, mantenemos en cola (decisión del usuario más tarde).
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

export function flushOutbox() {
  warnedOffline = false;
  if (!memory.q.length) return;
  if (!isOnline()) return;
  void flushInternal();
}

/* ===== API pública ===== */

export function initMessagesOutbox() {
  if (typeof window === "undefined") return;
  load();

  flushOutbox();
  window.addEventListener("online", () => {
    warnedOffline = false;
    flushOutbox();
  });
}

/**
 * Encola una petición y crea optimista siempre (mejor UX).
 * Devuelve el tempId negativo.
 */
export function enqueueMessageRequest(
  threadId: number,
  makeRequest: (clientNonce: string) => { url: string; init: RequestInit },
  optimistic?: { text?: string; is_system?: boolean; created_at?: string; clientNonce?: string }
): number {
  const tempId = -Math.floor(Date.now() + Math.random() * 1000);
  const nonce = optimistic?.clientNonce || uid();
  const opt = optimistic ?? {};

  // Crear optimista inmediatamente con clientNonce
  const { addOptimistic } = useMessagesStore.getState();
  addOptimistic(threadId, tempId, {
    text: opt.text,
    is_system: !!opt.is_system,
    created_at: opt.created_at ?? new Date().toISOString(),
    meta: { clientNonce: nonce },
  } as any);

  const req = makeRequest(nonce);

  if (isOnline()) {
    (async () => {
      try {
        const res = await fetch(req.url, req.init);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const { confirmMessage } = useMessagesStore.getState();
        confirmMessage(threadId, tempId, json as any);
        flushOutbox();
      } catch {
        push({ qid: uid(), threadId, tempId, clientNonce: nonce, request: req, createdAt: now() });
        flushOutbox();
      }
    })();
  } else {
    push({ qid: uid(), threadId, tempId, clientNonce: nonce, request: req, createdAt: now() });
  }

  return tempId;
}

export function enqueueSendMessage(threadId: number, text: string) {
  return enqueueMessageRequest(
    threadId,
    (clientNonce) => ({
      url: "/api/messages",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ⚠️ Enviar el nonce para reconciliar en realtime (el backend debe propagarlo)
        body: JSON.stringify({ threadId, text, clientNonce }),
      },
    }),
    { text }
  );
}
