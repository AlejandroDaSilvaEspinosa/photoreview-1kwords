import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

// ⚠️ NO importes código que use `jsonwebtoken` aquí (no funciona en Edge).
// Si tienes constantes (nombre de cookie, etc.), duplica o muévelas a un archivo sin dependencias Node.
const SESSION_COOKIE_NAME = "session"; // idéntico al que usas al hacer login
const PUBLIC_API = ["/api/login", "/api/logout"]; // rutas sin auth (ajusta según tu app)

// Util para obtener la clave como Uint8Array (jose la requiere así)
function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // En producción, mejor lanzar error en build/start si falta
    throw new Error("JWT_SECRET no está definido");
  }
  return new TextEncoder().encode(secret);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Deja pasar preflight CORS y endpoints públicos
  if (req.method === "OPTIONS") return NextResponse.next();
  if (PUBLIC_API.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Solo aplicamos a /api/**
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    // (Opcional) Pasar info del usuario a la ruta protegida mediante cabeceras
    const requestHeaders = new Headers(req.headers);
    // Envía solo lo que necesites; evita pasar datos sensibles
    if (typeof payload.name === "string") {
      requestHeaders.set("x-user-name", payload.name);
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    // Token ausente/expirado/incorrecto
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

// Protege solo /api/** (no toca páginas a menos que lo añadas)
export const config = {
  matcher: ["/api/:path*"],
};
