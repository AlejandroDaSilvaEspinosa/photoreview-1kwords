// src/lib/notifications/presenter.ts
import type { NotificationRow } from "@/stores/notifications";

export type Presentation = {
  title: string;
  description: string;
  variant: "info" | "success" | "warning" | "error";
  actionLabel?: string;
  deeplink?: string; // ?sku=...&image=...&thread=...
};

export function buildDeeplink(n: NotificationRow): string | undefined {
  // Mensajes e hilos: ir directo al hilo si tenemos datos suficientes
  if (n.thread_id && n.sku && n.image_name) {
    const q = new URLSearchParams({
      sku: n.sku,
      image: n.image_name,
      thread: String(n.thread_id),
    });
    return `?${q.toString()}`;
  }

  // Estados de imagen → ir a imagen
  if (n.type === "image_status_changed" && n.sku && n.image_name) {
    const q = new URLSearchParams({ sku: n.sku, image: n.image_name });
    return `?${q.toString()}`;
  }

  // Estados de SKU → ir a la ficha del SKU
  if (n.type === "sku_status_changed" && n.sku) {
    const q = new URLSearchParams({ sku: n.sku });
    return `?${q.toString()}`;
  }

  return undefined;
}

export function presentNotification(n: NotificationRow): Presentation {
  const TITLE: Record<NotificationRow["type"], string> = {
    new_message: "Nuevo mensaje",
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

  // Descripción: usa message si viene, si no, el excerpt
  const description = (n.message && n.message.trim()) ||
                      (n as any).excerpt ||  // por si la añades luego a tu tipado
                      "";

  const actionLabel =
    (n.image_name && n.sku) ? "Abrir imagen" :
    (n.sku) ? "Abrir SKU" :
    undefined;

  return {
    title: TITLE[n.type] ?? "Notificación",
    description,
    variant: VARIANT[n.type] ?? "info",
    actionLabel,
    deeplink,
  };
}
