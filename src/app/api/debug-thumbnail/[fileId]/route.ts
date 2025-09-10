import { NextResponse } from 'next/server';
import { generateAnnotatedImageBuffer } from '@/lib/annotations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { fileId: string } }

export async function GET(_: Request, { params }: Params) {
  try {
    const annotations = [
      { x: 25, y: 25, comment: 'Prueba 1' },
      { x: 75, y: 50, comment: 'Prueba 2' },
      { x: 50, y: 80, comment: 'Prueba 3' },
    ];
    const buf = await generateAnnotatedImageBuffer(params.fileId, annotations);
    return new NextResponse(buf, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' },
    });
  } catch (e: any) {
    return new NextResponse(`Error: ${e.message}`, { status: 500 });
  }
}
