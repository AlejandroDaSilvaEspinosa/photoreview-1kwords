// src/lib/data.ts
import { sheets, drive } from "./google";
import { unstable_cache } from "next/cache";
import type {
  AnnotationThread,
  ReviewJSON,
  ImageItem, // asegúrate de que coincide con lo que uso más abajo
} from "@/types/review";
import {SkuWithImages} from "@/types/review"; 

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const REVIEW_SHEET = process.env.GOOGLE_REVIEW_SHEET || "01.Revisión";
const APP_SHEET = process.env.SHEET_NAME_APP || "Revision app";

// Rango de SKUs (columna con SKUs)
const SKU_RANGE = `${REVIEW_SHEET}!${process.env.SKUS_RANGE}`;
// Hoja de imágenes: A: SKU | B: url/id carpeta Drive
const IMAGES_RANGE = `${REVIEW_SHEET}!${process.env.IMAGES_RANGE}`;
const ANOTATIONS_RANGE = `${APP_SHEET}!${process.env.ANOTATIONS_RANGE}`;

/** Util: lee un rango y devuelve rows */
async function readRange(range: string): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });
  return (res.data.values || []) as string[][];
}

/** ---------------- SKUs ---------------- */


export async function getAllSkus(): Promise<SkuWithImages[]> {
  if (!SHEET_ID) {
    throw new Error("Falta GOOGLE_SHEET_ID en .env.local");
  }

  const rows = await readRange(SKU_RANGE);

  // Mapeo + espera concurrente
  const mapped = await Promise.all(
    rows.map(async (r): Promise<SkuWithImages | null> => {
      const sku = String(r?.[0] ?? "").trim();
      if (!sku) return null;

      // 2ª columna: url/id de carpeta
      const folder = (r?.[1] as string | undefined) ?? null;
      const images = (await getImageUrlThumbnail(folder)) ?? [];

      return { sku, images };
    })
  );

  // Dedupe por SKU
  const bySku = new Map<string, SkuWithImages>();
  for (const item of mapped) {
    if (!item) continue;
    if (!bySku.has(item.sku)) bySku.set(item.sku, item);
  }
  return [...bySku.values()];
}

export const getCachedSkus = unstable_cache(
  async () => getAllSkus(),
  ["skus-cache-v1"],
  { revalidate: 60 * 15, tags: ["skus"] } // 15 min
);

/** Devuelve las imágenes (thumbnails + url) de la subcarpeta 1200px */
export async function getImageUrlThumbnail(
  driveMainFolderSKU: string | null
): Promise<ImageItem[] | null> {
  if (!driveMainFolderSKU) return null;

  // 1) Sacar folderId de la URL
  const mainFolderId =
    driveMainFolderSKU.match(/(?<=folders\/)[\w-]+/)?.[0] ??
    driveMainFolderSKU.match(/[?&]id=([\w-]+)/)?.[1] ??
    null;

  if (!mainFolderId) return null;

  // 2) Buscar subcarpeta "1200px"
  const subfolderResponse = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '1200px'`,
    fields: "files(id)",
  });
  const subfolderId = subfolderResponse.data.files?.[0]?.id;
  if (!subfolderId) return null;

  // 3) Listar imágenes
  const imageFilesResponse = await drive.files.list({
    q: `'${subfolderId}' in parents and mimeType contains 'image/'`,
    fields: "files(id,name)",
    orderBy: "name",
  });
  const files = imageFilesResponse.data.files ?? [];
  if (!files.length) return null;

  const sizeThumbnail = 60;
  const sizeListing = 600;

  // 4) Construir objetos ImageItem
  const images: ImageItem[] = files.map((file) => {
    const id = file.id!;
    const name = file.name ?? id;

    // ⚠️ ADAPTA este objeto a TU ImageItem:
    // si tu ImageItem usa `filename`, usa `filename: name`
    // si usa `name`, usa `name`
    const obj = {
      // si tu tipo es { filename: string; ... } 👉 filename: name,
      // si tu tipo es { name: string; ... }     👉 name,
      filename: name, // <— cámbialo a 'name' si tu ImageItem lo exige
      url: `https://drive.google.com/uc?id=${id}`,
      listingImageUrl: `https://lh3.googleusercontent.com/d/${id}=s${sizeListing}-c`,
      thumbnailUrl: `https://lh3.googleusercontent.com/d/${id}=s${sizeThumbnail}-c`,
    } as unknown as ImageItem;

    return obj;
  });

  return images;
}

/** -------------- Imágenes por SKU ------------------ */
export async function getImagesForSku(sku: string): Promise<ImageItem[] | null> {
  const rows = await readRange(IMAGES_RANGE);
  if (!rows.length) return null;

  const imageDataRow = rows.find((row) => row?.[0] === sku);
  if (!imageDataRow) return null;

  const mainFolderUrl = (imageDataRow[1] as string | undefined) ?? null;
  const images = await getImageUrlThumbnail(mainFolderUrl);
  return images ?? null;
}

/** -------------- Revisiones (JSON en columna) ------------------ */
async function readAllReviewRows(): Promise<string[][]> {
  return readRange(ANOTATIONS_RANGE);
}

export async function getLatestRevisionForSku(sku: string): Promise<number> {
  const rows = await readAllReviewRows();
  let maxRev = 0;
  for (const row of rows) {
    const [rSku, , json] = row;
    if (rSku !== sku || !json) continue;
    try {
      const parsed = JSON.parse(json) as ReviewJSON;
      if (typeof parsed.revision === "number") {
        if (parsed.revision > maxRev) maxRev = parsed.revision;
      }
    } catch {
      // fila rota -> ignorar
    }
  }
  return maxRev;
}

/** Lee las anotaciones de la última revisión por filename */
export type ReviewsByFile = Record<string, ReviewJSON>;

export async function getReviewsBySku(sku: string): Promise<ReviewsByFile> {
  const rows = await readAllReviewRows();
  const out: ReviewsByFile = {};

  for (const row of rows) {
    const [rSku, filename, json] = row;
    if (rSku !== sku || !filename || !json) continue;
    try {
      out[filename] = JSON.parse(json) as ReviewJSON;
    } catch {
      // fila rota -> ignorar
    }
  }
  return out;
}

/** Guarda filas (una por imagen) para una revisión nueva */
export async function appendReviewRows(
  sku: string,
  revision: number,
  byFilename: Record<string, AnnotationThread[]>
) {
  const now = new Date().toISOString();
  const values: string[][] = Object.entries(byFilename).map(
    ([filename, points]) => {
      const json: ReviewJSON = { revision, points };
      return [sku, filename, JSON.stringify(json), now];
    }
  );

  if (!values.length) return;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: ANOTATIONS_RANGE,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}
