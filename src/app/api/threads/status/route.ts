// app/api/threads/status/route.ts
import { NextResponse, NextRequest } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";

type NextStatus = "pending" | "corrected" | "reopened" | "deleted";

export async function POST(req: NextRequest) {
  const { client: sb, res } = supabaseFromRequest(req);

  // Auth
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Input
  const body = await req.json().catch(() => ({}));
  const { threadId, status } = body as {
    threadId?: number;
    status?: NextStatus;
  };

  if (
    !threadId ||
    !status ||
    !["pending", "corrected", "reopened", "deleted"].includes(status)
  ) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Update estado del hilo
  const { data, error } = await sb
    .from("review_threads")
    .update({ status })
    .eq("id", threadId)
    .select("id, status, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // ✅ Sin crear mensaje de sistema aquí (lo gestiona el cliente vía outbox)
  return NextResponse.json(
    {
      ok: true,
      threadId: data.id,
      status: data.status as NextStatus,
      updatedAt: data.updated_at as string | null,
    },
    { headers: res.headers }
  );
}
