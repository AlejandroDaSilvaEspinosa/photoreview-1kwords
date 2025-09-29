import type { SkuStatus, SkuWithImagesAndStatus } from "@/types/review";

/** Etiquetas de estado (por si las necesitas en varios sitios) */
export const STATUS_LABEL: Record<SkuStatus, string> = {
  pending_validation: "Pendiente de validación",
  needs_correction: "Con correcciones",
  validated: "Validado",
  reopened: "Reabierto",
};

/**
 * Prioridad:
 * 1) SKUs en pending_validation y sin correcciones (counts.needs_correction === 0).
 * 2) Fallback: SKUs con needs_correction o reopened.
 * 3) Último recurso: cualquiera distinto al actual.
 */
export function pickNextSku(
  skus: SkuWithImagesAndStatus[],
  currentSku?: string | null
): SkuWithImagesAndStatus | null {
  if (!skus.length) return null;

  const startIdx = currentSku
    ? skus.findIndex((s) => s.sku === currentSku)
    : -1;
  const ordered =
    startIdx >= 0
      ? [...skus.slice(startIdx + 1), ...skus.slice(0, startIdx + 1)]
      : skus;

  const isReady = (s: SkuWithImagesAndStatus) =>
    s.status === "pending_validation" &&
    (s.counts?.needs_correction ?? 0) === 0;

  const primary = ordered.find((s) => s.sku !== currentSku && isReady(s));
  if (primary) return primary;

  const secondary = ordered.find(
    (s) =>
      s.sku !== currentSku &&
      (s.status === "needs_correction" || s.status === "reopened")
  );
  if (secondary) return secondary;

  const anyone = ordered.find((s) => s.sku !== currentSku);
  return anyone ?? null;
}
