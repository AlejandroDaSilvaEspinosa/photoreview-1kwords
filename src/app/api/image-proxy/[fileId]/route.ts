import { NextResponse } from 'next/server';
import { drive } from '@/lib/google';
import { Readable } from 'stream';
import { cookies } from "next/headers";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { fileId: string } }

export async function GET(_: Request, { params }: Params) {
    // protege con cookie
  const session = cookies().get("session");
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const meta = await drive.files.get({ fileId: params.fileId, fields: 'mimeType' });
    const streamResp = await drive.files.get({ fileId: params.fileId, alt: 'media' }, { responseType: 'stream' as any });
    const nodeStream = streamResp.data as unknown as Readable;
    const webStream = (Readable as any).toWeb ? (Readable as any).toWeb(nodeStream) : nodeStream as any;

    return new Response(webStream as any, {
      headers: {
        'Content-Type': meta.data.mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('Error al obtener la imagen.', { status: 500 });
  }
}
