import { NextRequest, NextResponse } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";
import type { Database } from "@/types/supabase";

type ReviewMessageInsert =
  Database["public"]["Tables"]["review_messages"]["Insert"];

type InMsg = {
  clientNonce: string;
  threadId: number;
  text: string;
  isSystem?: boolean;
  createdAt?: string;
};

export async function POST(req: NextRequest) {
  const { client: sb, res } = supabaseFromRequest(req);
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const batch: InMsg[] = Array.isArray(body?.messages) ? body.messages : [body];

  if (!batch.length) {
    return NextResponse.json({ error: "Empty payload" }, { status: 400 });
  }

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

  let sysUserId: string | null = null;
  if (batch.some((m) => !!m.isSystem)) {
    const { data: sysUser, error: sysErr } = await sb.rpc("ensure_system_user");
    if (sysErr || !sysUser?.id) {
      return NextResponse.json(
        { error: "No se pudo crear/obtener el usuario system" },
        { status: 500 }
      );
    }
    sysUserId = String(sysUser.id);
  }

  const inserts: ReviewMessageInsert[] = [];
  const clientNonces: string[] = [];

  for (const m of batch) {
    if (
      !m ||
      typeof m.threadId !== "number" ||
      !Number.isFinite(m.threadId) ||
      m.threadId <= 0
    ) {
      return NextResponse.json({ error: "threadId inválido" }, { status: 400 });
    }
    if (typeof m.text !== "string") {
      return NextResponse.json({ error: "text inválido" }, { status: 400 });
    }
    if (!m.clientNonce || typeof m.clientNonce !== "string") {
      return NextResponse.json(
        { error: "clientNonce requerido" },
        { status: 400 }
      );
    }

    const createdBy: string =
      m.isSystem && sysUserId ? sysUserId : String(appUser.id);

    inserts.push({
      thread_id: m.threadId,
      text: m.text,
      created_by: createdBy,
      is_system: !!m.isSystem,
      client_nonce: m.clientNonce,
      ...(m.createdAt ? { created_at: m.createdAt } : null),
    });

    clientNonces.push(m.clientNonce);
  }

  // Idempotencia por client_nonce (requiere UNIQUE (client_nonce))
  const upsertRes = await sb
    .from("review_messages")
    .upsert(inserts, { onConflict: "client_nonce", ignoreDuplicates: false })
    .select(`
      id, thread_id, text, created_at, created_by, is_system,
      created_by_username, created_by_display_name, client_nonce
    `);

  if (upsertRes.error) {
    return NextResponse.json(
      { error: upsertRes.error.message },
      { status: 500 }
    );
  }

  const gotNonces = new Set(
    (upsertRes.data ?? []).map((r: any) => r.client_nonce as string)
  );
  const missing = clientNonces.filter((n) => !gotNonces.has(n));

  let recovered: any[] = [];
  if (missing.length) {
    const rec = await sb
      .from("review_messages")
      .select(
        `
        id, thread_id, text, created_at, created_by, is_system,
        created_by_username, created_by_display_name, client_nonce
      `
      )
      .in("client_nonce", missing);
    if (rec.error) {
      return NextResponse.json({ error: rec.error.message }, { status: 500 });
    }
    recovered = rec.data ?? [];
  }

  const rows = [...(upsertRes.data ?? []), ...recovered];
  const byNonce = new Map<string, any>();
  for (const r of rows) byNonce.set(r.client_nonce, r);

  const results = clientNonces.map((nonce) => {
    const row = byNonce.get(nonce);
    return row
      ? { clientNonce: nonce, row }
      : { clientNonce: nonce, error: "No confirmado" };
  });

  return NextResponse.json({ results }, { headers: res.headers });
}
