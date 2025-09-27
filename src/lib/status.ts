// src/lib/status.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  SkuWithImages,
  SkuWithImagesAndStatus,
  ImageItemWithStatus,
  ImageStatus,
  SkuStatus,
} from "@/types/review";

export async function hydrateStatuses(
  skus: SkuWithImages[],
): Promise<SkuWithImagesAndStatus[]> {
  if (!skus.length) return [];
  const sb = supabaseAdmin();
  const skuList = skus.map((s) => s.sku);

  const { data: imgRows } = await sb
    .from("review_images_status")
    .select("sku,image_name,status")
    .in("sku", skuList);

  const { data: skuRows } = await sb
    .from("review_skus_status")
    .select("sku,status,images_total,images_needing_fix")
    .in("sku", skuList);

  const imgMap = new Map<string, ImageStatus>();
  (imgRows ?? []).forEach((r) =>
    imgMap.set(`${r.sku}|${r.image_name}`, r.status as ImageStatus),
  );

  const skuMap = new Map<string, SkuStatus>();
  (skuRows ?? []).forEach((r) => skuMap.set(r.sku, r.status as SkuStatus));

  return skus.map((s) => {
    const images: ImageItemWithStatus[] = s.images.map((img) => ({
      ...img,
      status: imgMap.get(`${s.sku}|${img.name}`) ?? "finished", // sin hilos ⇒ finished
    }));

    const counts = images.reduce(
      (acc, i) => {
        acc[i.status]++;
        acc.total++;
        return acc;
      },
      { finished: 0, needs_correction: 0, total: 0 },
    );

    const status: SkuStatus =
      skuMap.get(s.sku) ??
      (counts.needs_correction > 0 ? "needs_correction" : "pending_validation");

    return { ...s, images, status, counts };
  });
}
