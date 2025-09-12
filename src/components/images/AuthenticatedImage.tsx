"use client";

import React, { forwardRef, useEffect, useRef, useState } from "react";

// Cache global (id -> objectURL)
const blobCache = new Map<string, string>();

type Props = {
  src: string;
  alt: string;
  className?: string;
  lazy?: boolean;
  onLoadRealImage?: () => void;
  placeholderWidth?: number | string;
  placeholderHeight?: number | string;
};

const extractFileId = (url: string): string | null => {
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
};

const AuthenticatedImage = forwardRef<HTMLImageElement, Props>(
  (
    {
      src,
      alt,
      className,
      lazy = false,
      onLoadRealImage,
      placeholderWidth,
      placeholderHeight,
    },
    ref
  ) => {
    const [objectUrl, setObjectUrl] = useState<string>("");
    const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">(
      lazy ? "idle" : "loading"
    );
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [inView, setInView] = useState(!lazy);

    useEffect(() => {
      if (!lazy) return;
      const el = hostRef.current;
      if (!el) return;
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setInView(true);
        },
        { rootMargin: "300px" }
      );
      io.observe(el);
      return () => io.disconnect();
    }, [lazy]);

    useEffect(() => {
      let controller: AbortController | null = null;

      const run = async () => {
        const fileId = extractFileId(src);
        if (!fileId ) {
          setStatus("error");
          return;
        }
        if (blobCache.has(fileId)) {
          setObjectUrl(blobCache.get(fileId)!);
          setStatus("loaded");
          return;
        }

        setStatus("loading");
        controller = new AbortController();
        try {
          const res = await fetch(`/api/image-proxy/${fileId}`, {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`Proxy request failed: ${res.status}`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          blobCache.set(fileId, url);
          setObjectUrl(url);
          setStatus("loaded");
        } catch (e: any) {
          if (e?.name !== "AbortError") {
            console.error("AuthenticatedImage fetch error:", e);
            setStatus("error");
          }
        }
      };

      if (inView) run();
      return () => { if (controller) controller.abort(); };
    }, [src,  inView]);

    const boxStyle: React.CSSProperties = {
      width: placeholderWidth,
      height: placeholderHeight,
      display: "block",
      position: "relative",
      overflow: "hidden",
    };

    return (
      <div ref={hostRef} className={className} style={boxStyle}>
        {status === "loaded" && objectUrl ? (
          <img
            ref={ref}
            src={objectUrl}
            alt={alt}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onLoad={onLoadRealImage}
          />
        ) : status === "error" ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
            }}
          >
            <div>
              Error al cargar
              <br />
              <small>Verifique la conexión</small>
            </div>
          </div>
        ) : (
          <div
            aria-busy="true"
            style={{
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              opacity: 0.8,
            }}
          >
            Cargando…
          </div>
        )}
      </div>
    );
  }
);

AuthenticatedImage.displayName = "AuthenticatedImage";
export default AuthenticatedImage;
