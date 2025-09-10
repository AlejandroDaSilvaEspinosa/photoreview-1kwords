import { sheets, drive } from './google';
import { SPREADSHEET_ID, SHEET_NAME_APP, SHEET_NAME_REVIEWS } from './config';
import { formatAnnotationsText, generateAnnotatedImageBuffer, uploadToCloudinary, generateReviewLink } from './annotations';

async function hasPendingReviews(sku: string, allImageData: string[][], reviewedImagesData: string[][]) {
  const row = allImageData.find(r => r[0] === sku);
  const url = row?.[1];
  if (!url) return false;

  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  const mainFolderId = match?.[1];
  if (!mainFolderId) return false;

  const subfolder = await drive.files.list({ q: `'${mainFolderId}' in parents and name = '1200px'`, fields: 'files(id)' });
  const subfolderId = subfolder.data.files?.[0]?.id;
  if (!subfolderId) return false;

  const imgs = await drive.files.list({ q: `'${subfolderId}' in parents and mimeType contains 'image/'`, fields: 'files(name)' });
  const total = imgs.data.files?.length || 0;
  if (!total) return false;

  const reviewed = reviewedImagesData.filter(r => r[0] === sku).length;
  return total > reviewed;
}

export async function getAllSkus() {
  const allSkus = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_REVIEWS}!B:C` });
  const allImageData = allSkus.data.values || [];
  const potential = allImageData.map(r => r[0]).filter(Boolean) as string[];

  const appSheet = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_APP}!A:B` });
  const reviewedImagesData = appSheet.data.values || [];

  const checks = await Promise.all(potential.map(sku => hasPendingReviews(sku, allImageData, reviewedImagesData)));
  return potential.filter((_, i) => checks[i]);
}

export async function getImageData(sku: string) {
  const sheetResponse = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_REVIEWS}!B:C` });
  const rows = sheetResponse.data.values;
  const imageDataRow = rows?.find(r => r[0] === sku);
  if (!imageDataRow) return null;

  const mainUrl = imageDataRow[1];
  const match = mainUrl?.match(/folders\/([a-zA-Z0-9_-]+)/);
  const mainFolderId = match?.[1];
  if (!mainFolderId) return null;

  const sub = await drive.files.list({ q: `'${mainFolderId}' in parents and name = '1200px'`, fields: 'files(id)' });
  const subfolderId = sub.data.files?.[0]?.id;
  if (!subfolderId) return null;

  const images = await drive.files.list({
    q: `'${subfolderId}' in parents and mimeType contains 'image/'`,
    fields: 'files(id, name)',
    orderBy: 'name'
  });
  const allImages = (images.data.files || []).map(f => ({ url: `https://drive.google.com/uc?id=${f.id}`, filename: f.name }));

  const appSheet = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_APP}!A:F` });
  const reviewedRows = appSheet.data.values || [];
  const reviewedNames = new Set(reviewedRows.filter(r => r[0] === sku).map(r => r[1]));
  const unreviewed = allImages.filter(i => !reviewedNames.has(i.filename));

  if (!unreviewed.length && allImages.length) return { sku, images: [], allReviewed: true };
  return { sku, images: unreviewed };
}

export async function submitReview(data: { sku: string; review: Array<{ filename: string; url: string; validated?: boolean; annotations?: Array<{x:number;y:number;comment:string}> }> }) {
  const { sku, review } = data;

  // limpiar filas existentes
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetId = spreadsheet.data.sheets?.find(s => s.properties?.title === SHEET_NAME_APP)?.properties?.sheetId;
  const read = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_APP}!A:A` });

  const requests = [];
  read.data.values?.forEach((row, i) => {
    if (row[0] === sku) {
      requests.push({
        deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } }
      });
    }
  });
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: requests.reverse() } });
  }

  const processed = review.filter(it => it.validated || it.annotations?.length);
  if (!processed.length) return true;

  const rows = await Promise.all(processed.map(async (item) => {
    const hasAnn = !!item.annotations?.length;
    const status = item.validated ? 'Validada' : 'Corrección';
    const annotationsText = hasAnn ? formatAnnotationsText(item.annotations) : '';
    const reviewLink = generateReviewLink(sku, item.filename);

    let annotatedThumb = '';
    if (hasAnn) {
      const match = item.url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      const fileId = match?.[1];
      if (fileId) {
        const buf = await generateAnnotatedImageBuffer(fileId, item.annotations!);
        const upload = await uploadToCloudinary(buf, { public_id: `${sku}_${item.filename.replace(/\.[^/.]+$/, '')}_annotated` });
        annotatedThumb = `=IMAGE("${upload.secure_url}")`;
      }
    }

    // A:G → SKU | NOMBRE | ANOTACIONES | MINIATURA ANOTADA | MINIATURA | ESTADO | ENLACE
    return [
      sku,
      item.filename,
      annotationsText,
      annotatedThumb,
      `=IMAGE("${item.url}", 1)`,
      status,
      reviewLink
    ];
  }));

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME_APP}!A:G`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  return true;
}
