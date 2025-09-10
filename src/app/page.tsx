// Fichero: src/app/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import ImageViewer from "../components/ImageViewer";
import Header from "../components/Header";
import styles from "./page.module.css";

export default function HomePage() {
  const [skus, setSkus] = useState<string[]>([]);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const { token, isAuthenticated } = useAuth();
  const router = useRouter();

  const clientInfo = {
    name: "Castejon Joyeros",
    project: "Catalogo comercial joyeria",
  };

  useEffect(() => {
    // Espera a que el estado de auth esté resuelto
    if (token === undefined) return;

    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }

    setLoading(true);
    setError("");

    const controller = new AbortController();

    // Consumimos la API propia de Next.js (misma origin)
    fetch("/api/skus", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          throw new Error("No autorizado");
        }
        if (!res.ok) {
          throw new Error(`Respuesta del servidor no fue OK: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        // Soporta tanto array puro como { skus: string[] }
        const list = Array.isArray(data)
          ? data
          : Array.isArray((data as any)?.skus)
          ? (data as any).skus
          : null;

        if (!list) throw new Error("Formato de respuesta no válido");
        setSkus(list);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(
          err?.message || "No se pudieron cargar las SKUs. Inténtalo de nuevo."
        );
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [isAuthenticated, router, token]);

  const handleSkuChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSku(event.target.value);
  };

  if (loading) {
    return <div className={styles.fullPageLoader}>Cargando aplicación...</div>;
  }

  if (error) {
    return <div className={styles.fullPageLoader}>{error}</div>;
  }

  return (
    <main className={styles.main}>
      <Header
        skus={skus}
        loading={loading}
        clientName={clientInfo.name}
        clientProject={clientInfo.project}
        onSkuChange={handleSkuChange}
      />
      <div className={styles.content}>
        {selectedSku ? (
          <ImageViewer key={selectedSku} sku={selectedSku} />
        ) : (
          <div className={styles.placeholder}>
            <p>Por favor, selecciona una SKU para ver sus imágenes.</p>
          </div>
        )}
      </div>
    </main>
  );
}
