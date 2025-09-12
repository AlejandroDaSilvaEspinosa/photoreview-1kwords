// app/(protected)/page.tsx
import { getCachedSkus } from "@/lib/data";
import Home from "./home";
import { SkuWithImages } from '@/types/review';

export default async function HomePage() {
  const clientInfo = {
    name: "Castejon Joyeros",
    project: "Catalogo comercial joyeria",
  };
  const skus : SkuWithImages[] = await getCachedSkus(); // ✅ directamente desde servidor
  return <Home skus={skus} clientInfo={clientInfo} />;
}
 