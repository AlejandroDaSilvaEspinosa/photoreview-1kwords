import sharp from 'sharp';
import { drive } from './google';
import { cloudinary } from './cloudinary';
import { FRONTEND_URL } from './config';

export function generateReviewLink(sku: string, filename: string) {
  return `=HYPERLINK("${FRONTEND_URL}/review/${sku}?image=${encodeURIComponent(filename)}","Ver revisión")`;
}

export function formatAnnotationsText(annotations?: Array<{comment: string}>) {
  if (!annotations?.length) return '';
  return annotations.map((a, i) => `${i+1}. ${a.comment.trim()}`).join('\n');
}

export async function generateAnnotatedImageBuffer(
  fileId: string,
  annotations: Array<{x:number;y:number;comment:string}> = []
) {
  // descarga binaria desde Drive
  const imageResponse = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' as any });
  const imageBuffer = Buffer.from(imageResponse.data as ArrayBuffer);

  if (!annotations.length) {
    return sharp(imageBuffer).resize(400).jpeg({ quality: 90 }).toBuffer();
  }

  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 1000;
  const height = meta.height || 1000;

  const markerSize = Math.max(60, Math.round(width * 0.06));
  const fontSize   = Math.round(markerSize * 0.5);
  const radius     = markerSize / 2;
  const strokeWidth= Math.max(4, Math.round(markerSize * 0.08));

  const layers = annotations.map((ann, i) => {
    const svg = `<svg width="${markerSize}" height="${markerSize}" viewBox="0 0 ${markerSize} ${markerSize}" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="3" dy="3" stdDeviation="2" flood-color="black" flood-opacity="0.8"/>
      </filter></defs>
      <circle cx="${radius}" cy="${radius}" r="${radius - strokeWidth/2}"
        fill="#FF0040" stroke="white" stroke-width="${strokeWidth}" filter="url(#shadow)"/>
      <text x="${radius}" y="${radius}" dy="${fontSize * 0.35}" font-size="${fontSize}"
        fill="white" text-anchor="middle" font-weight="bold" font-family="Arial, Helvetica, sans-serif">${i+1}</text>
    </svg>`;
    const x = Math.round((ann.x / 100) * width) - radius;
    const y = Math.round((ann.y / 100) * height) - radius;
    return { input: Buffer.from(svg), left: Math.max(0, Math.min(x, width - markerSize)), top: Math.max(0, Math.min(y, height - markerSize)), blend: 'over' as const };
  });

  return sharp(imageBuffer)
    .composite(layers)
    .resize(400, null, { withoutEnlargement: true, fit: 'inside' })
    .jpeg({ quality: 95 })
    .toBuffer();
}

export function uploadToCloudinary(imageBuffer: Buffer, options: Record<string, any> = {}) {
  return new Promise<any>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: 'photoreview_thumbnails', quality: 'auto:good', fetch_format: 'auto', ...options },
      (err, result) => err ? reject(err) : resolve(result)
    );
    uploadStream.end(imageBuffer);
  });
}
