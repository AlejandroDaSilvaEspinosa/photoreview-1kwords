// src/lib/skus.ts
import { unstable_cache } from "next/cache";
import { fetchSkusFromSource } from "./skusSource";

// Esta función hace la consulta "carísima"
export async function fetchSkusFromSource(): Promise<string[]> {
  // TODO: tu lógica real (Google Sheets / DB / etc.)
  // Ejemplo demo:
  const skus = ["SKU-001", "SKU-002", "SKU-003", "SKU-004"];
  return Array.from(new Set(skus)).sort();
}

// Función cacheada, exportada como API pública en servidor
export const getSkus = unstable_cache(
  async () => {
    return await fetchSkusFromSource();
  },
  ["skus-cache-v1"], // clave de caché estable
  {
    revalidate: 60 * 15, // 15 minutos
    tags: ["skus"],      // para poder invalidar manualmente con revalidateTag("skus")
  }
);
