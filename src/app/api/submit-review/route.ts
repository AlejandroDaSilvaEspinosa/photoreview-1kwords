import { NextResponse } from 'next/server';
import { submitReview } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json();
  const ok = await submitReview(body);
  if (ok) return NextResponse.json({ message: 'Revisión guardada exitosamente.' });
  return new NextResponse('Error al guardar la revisión.', { status: 500 });
}
