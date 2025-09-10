import { NextResponse } from 'next/server';
import { getAllSkus } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const skus = await getAllSkus();
  return NextResponse.json(skus);
}
