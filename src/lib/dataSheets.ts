// src/lib/data.ts
import { sheets, drive } from "./google";
import { unstable_cache } from "next/cache";
import type {
  SkuWithImages,
  ImageItem, // asegúrate de que coincide con lo que uso más abajo
} from "@/types/review";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const REVIEW_SHEET = process.env.GOOGLE_REVIEW_SHEET || "01.Revisión";

// Rango de SKUs (columna con SKUs)
const SKU_RANGE = `${REVIEW_SHEET}!${process.env.SKUS_RANGE}`;

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

/** Devuelve las imágenes (thumbnails + url) de la subcarpeta 1200px y 3000*/
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

  const subfolderBigImageResponse = await drive.files.list({
    q: `'${mainFolderId}' in parents and name = '3000px'`,
    fields: "files(id)",
  });
  const subfolderBigImageId = subfolderBigImageResponse.data.files?.[0]?.id ?? subfolderId ;


  // 3) Listar imágenes
  const imageFilesResponse = await drive.files.list({
    q: `'${subfolderId}' in parents and mimeType contains 'image/'`,
    fields: "files(id,name)",
    orderBy: "name",
  });
  const files = imageFilesResponse.data.files ?? [];
  if (!files.length) return null;

  const bigImageFilesResponse = await drive.files.list({
    q: `'${subfolderBigImageId}' in parents and mimeType contains 'image/'`,
    fields: "files(id,name)",
    orderBy: "name",
  });

  const bigFiles = bigImageFilesResponse.data.files ?? files;


  const sizeThumbnail = 80;
  const sizeListing = 200;
  const sizeZoom = 3000;

  // 4) Construir objetos ImageItem
  const images: ImageItem[] = files.map((file) => {
    const id = file.id!;
    const name = file.name ?? id;

    const {id :idBigFile} = bigFiles.filter(bf => bf.name == name)[0];

    const obj = {
      name: name, 
      url: `https://drive.google.com/uc?id=${id}`,
      listingImageUrl: `https://lh3.googleusercontent.com/d/${id}=s${sizeListing}-c`,
      thumbnailUrl: `https://lh3.googleusercontent.com/d/${id}=s${sizeThumbnail}-c`,
      bigImgUrl: `https://lh3.googleusercontent.com/d/${idBigFile}=s${sizeZoom}-c`,      
    } as unknown as ImageItem;

    return obj;
  });

  return images;
}

