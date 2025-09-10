import { NextResponse } from 'next/server';
import { getImageData } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { sku: string } }

export async function GET(_: Request, { params }: Params) {
  const data = await getImageData(params.sku);
  if (!data) return new NextResponse('No se encontraron imágenes.', { status: 404 });
  return NextResponse.json(data);
}
   