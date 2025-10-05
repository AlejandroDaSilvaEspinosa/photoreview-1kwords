import { NextRequest } from "next/server";

export const runtime = "nodejs";

// Límites/umbrales (ajusta a tu gusto)
const CDN_YEARS = 365 * 24 * 60 * 60; // sólo para almacenamiento en CDN, no para freshness
const STALE_WHILE_REVALIDATE = 7 * 24 * 60 * 60; // 7 días
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
  if (!/^https?:$/.test(url.protocol)) {
    return new Response("Protocol not allowed", { status: 400 });
  }

  // Reenvía lo que el cliente acepta (evita forzar AVIF)
  const clientAccept = req.headers.get("accept") ?? "image/webp,image/*;q=0.8";
  // Reenvía validadores condicionales (core de "si cambió o no")
  const ifNoneMatch = req.headers.get("if-none-match");
  const ifModifiedSince = req.headers.get("if-modified-since");

  // IMPORTANTE:
  // cache: "no-store" -> evita la Data Cache de Next. Así cada petición puede revalidar
  // con el upstream (304 si no cambió).
  const upstream = await fetch(url.toString(), {
    headers: {
      Accept: clientAccept,
      ...(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}),
      ...(ifModifiedSince ? { "If-Modified-Since": ifModifiedSince } : {}),
    },
    redirect: "follow",
    cache: "no-store",
  });

  // Si el upstream responde 304, propagamos 304 al cliente.
  // OJO: añadimos los mismos headers de control de caché y Vary/ETag/LM para que el cliente conserve los validadores.
  if (upstream.status === 304) {
    const h304 = new Headers();
    h304.set("Vary", "Accept");
    h304.set(
      // "no-cache" obliga a revalidar SIEMPRE antes de usar el objeto almacenado.
      // s-maxage grande -> permite a la CDN ALMACENAR el objeto/validadores por mucho tiempo,
      // pero siempre revalidará (304 baratito) antes de servirlo.
      "Cache-Control",
      `public, no-cache, s-maxage=${CDN_YEARS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`
    );
    const et = upstream.headers.get("etag");
    if (et) h304.set("ETag", et);
    const lm = upstream.headers.get("last-modified");
    if (lm) h304.set("Last-Modified", lm);

    return new Response(null, { status: 304, headers: h304 });
  }

  if (!upstream.ok) {
    return new Response("Upstream error", { status: 502 });
  }

  const ct = upstream.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) {
    return new Response("Not an image", { status: 415 });
  }

  // Límite de tamaño (si upstream lo declara)
  const len = parseInt(upstream.headers.get("content-length") || "0", 10);
  if (len && len > MAX_BYTES) {
    return new Response("Too large", { status: 413 });
  }

  // Construimos headers de respuesta
  const headers = new Headers();
  headers.set("Content-Type", ct);
  // ¡Muy importante para variantes WebP/JPEG, etc.!
  headers.set("Vary", "Accept");

  // Política: almacenar largo tiempo pero SIEMPRE revalidar (no-cache).
  headers.set(
    "Cache-Control",
    `public, no-cache, s-maxage=${CDN_YEARS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`
  );

  // Propagamos validadores del upstream si existen
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("ETag", etag);
  const lastMod = upstream.headers.get("last-modified");
  if (lastMod) headers.set("Last-Modified", lastMod);

  // (Opcional) si upstream declara Content-Length y te interesa pasarlo:
  if (len) headers.set("Content-Length", String(len));

  // Devolvemos stream directo del upstream
  return new Response(upstream.body, { status: 200, headers });
}
