import { NextResponse } from 'next/server';
import { signToken } from '@/lib/auth';
import { cookies } from "next/headers";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { username, password } = await req.json();
  if (username === process.env.LOGIN_USER && password === process.env.LOGIN_PASS) {
    // const token = signToken({ name: username });
    // return NextResponse.json({ accessToken: token });
    cookies().set("session", "SESSION_TOKEN_PLACEHOLDER", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8, // 8h
    });
    return NextResponse.json({ ok: true });
  }
  return new NextResponse('Usuario o contraseña incorrectos', { status: 401 });
}
