import { sheets, drive  } from "./google";
import type {
  AnnotationThread,
  ReviewJSON,
  ReviewsBySkuResponse,
  ImageItem,
} from "@/types/review";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const REVIEW_SHEET = process.env.GOOGLE_REVIEW_SHEET || "01.Revisión";
const APP_SHEET = process.env.SHEET_NAME_APP || "Revision app";
// Estructura de la hoja de revisiones:

// Rango de SKUs (columna con SKUs)
const SKU_RANGE = `${REVIEW_SHEET}!${process.env.SKUS_RANGE}`;
// Hoja de imágenes: A: SKU | B: Filename | C: URL/DriveID/Link
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

/** -------------- SKUs ------------------ */
export async function getAllSkus(): Promise<string[]> {
  if (!SHEET_ID) {
    throw new Error("Falta GOOGLE_SHEET_ID en .env.local");
  }
  const rows = await readRange(SKU_RANGE);
  const skus = rows
    .map((r) => (r?.[0] ?? "").toString().trim())
    .filter(Boolean);
  return Array.from(new Set(skus));
}

/** -------------- Imágenes por SKU ------------------ */
export async function getImagesForSku(sku: string): Promise<[] | null> {
try {
    // 1. Buscar SKU en la hoja de revisiones para obtener carpeta principal


    const rows = await readRange(IMAGES_RANGE);
    if (!rows || rows.length === 0) return null;

    const imageDataRow = rows.find((row) => row[0] === sku);
    if (!imageDataRow) return null;

    const mainFolderUrl = imageDataRow[1];

    if (!mainFolderUrl) return null;

    // 2. Extraer folderId de la URL
    const folderIdMatch = mainFolderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (!folderIdMatch || !folderIdMatch[1]) return null;

    const mainFolderId = folderIdMatch[1];

    // 3. Buscar subcarpeta "1200px"
    const subfolderResponse = await drive.files.list({
      q: `'${mainFolderId}' in parents and name = '1200px'`,
      fields: "files(id)",
    });
    if (!subfolderResponse.data.files || subfolderResponse.data.files.length === 0) return null;

    const subfolderId = subfolderResponse.data.files[0].id;

    // 4. Listar imágenes de esa subcarpeta
    const imageFilesResponse = await drive.files.list({
      q: `'${subfolderId}' in parents and mimeType contains 'image/'`,
      fields: "files(id, name)",
      orderBy: "name",
    });
    if (!imageFilesResponse.data.files || imageFilesResponse.data.files.length === 0) return null;
    console.log(imageFilesResponse.data.files)


    return imageFilesResponse.data.files
  } catch (err: any) {
    console.error("Error en getImageData:", err.message);
    return null;
  }
}

/** -------------- Revisiones (JSON en columna C) ------------------ */
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
        maxRev = Math.max(maxRev, parsed.revision);
      }
    } catch {
      // ignorar filas rotas
    }
  }
  return maxRev;
}

/** Lee las anotaciones de la última revisión por filename */
export async function getReviewsBySku(sku: string): Promise<ReviewsBySkuResponse> {
  const rows = await readAllReviewRows();
  // 0 => SKU, 1 => filename, 2 => JSON (revision)
  // {"revision":1,
  //   "points":[
  //     {"id":1757515629133,
  //       "x":47,
  //       "y":35.41666666666667,
  //       "messages":[{
  //         "id":1757515629134,
  //         "text":"d",
  //         "createdAt":"2025-09-10T14:47:09.133Z"
  //       }]
  //       }
  //     ]
  //   }

  const reviewsPerFile = new Map<string, ReviewJSON>();
  for (const row of rows) {
    const [rSku, filename, json] = row;
    if (rSku !== sku || !filename || !json) continue;
    //create a dictionary wit filename as key and points as value
    //fill
    reviewsPerFile.set(filename, JSON.parse(json) as ReviewJSON);

  }
  console.log(reviewsPerFile)
  return Object.fromEntries(reviewsPerFile)
}

/** Guarda filas (una por imagen) para una revisión nueva */
export async function appendReviewRows(
  sku: string,
  revision: number,
  byFilename: Record<string, AnnotationThread[]>
) {
  const now = new Date().toISOString();
  const values: string[][] = Object.entries(byFilename).map(([filename, points]) => {
    const json: ReviewJSON = { revision, points };
    return [sku, filename, JSON.stringify(json), now];
  });

  if (!values.length) return;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: ANOTATIONS_RANGE,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}
