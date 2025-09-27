// POST /api/skus/reopen  body: { sku }

import { NextResponse, NextRequest } from "next/server";

import { supabaseFromRequest } from "@/lib/supabase/route";

export async function POST(req: NextRequest) {
  const { client: sb, res } = supabaseFromRequest(req);
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sku } = await req.json();
  if (!sku)
    return NextResponse.json({ error: "sku requerido" }, { status: 400 });
  const { error } = await sb.rpc("reopen_sku", { p_sku: sku });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  //return NextResponse.json({ ok: true, data: [] }, { headers: res.headers });
  return NextResponse.json({ ok: true });
}
