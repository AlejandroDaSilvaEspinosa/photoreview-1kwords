import { NextResponse } from 'next/server';
import { sheets } from '@/lib/google';
import { SPREADSHEET_ID, SHEET_NAME_APP } from '@/lib/config';
import { generateAnnotatedImageBuffer } from '@/lib/annotations';
import { cookies } from "next/headers";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { sku: string; filename: string } };

export async function GET(_: Request, { params }: Params) {
  // protege con cookie
  const session = cookies().get("session");
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const sheet = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME_APP}!A:G`,
    });

    const rows = sheet.data.values || [];
    const row = rows.find(r => r[0] === params.sku && r[1] === params.filename);

    if (!row || !row[2]) return new NextResponse('Anotaciones no encontradas', { status: 404 });

    const annotations = JSON.parse(row[2]);
    const imageFormula = row[4]; // =IMAGE("https://drive.google...")

    const match = typeof imageFormula === 'string' ? imageFormula.match(/id=([a-zA-Z0-9_-]+)/) : null;
    const fileId = match?.[1];
    if (!fileId) return new NextResponse('ID de archivo inválido', { status: 400 });

    const buf = await generateAnnotatedImageBuffer(fileId, annotations);
    return new NextResponse(buf, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    return new NextResponse('Error generando preview', { status: 500 });
  }
}
