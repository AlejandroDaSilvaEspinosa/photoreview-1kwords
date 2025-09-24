// src/hooks/useRealtimeToasts.ts
"use client";

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useToast } from "@/hooks/useToast";
import { notifyNative } from "@/lib/notify";
import type { NotificationRow, NotificationType } from "@/stores/notifications";

type Options = {
  onOpenSku?: (sku: string) => void;
  onOpenImage?: (sku: string, imageName: string) => void;
};

const TITLE: Record<NotificationType, string> = {
  new_message: "Nuevo mensaje",
  new_thread: "Nuevo hilo",
  thread_status_changed: "Cambió el estado del hilo",
  image_status_changed: "Cambio de estado de imagen",
  sku_status_changed: "Cambio de estado del SKU",
};

const VARIANT: Record<NotificationType, "info" | "success" | "warning" | "error"> = {
  new_message: "info",
  new_thread: "info",
  thread_status_changed: "warning",
  image_status_changed: "success",
  sku_status_changed: "success",
};

export function useGlobalRealtimeToasts(opts: Options = {}) {
  const { push } = useToast();
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; }, [opts]);

  useEffect(() => {
    const sb = supabaseBrowser();

    (async () => {
      const { data } = await sb.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;

      const ch = sb.channel(`notif-toasts-${uid}`, { config: { broadcast: { ack: true } } });

      // ✅ Sólo INSERT en notifications del usuario actual
      ch.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (p: any) => {
          const row = (p.new as NotificationRow);
          if (!row) return;
          if (row.viewed) return; // sólo nuevas no vistas

          const title = TITLE[row.type] ?? "Notificación";
          const description = row.message || "";
          const variant = VARIANT[row.type] ?? "info";

          const { onOpenImage, onOpenSku } = optsRef.current;
          const actionLabel = row.image_name && onOpenImage ? "Abrir imagen"
                             : row.sku && onOpenSku ? "Abrir SKU"
                             : "";

          push({
            title,
            description,
            variant,
            actionLabel,
            onAction: () => {
              if (row.image_name && row.sku && onOpenImage) return onOpenImage(row.sku, row.image_name);
              if (row.sku && onOpenSku) return onOpenSku(row.sku);
            },
          });

          notifyNative(title, { body: description }).catch(() => {});
        }
      );

      ch.subscribe();
      return () => { sb.removeChannel(ch); };
    })();
  }, [push]);
}
