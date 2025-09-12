// Archivo: src/app/review/[sku]/page.tsx (Next.js 13+ App Router)

// import { useEffect } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import ImageViewer from "@/components/ImageViewer";

export default function ReviewPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  // sku desde la ruta dinámica
  const skuParam = params?.sku;
  const sku =
    typeof skuParam === "string"
      ? skuParam
      : Array.isArray(skuParam)
      ? skuParam[0]
      : "";

  // filename objetivo desde query (?image=filename.jpg)
  const targetImage = searchParams?.get("image") || undefined;


  if (!sku) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p>SKU no válida en la URL</p>
        </div>
      </div>
    );
  }



  return (
    <div className="w-full h-screen">
      <ImageViewer sku={sku} targetImage={targetImage} />
    </div>
  );
}
