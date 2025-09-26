// lib/realtime/deliveryAck.ts
"use client";

import { useMessagesStore } from "@/stores/messages";
import { emitToast } from "@/hooks/useToast";

/**
 * DEV NOTES (entrega "delivered"):
 * - Solo marcamos "delivered" para MENSAJES AJENOS y visibles (yo receptor).
 * - Para mis mensajes, el "delivered/read" lo determina el otro lado (sus recibos).
 * - Dedupe por sesión (sessionStorage) para no re-POSTear tras refresh.
 * - Nunca degradamos LD: si localmente ya es delivered/read no hacemos nada.
 */

type LD = "sending" | "sent" | "delivered" | "read";

const SENT_KEY = "rev:ack:delivered:v1";
const MAX_SENT_MEMORY = 5000;
const DEBOUNCE_MS = 200;

/* =========================
 * Toasts: one-shot helpers
 * ========================= */
let storageWarned = false;
const toastStorageOnce = (action: string) => {
  if (storageWarned) return;
  storageWarned = true;
  emitToast({
    variant: "warning",
    title: "Almacenamiento limitado",
    description: `No se pudo ${action}. Algunas confirmaciones podrían repetirse o no persistir.`,
    durationMs: 7000,
  });
};

let flushWarned = false;
const toastFlushOnce = () => {
  if (flushWarned) return;
  flushWarned = true;
  emitToast({
    variant: "warning",
    title: "Problema al confirmar entregas",
    description: "No se pudieron marcar algunas entregas. Reintentaremos automáticamente.",
    durationMs: 6000,
  });
};

/* =========================
 * DeliveryAck
 * ========================= */
class DeliveryAck {
  private uid: string | null = null;
  private queue = new Set<number>();
  private sent = new Set<number>();
  private flushTimer: number | null = null;

  setUser(uid: string | null) {
    this.uid = uid;

    // Cargar memoria de sesión solo una vez (primer set con uid válido)
    if (uid && this.sent.size === 0) {
      try {
        const raw = sessionStorage.getItem(SENT_KEY);
        if (raw) {
          const arr = JSON.parse(raw) as unknown;
          if (Array.isArray(arr)) {
            for (const id of arr) {
              if (typeof id === "number") this.sent.add(id);
            }
          }
        }
      } catch {
        toastStorageOnce("leer la memoria de entregas de la sesión");
      }
    }
  }

  /** Unifica el shape del selector del store y garantiza el objeto esperado */
  private quickState(id: number): { ld: LD | null; isMine: boolean } {
    const st = useMessagesStore.getState() as any;

    // El selector puede devolver: string | null | { ld, isMine }
    const res = st?.quickStateByMessageId?.(id);

    // Caso 1: ya devuelve el objeto target
    if (res && typeof res === "object") {
      const ld = (res.ld ?? null) as LD | null;
      const isMine = !!res.isMine;
      return { ld, isMine };
    }

    // Caso 2: devuelve solo el LD como string/null
    const ld = (res ?? null) as LD | null;

    // Obtener isMine por otros índices/fallbacks del store
    const isMine =
      typeof st?.isMineByMessageId === "function"
        ? !!st.isMineByMessageId(id)
        : !!(st?.messagesById?.get?.(id)?.isMine ?? st?.messagesById?.[id]?.isMine);

    return { ld, isMine };
  }

  /** Persistencia con límite para evitar crecer infinito en sessionStorage */
  private persistSent() {
    try {
      const arr = Array.from(this.sent);
      const slice = arr.length > MAX_SENT_MEMORY ? arr.slice(arr.length - MAX_SENT_MEMORY) : arr;
      sessionStorage.setItem(SENT_KEY, JSON.stringify(slice));
    } catch {
      toastStorageOnce("guardar la memoria de entregas");
    }
  }

  /** Entrada desde notificaciones/realtime */
  enqueueFromNotification(messageId: number | null | undefined) {
    if (!this.uid || !messageId) return;
    if (this.sent.has(messageId)) return;

    const { ld, isMine } = this.quickState(messageId);

    // Nunca marcamos delivered para mensajes propios
    if (isMine) {
      this.sent.add(messageId);
      return;
    }

    // Si ya está delivered/read localmente → evita red y marca enviado en sesión
    if (ld === "delivered" || ld === "read") {
      this.sent.add(messageId);
      return;
    }

    // "sending" | "sent" | null/desconocido → encolar
    this.queue.add(messageId);
    this.schedule();
  }

  private clearTimer() {
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Debounce corto para agrupar IDs en un solo POST */
  private schedule() {
    if (this.flushTimer != null) return;
    this.flushTimer = window.setTimeout(() => this.flush(), DEBOUNCE_MS) as unknown as number;
  }

  /** Intento de envío batched (con filtrado final) */
  async flush() {
    this.clearTimer();
    if (!this.uid || !this.queue.size) return;

    // No trabajamos si la pestaña no es visible: reprogramamos
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      this.schedule();
      return;
    }

    // Filtrado final antes de POST
    const ids = Array.from(this.queue).filter((id) => {
      if (this.sent.has(id)) {
        this.queue.delete(id);
        return false;
      }

      const { ld, isMine } = this.quickState(id);

      if (isMine) {
        this.queue.delete(id);
        this.sent.add(id);
        return false;
      }

      if (ld === "delivered" || ld === "read") {
        this.queue.delete(id);
        this.sent.add(id);
        return false;
      }

      return true; // candidatos ("sent" | "sending" | null)
    });

    if (!ids.length) return;

    // Optimista local: subir a delivered (solo ajenos)
    const st: any = useMessagesStore.getState();
    for (const id of ids) {
      // upsertReceipt(messageId, userIdWhoReceived, readAt|null) → delivered
      st?.upsertReceipt?.(id, this.uid!, null);
    }

    try {
      await fetch("/api/messages/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageIds: ids, mark: "delivered" }),
      });

      ids.forEach((id) => {
        this.sent.add(id);
        this.queue.delete(id);
      });

      this.persistSent();
    } catch {
      // Error → se quedan en queue para reintentar
      this.schedule();
      toastFlushOnce();
    }
  }

  /** Úsalo en listeners de 'visibilitychange' y 'online' */
  onVisibilityOrOnline() {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      this.schedule();
    }
  }

  /** Limpia estado volátil (conserva `sent` en sessionStorage) */
  reset() {
    this.uid = null;
    this.queue.clear();
    this.clearTimer();
  }
}

export const deliveryAck = new DeliveryAck();
