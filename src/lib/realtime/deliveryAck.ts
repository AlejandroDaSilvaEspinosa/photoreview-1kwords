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

// 🛟 Evitar spam de toasts por almacenamiento
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

// 🛟 Evitar spam por fallos de flush
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

class DeliveryAck {
  private uid: string | null = null;
  private queue = new Set<number>();
  private sent = new Set<number>();
  private flushTimer: number | null = null;

  setUser(uid: string | null) {
    this.uid = uid;
    if (uid && this.sent.size === 0) {
      try {
        const raw = sessionStorage.getItem(SENT_KEY);
        if (raw) {
          const arr: number[] = JSON.parse(raw);
          for (const id of arr) this.sent.add(id);
        }
      } catch (e) {
        toastStorageOnce("leer la memoria de entregas de la sesión");
      }
    }
  }

  /** Estado O(1) gracias al índice del store */
  private quickState(id: number): { ld: LD | null; isMine: boolean } {
    return useMessagesStore.getState().quickStateByMessageId(id);
  }

  /** Persistencia con límite */
  private persistSent() {
    try {
      const arr = Array.from(this.sent);
      const slice = arr.length > MAX_SENT_MEMORY ? arr.slice(arr.length - MAX_SENT_MEMORY) : arr;
      sessionStorage.setItem(SENT_KEY, JSON.stringify(slice));
    } catch (e) {
      toastStorageOnce("guardar la memoria de entregas");
    }
  }

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

    this.queue.add(messageId);
    this.schedule();
  }

  private clearTimer() {
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Debounce corto para agrupar IDs */
  private schedule() {
    if (this.flushTimer != null) return;
    this.flushTimer = window.setTimeout(() => this.flush(), 200) as unknown as number;
  }

  /** Intento de envío batched (con filtrado final) */
  async flush() {
    this.clearTimer();
    if (!this.uid || !this.queue.size) return;

    // No trabajamos en background: reprogramamos cuando la página sea visible
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      this.schedule();
      return;
    }

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
      return true; // "sent", "sending" o desconocido
    });

    if (!ids.length) return;

    // Optimista local: subir a delivered (para ajenos)
    const st = useMessagesStore.getState();
    for (const id of ids) st.upsertReceipt(id, this.uid!, null);

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
    } catch (_e) {
      // error → se quedan en queue para reintentar
      this.schedule();
      toastFlushOnce();
    }
  }

  onVisibilityOrOnline() {
    if (typeof document !== "undefined" && document.visibilityState === "visible") this.schedule();
  }

  reset() {
    this.uid = null;
    this.queue.clear();
    this.clearTimer();
    // mantenemos `sent` en sessionStorage para evitar reenvíos tras recarga
  }
}

export const deliveryAck = new DeliveryAck();
