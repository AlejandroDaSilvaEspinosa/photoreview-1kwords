import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { cookies } from "next/headers";
import { verifyToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json();
  const { threadId, text } = body;

  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const user = token ? verifyToken(token) : null;
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("review_messages")
    .insert({
      thread_id: threadId,
      text,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
