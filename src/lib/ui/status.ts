// src/lib/ui/status.ts
import type { ThreadStatus, SkuStatus } from "@/types/review";

export const THREAD_LABEL: Record<ThreadStatus, string> = {
  pending: "Pendiente",
  corrected: "Corregido",
  reopened: "Reabierto",
  deleted: "Eliminado",
};

export const SKU_LABEL: Record<SkuStatus, string> = {
  pending_validation: "Pendiente de validación",
  needs_correction: "Con correcciones",
  validated: "Validado",
  reopened: "Reabierto",
};

export const colorByThreadStatus = (s: ThreadStatus) =>
  s === "corrected" ? "#0FA958" : s === "reopened" ? "#FFB000" : s === "deleted" ? "#666" : "#FF0040";

export const nextThreadStatus = (s: ThreadStatus): ThreadStatus =>
  s === "corrected" ? "reopened" : "corrected";

export const toggleThreadStatusLabel = (s: ThreadStatus) =>
  s === "corrected" ? "Reabrir hilo" : "Validar correcciones";
