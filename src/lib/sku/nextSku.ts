// Reutilizable: cómo decidir el “siguiente SKU” a visitar.
import type { SkuStatus, SkuWithImagesAndStatus } from "@/types/review";

/**
 * Prioridad:
 * 1) SKUs con status 'pending_validation' y sin correcciones (needs_correction === 0).
 *    - Preferimos avanzar desde el actual (orden circular: después del actual, luego el resto).
 * 2) Fallback: el primer SKU no-validado (needs_correction > 0 o reopened).
 * 3) Último fallback: cualquier otro distinto al actual.
 */
export function pickNextSku(
  skus: SkuWithImagesAndStatus[],
  currentSku?: string | null
): SkuWithImagesAndStatus | null {
  if (!skus.length) return null;

  const byCode = new Map(skus.map((s) => [s.sku, s]));
  const startIdx = currentSku
    ? skus.findIndex((s) => s.sku === currentSku)
    : -1;

  // Orden circular desde después del actual
  const ordered =
    startIdx >= 0
      ? [...skus.slice(startIdx + 1), ...skus.slice(0, startIdx + 1)]
      : skus;

  const isReadyToValidate = (s: SkuWithImagesAndStatus) =>
    s.status === "pending_validation" && s.counts.needs_correction === 0;

  // 1) Mejor candidato
  const primary = ordered.find(
    (s) => s.sku !== currentSku && isReadyToValidate(s)
  );
  if (primary) return primary;

  // 2) Fallback: algo que no esté validado del todo
  const secondary = ordered.find(
    (s) =>
      s.sku !== currentSku &&
      (s.status === "needs_correction" || s.status === "reopened")
  );
  if (secondary) return secondary;

  // 3) Último recurso: cualquiera que no sea el actual
  const anyone = ordered.find((s) => s.sku !== currentSku);
  return anyone ?? (currentSku ? byCode.get(currentSku) ?? null : null);
}

/** Etiquetas amigables (puedes centralizar si ya las tienes en otro sitio). */
export const STATUS_LABEL: Record<SkuStatus, string> = {
  pending_validation: "Pendiente de validación",
  needs_correction: "Con correcciones",
  validated: "Validado",
  reopened: "Reabierto",
};
