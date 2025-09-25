// lib/realtime/deliveryAck.ts
"use client";

import { useMessagesStore } from "@/stores/messages";

type LD = "sending" | "sent" | "delivered" | "read";

/**
 * ACK de "delivered" centralizado, con:
 * - Queue Set<number> (message_id)
 * - De-dup por sesión (sessionStorage)
 * - Revisión O(1) de estado local (indexById en messages store)
 */
const SENT_KEY = "rev:ack:delivered:v1";
const MAX_SENT_MEMORY = 5000; // limitamos persistencia para no crecer sin control

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
      } catch {}
    }
  }

  /** Estado O(1) gracias al índice del store */
  private quickState(id: number): { ld: LD | null; isMine: boolean } {
    return useMessagesStore.getState().quickStateByMessageId(id);
  }

  /** Almacena en sessionStorage (con límite) */
  private persistSent() {
    try {
      const arr = Array.from(this.sent);
      const slice = arr.length > MAX_SENT_MEMORY ? arr.slice(arr.length - MAX_SENT_MEMORY) : arr;
      sessionStorage.setItem(SENT_KEY, JSON.stringify(slice));
    } catch {}
  }

  /** Añade desde notificación (solo tipo new_message con message_id) */
  enqueueFromNotification(messageId: number | null | undefined) {
    if (!this.uid || !messageId) return;

    // ya enviado en esta sesión → no repetir
    if (this.sent.has(messageId)) return;

    const { ld, isMine } = this.quickState(messageId);

    // nunca marcamos "delivered" para mensajes propios
    if (isMine) {
      this.sent.add(messageId);
      return;
    }
    // si ya está delivered/read localmente → evita red y marca sent-set
    if (ld === "delivered" || ld === "read") {
      this.sent.add(messageId);
      return;
    }

    // casos "sent", "sending" o desconocido (null) → encolar
    this.queue.add(messageId);
    this.schedule();
  }

  /** Borra timer si existe */
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

  /** Intento de envío batched (con nuevo filtrado previo) */
  async flush() {
    this.clearTimer();
    if (!this.uid || !this.queue.size) return;

    // En segundo plano no hacemos trabajo: cuando se haga visible, reintentará
    if (document.visibilityState !== "visible") {
      this.schedule();
      return;
    }

    // Filtrado final: evita duplicar y evita los ya delivered/read
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
    } catch {
      // error → se quedan en queue para reintentar
      this.schedule();
    }
  }

  onVisibilityOrOnline() {
    if (document.visibilityState === "visible") this.schedule();
  }

  reset() {
    this.uid = null;
    this.queue.clear();
    this.clearTimer();
    // mantenemos `sent` en sessionStorage para evitar reenvíos tras recarga
  }
}

export const deliveryAck = new DeliveryAck();
