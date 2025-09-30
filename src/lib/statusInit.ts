import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SkuWithImages } from "@/types/review";

type ImgRow = {
  sku: string;
  image_name: string;
  status: "finished" | "needs_correction";
  updated_at: string;
};
type SkuRow = { sku: string; images_total: number | null };

export async function ensureStatusesInitialized(
  skus: SkuWithImages[]
): Promise<void> {
  if (!skus.length) return;

  const sb = supabaseAdmin();
  const skuList = skus.map((s) => s.sku);
  const nowIso = new Date().toISOString();

  // 1) Lectura única de estado existente
  const [{ data: skuRows, error: eSku }, { data: imgRows, error: eImg }] =
    await Promise.all([
      sb
        .from("review_skus_status")
        .select("sku,images_total")
        .in("sku", skuList),
      sb
        .from("review_images_status")
        .select("sku,image_name")
        .in("sku", skuList),
    ]);
  if (eSku) throw eSku;
  if (eImg) throw eImg;

  const existingSku = new Map<string, number | null>(
    (skuRows as SkuRow[] | null)?.map((r) => [r.sku, r.images_total]) ?? []
  );
  const existingImgsBySku = new Map<string, Set<string>>();
  (imgRows ?? []).forEach((r: any) => {
    const set = existingImgsBySku.get(r.sku) || new Set<string>();
    set.add(r.image_name);
    existingImgsBySku.set(r.sku, set);
  });

  // 2) Detectar faltantes (SoT − DB) y extras (DB − SoT)
  const imagesToUpsert: ImgRow[] = [];
  const extrasBySku = new Map<string, Set<string>>();
  const skusNeedingCompute = new Set<string>();

  for (const s of skus) {
    const names = (s.images || []).map((i) => i.name).filter(Boolean);
    if (!names.length) continue;

    const setSoT = new Set(names);
    const setDB = existingImgsBySku.get(s.sku) || new Set<string>();

    // Missing
    let missingCount = 0;
    for (const name of names) {
      if (!setDB.has(name)) {
        imagesToUpsert.push({
          sku: s.sku,
          image_name: name,
          status: "finished",
          updated_at: nowIso,
        });
        missingCount++;
      }
    }

    // Extras
    const extras = new Set<string>();
    for (const name of setDB) if (!setSoT.has(name)) extras.add(name);
    if (extras.size) extrasBySku.set(s.sku, extras);

    // Marcar para recomputar si:
    // - No hay fila de SKU
    // - Hemos añadido imágenes
    // - El total guardado no coincide con la fuente
    const totalStored = existingSku.get(s.sku);
    if (
      !existingSku.has(s.sku) ||
      missingCount > 0 ||
      (typeof totalStored === "number" && totalStored !== names.length)
    ) {
      skusNeedingCompute.add(s.sku);
    }
  }

  // 3) Upsert de imágenes faltantes (en lotes)
  if (imagesToUpsert.length) {
    const chunk = <T>(xs: T[], n = 500) => {
      const out: T[][] = [];
      for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
      return out;
    };
    for (const part of chunk(imagesToUpsert, 500)) {
      const { error } = await sb
        .from("review_images_status")
        .upsert(part, { onConflict: "sku,image_name" });
      if (error) throw error;
    }
  }

  // 4) Borrar extras sin threads (protege histórico); opcionalmente podrías
  //    añadir .eq("status","finished") si quisieras ser aún más cauto.
  if (extrasBySku.size) {
    const allExtraNames = Array.from(
      new Set(Array.from(extrasBySku.values()).flatMap((s) => Array.from(s)))
    );

    const { data: rowsWithThreads, error: eThr } = await sb
      .from("review_threads")
      .select("sku,image_name")
      .in("sku", Array.from(extrasBySku.keys()))
      .in("image_name", allExtraNames);

    if (eThr) throw eThr;

    const hasThread = new Set<string>(
      (rowsWithThreads || []).map((r) => `${r.sku}|${r.image_name}`)
    );

    for (const [sku, names] of extrasBySku) {
      const deletables = Array.from(names).filter(
        (name) => !hasThread.has(`${sku}|${name}`)
      );
      if (!deletables.length) continue;

      const { error } = await sb
        .from("review_images_status")
        .delete()
        .eq("sku", sku)
        .in("image_name", deletables);
      if (error) throw error;

      skusNeedingCompute.add(sku);
    }
  }

  // 5) Recompute SKU sólo donde hubo cambios (o faltaba)
  for (const sku of skusNeedingCompute) {
    const { error } = await sb.rpc("compute_sku_status", { p_sku: sku });
    if (
      error &&
      !String(error.message || "").includes("function compute_sku_status")
    ) {
      // Fallback si el RPC no está expuesto: set mínimo coherente
      const total = (skus.find((x) => x.sku === sku)?.images || []).length;
      const { error: e2 } = await sb.from("review_skus_status").upsert(
        {
          sku,
          status: "pending_validation",
          images_total: total,
          images_needing_fix: 0,
          updated_at: nowIso,
        },
        { onConflict: "sku" }
      );
      if (e2) throw e2;
    }
  }
}
