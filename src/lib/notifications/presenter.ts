import type { NotificationRow } from "@/stores/notifications";

export type Presentation = {
  title: string;
  description: string;
  variant: "info" | "success" | "warning" | "error";
  actionLabel?: string;
  deeplink?: string;
};

export function buildDeeplink(n: NotificationRow): string | undefined {
  if (n.thread_id && n.sku && n.image_name) {
    const q = new URLSearchParams({ sku: n.sku, image: n.image_name, thread: String(n.thread_id) });
    return `?${q.toString()}`;
  }
  if (n.type === "image_status_changed" && n.sku && n.image_name) {
    const q = new URLSearchParams({ sku: n.sku, image: n.image_name });
    return `?${q.toString()}`;
  }
  if (n.type === "sku_status_changed" && n.sku) {
    const q = new URLSearchParams({ sku: n.sku });
    return `?${q.toString()}`;
  }
  return undefined;
}

export function presentNotification(n: NotificationRow): Presentation {
  // Títulos por defecto para otros tipos
  const DEFAULT_TITLE: Record<NotificationRow["type"], string> = {
    new_message: "Nuevo mensaje",        // será reemplazado abajo
    new_thread: "Nuevo hilo",
    thread_status_changed: "Estado del hilo",
    image_status_changed: "Estado de imagen",
    sku_status_changed: "Estado del SKU",
  };

  const VARIANT: Record<NotificationRow["type"], "info" | "success" | "warning" | "error"> = {
    new_message: "info",
    new_thread: "info",
    thread_status_changed: "warning",
    image_status_changed: "success",
    sku_status_changed: "success",
  };

  const deeplink = buildDeeplink(n);

  // ===== Caso especial: NEW_MESSAGE =====
  if (n.type === "new_message") {
    // título: "nuevo mensaje en {imagen}"
    const imgName = n.image_name || "";
    const title = imgName ? `Nuevo mensaje en ${imgName}` : "nuevo mensaje";

    // cuerpo: "autor: excerpt"
    const author = n.author_username ? `@${n.author_username}` : "";
    const text = (n.excerpt ?? n.message ?? "").trim();
    const description = author ? `${author}: ${text}` : text;

    return {
      title,
      description,
      variant: VARIANT[n.type],
      actionLabel: "Ver mensaje", // ⬅️ botón solicitado
      deeplink,
    };
  }

  // ===== Resto de tipos =====
  const description = (n.message ?? "").trim();
  return {
    title: DEFAULT_TITLE[n.type] ?? "Notificación",
    description,
    variant: VARIANT[n.type] ?? "info",
    actionLabel:
      (n.image_name && n.sku) ? "Abrir imagen" :
      (n.sku) ? "Abrir SKU" :
      undefined,
    deeplink,
  };
}
