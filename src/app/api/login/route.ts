import { NextResponse } from 'next/server';
import { signToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { username, password } = await req.json();
  if (username === process.env.LOGIN_USER && password === process.env.LOGIN_PASS) {
    const token = signToken({ name: username });
    return NextResponse.json({ accessToken: token });
  }
  return new NextResponse('Usuario o contraseña incorrectos', { status: 401 });
}
