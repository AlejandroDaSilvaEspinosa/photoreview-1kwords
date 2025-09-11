import { NextResponse } from "next/server";
import { appendReviewRows, getLatestRevisionForSku } from "@/lib/data";
import type { AnnotationThread } from "@/types/review";

export const runtime = "nodejs";

type IncomingBody = {
  sku: string;
  review: Array<{
    filename: string;
    validated: boolean; // opcional
    url: string;
    annotations: AnnotationThread[]; // threads con messages[]
  }>;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IncomingBody;
    const { sku, review } = body;

    const last = await getLatestRevisionForSku(sku);
    const nextRevision = last + 1;

    const byFilename: Record<string, AnnotationThread[]> = {};
    for (const item of review) {
      byFilename[item.filename] = item.annotations || [];
    }

    await appendReviewRows(sku, nextRevision, byFilename);
    return NextResponse.json({ ok: true, revision: nextRevision });
  } catch (e: any) {
    console.error("POST /api/submit-review error:", e);
    return NextResponse.json({ error: e?.message || "Failed to save review" }, { status: 500 });
  }
}
