import { NextRequest } from "next/server";

export const runtime = "nodejs";

// TTLs
const REVALIDATE = 24 * 60 * 60; // Revalida el fetch interno (1 día)
const BROWSER_MAX_AGE = 24 * 60 * 60; // Caché navegador (1 día)
const CDN_MAX_AGE = 365 * 24 * 60 * 60; // Caché CDN (1 año)
const MAX_BYTES = 15 * 1024 * 1024; // 15MB

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u) return new Response("Missing u", { status: 400 });

  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return new Response("Bad URL", { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol))
    return new Response("Protocol not allowed", { status: 400 });

  // 1) Descarga con cache del lado de Next (Data Cache)
  const upstream = await fetch(url.toString(), {
    headers: { Accept: "image/avif,image/webp,image/*;q=0.8" },
    redirect: "follow",
    // Clave: esto mete el resultado en la Data Cache de Next (por URL) durante REVALIDATE
    next: { revalidate: REVALIDATE },
    cache: "force-cache",
  });

  if (!upstream.ok) return new Response("Upstream error", { status: 502 });

  const ct = upstream.headers.get("content-type") || "";
  if (!ct.startsWith("image/"))
    return new Response("Not an image", { status: 415 });

  const len = parseInt(upstream.headers.get("content-length") || "0", 10);
  if (len && len > MAX_BYTES) return new Response("Too large", { status: 413 });

  // 2) Cache-Control para navegador + CDN: con esto, en la 2ª visita ni siquiera llegas al server si está en CDN
  const headers = new Headers();
  headers.set("Content-Type", ct);
  headers.set(
    "Cache-Control",
    `public, max-age=${BROWSER_MAX_AGE}, s-maxage=${CDN_MAX_AGE}, stale-while-revalidate=${REVALIDATE}`
  );

  return new Response(upstream.body, { status: 200, headers });
}
