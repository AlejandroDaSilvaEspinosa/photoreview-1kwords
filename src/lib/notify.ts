// Lanza notificación nativa si hay permiso; si no, pide permiso y cae a toast cb.
export async function notifyNative(
  title: string,
  options?: NotificationOptions & { serviceWorkerPath?: string },
) {
  try {
    if (!("Notification" in window)) return false;

    const permission = await (async () => {
      if (Notification.permission !== "default") return Notification.permission;
      return await Notification.requestPermission();
    })();

    if (permission !== "granted") return false;

    // Intenta via SW (mejor para PWA)
    const swUrl = options?.serviceWorkerPath ?? "/sw.js";
    let reg: ServiceWorkerRegistration | null | undefined = null;

    try {
      // registra si no existía
      reg = await navigator.serviceWorker.register(swUrl);
    } catch {
      // ya existía o no se puede registrar; seguimos
      reg = await navigator.serviceWorker.getRegistration();
    }

    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }

    // fallback directo
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}
