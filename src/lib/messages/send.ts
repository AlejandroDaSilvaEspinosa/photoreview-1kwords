"use client";

import {
  enqueueSendMessage,
  enqueueMessageRequest,
} from "@/lib/net/messagesOutbox";

/**
 * Envío estándar: POST /api/messages { threadId, text }
 * - Crea optimista y encola reintentos (5s → 10s → 15s → 30s → cada 30s)
 * - Devuelve el tempId negativo del optimista.
 */
export function sendMessage(threadId: number, text: string): number {
  return enqueueSendMessage(threadId, text);
}

/**
 * Envío personalizado: define URL/payload a medida.
 * Útil si tu endpoint no es /api/messages o necesitas campos extra.
 *
 * @example
 * sendMessageCustom(threadId, text, {
 *   url: "/api/messages/create",
 *   body: { thread_id: threadId, text, important: true },
 *   headers: { "X-Feature": "flag" }
 * });
 */
export function sendMessageCustom(
  threadId: number,
  text: string,
  opts: {
    url: string;
    body?: any;
    headers?: Record<string, string>;
    method?: "POST" | "PUT" | "PATCH";
  },
): number {
  const { url, body, headers, method = "POST" } = opts;

  return enqueueMessageRequest(
    threadId,
    () => ({
      url,
      init: {
        method,
        headers: { "Content-Type": "application/json", ...(headers || {}) },
        body: JSON.stringify(body ?? { threadId, text }),
      },
    }),
    { text }, // ← texto visible del optimista
  );
}
