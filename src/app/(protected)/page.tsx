// app/(protected)/page.tsx
import { getCachedSkus } from "@/lib/data";
import Home from "./home";

export default async function HomePage() {
  const clientInfo = {
    name: "Castejon Joyeros",
    project: "Catalogo comercial joyeria",
  };
  const skus = await getCachedSkus(); // ✅ directamente desde servidor
  //only get sku property from skus array
  console.log("SKUS EN HOME PAGE:", skus);
  const skusList = skus.map(s => s.sku); 
  console.log("SKUS LIST EN HOME PAGE:", skusList);
  //pasar skusList a string separado por comas
  return <Home skus={skus} clientInfo={clientInfo} />;
}
 