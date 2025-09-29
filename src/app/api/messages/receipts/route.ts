// app/api/messages/receipts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";

/**
 * Acepta:
 *  - { messageIds: number[], mark: "delivered" | "read" } (retrocompat)
 *  - { deliveredIds?: number[], readIds?: number[] } (nuevo, recomendado)
 *
 * Semántica:
 *  - delivered: upsert (message_id,user_id) con read_at = null (si no existe).
 *  - read: upsert con read_at = now() (si existe, actualiza a leído; si no, crea leído).
 *  - "read" tapa "delivered".
 */

export async function POST(req: NextRequest) {
  const { client: sb, res } = supabaseFromRequest(req);

  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  let deliveredIds: number[] = [];
  let readIds: number[] = [];

  // Retrocompat: shape antiguo
  if (Array.isArray(body?.messageIds) && typeof body?.mark === "string") {
    if (body.mark === "read") readIds = body.messageIds;
    else if (body.mark === "delivered") deliveredIds = body.messageIds;
  }

  // Shape nuevo mixto
  if (Array.isArray(body?.deliveredIds)) deliveredIds = body.deliveredIds;
  if (Array.isArray(body?.readIds)) readIds = body.readIds;

  // Normaliza
  const uniq = (arr: number[]) =>
    Array.from(new Set(arr.filter((x) => Number.isFinite(x))));
  readIds = uniq(readIds);
  deliveredIds = uniq(deliveredIds).filter((id) => !readIds.includes(id)); // read tapa delivered

  if (!deliveredIds.length && !readIds.length) {
    return NextResponse.json(
      { ok: true, delivered: 0, read: 0 },
      { headers: res.headers }
    );
  }

  // Mapear usuario app
  const username =
    (user.user_metadata?.display_name as string | undefined) ??
    user.email ??
    "";
  const { data: appUser, error: mapErr } = await sb
    .from("app_users")
    .select("id, username, display_name")
    .eq("username", username)
    .single();

  if (mapErr || !appUser) {
    return NextResponse.json(
      { error: "Fallo al autenticar al usuario de aplicación" },
      { status: 500 }
    );
  }

  // delivered: crea filas sin read_at
  let deliveredCount = 0;
  if (deliveredIds.length) {
    const ins = deliveredIds.map((id) => ({
      message_id: id,
      user_id: String(appUser.id),
      read_at: null as string | null,
    }));
    const { error } = await sb
      .from("review_message_receipts")
      .upsert(ins, {
        onConflict: "message_id,user_id",
        ignoreDuplicates: false,
      });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    deliveredCount = deliveredIds.length;
  }

  // read: upsert con read_at = now()
  let readCount = 0;
  if (readIds.length) {
    const nowIso = new Date().toISOString();
    const ins = readIds.map((id) => ({
      message_id: id,
      user_id: String(appUser.id),
      read_at: nowIso,
    }));
    const { error } = await sb
      .from("review_message_receipts")
      .upsert(ins, {
        onConflict: "message_id,user_id",
        ignoreDuplicates: false,
      });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    readCount = readIds.length;
  }

  return NextResponse.json(
    { ok: true, delivered: deliveredCount, read: readCount },
    { headers: res.headers }
  );
}
