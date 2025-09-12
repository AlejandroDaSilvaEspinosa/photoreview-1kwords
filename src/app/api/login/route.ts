// src/app/api/login/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { signToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { username, password } = await req.json();

  if (
    username === process.env.LOGIN_USER &&
    password === process.env.LOGIN_PASS
  ) {
    const token = signToken({ name: username });

    cookies().set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return NextResponse.json({ ok: true });
  }

  return new NextResponse("Usuario o contraseña incorrectos", { status: 401 });
}
