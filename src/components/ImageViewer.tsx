"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./ImageViewer.module.css";
import { useAuth } from "@/contexts/AuthContext";
import Lightbox, { type Slide } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import AuthenticatedImage from "./images/AuthenticatedImage";
import ThumbnailGrid from "./images/ThumbnailGrid";
import SidePanel from "./images/SidePanel";
import type {
  AnnotationThread,
  AnnotationState,
  ValidationState,
  ImageItem,
} from "@/types/review";

/** Reviews payload: { [filename]: { points?: AnnotationThread[] } } */
type ReviewsPayload = Record<string, { points?: AnnotationThread[] }>;

interface ImageViewerProps {
  sku: string;
  targetImage?: string;
}

export default function ImageViewer({ sku, targetImage }: ImageViewerProps) {
  const { token } = useAuth();

  // Estado principal
  const [images, setImages] = useState<ImageItem[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationState>({});
  const [validatedImages, setValidatedImages] = useState<ValidationState>({});
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [completionMessage, setCompletionMessage] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Geometría
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgBox, setImgBox] = useState({
    offsetLeft: 0,
    offsetTop: 0,
    width: 0,
    height: 0,
  });

  const updateImageGeometry = useCallback(() => {
    const wrapper = wrapperRef.current;
    const img = imgRef.current;
    if (!wrapper || !img) return;
    const wRect = wrapper.getBoundingClientRect();
    const iRect = img.getBoundingClientRect();
    setImgBox({
      offsetLeft: iRect.left - wRect.left,
      offsetTop: iRect.top - wRect.top,
      width: iRect.width,
      height: iRect.height,
    });
  }, []);

  // Recalcular geometría en resize (debounced por el propio browser)
  useEffect(() => {
    const onResize = () => updateImageGeometry();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateImageGeometry]);

  // ResizeObserver para cambios de tamaño del contenedor/imagen
  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(() => updateImageGeometry());
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [updateImageGeometry]);

  // 1) Cargar imágenes
  useEffect(() => {
    let alive = true;
    if (!sku || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setCompletionMessage("");
    setImages([]);
    setAnnotations({});
    setValidatedImages({});
    setSelectedImageIndex(0);
    setActiveThreadId(null);

    fetch(`/api/images/${sku}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401)
          throw new Error("No autorizado. Inicie sesión de nuevo.");
        if (!res.ok) throw new Error("Fallo al obtener las imágenes de la SKU.");
        return res.json();
      })
      .then((fetched: ImageItem[]) => {
        if (!alive) return;
        if (!Array.isArray(fetched) || fetched.length === 0) {
          setError(`No se encontraron imágenes pendientes para la SKU ${sku}.`);
          return;
        }

        // Inicializar anotaciones y validaciones vacías
        const initAnns: AnnotationState = {};
        const initVal: ValidationState = {};
        for (const img of fetched) {
          initAnns[img.filename] = [];
          initVal[img.filename] = false;
        }

        setImages(fetched);
        setAnnotations(initAnns);
        setValidatedImages(initVal);

        // Selección inicial
        const initialIndex = targetImage
          ? Math.max(0, fetched.findIndex((i) => i.filename === targetImage))
          : 0;
        setSelectedImageIndex(initialIndex === -1 ? 0 : initialIndex);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Error al cargar imágenes");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [sku, token, targetImage]);

  // 2) Cargar anotaciones existentes (última revisión)
  useEffect(() => {
    let alive = true;
    if (!sku || images.length === 0) return;

    (async () => {
      try {
        const res = await fetch(`/api/reviews/${sku}`);
        if (!res.ok) return; // no reviews previas
        const payload: ReviewsPayload = await res.json();

        // Mezcla segura: solo filenames que existen en las imágenes actuales
        const merged: AnnotationState = {};
        for (const img of images) {
          const entry = payload[img.filename];
          merged[img.filename] = entry?.points ?? [];
        }

        if (alive) {
          setAnnotations((prev) => ({ ...prev, ...merged }));
          // Tras pintar la imagen con anotaciones, recalcula geometría
          requestAnimationFrame(updateImageGeometry);
        }
      } catch {
        /* ignorar reviews corruptos */
      }
    })();

    return () => {
      alive = false;
    };
  }, [sku, images, updateImageGeometry]);

  // Handlers de anotaciones
  const handleImageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const current = images[selectedImageIndex];
    if (!current) return;
    if ((event.target as HTMLElement).closest(`.${styles.annotationNode}`)) return;

    const imgEl = imgRef.current;
    if (!imgEl) return;
    const r = imgEl.getBoundingClientRect();
    const x = event.clientX - r.left;
    const y = event.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return;

    const xPercent = (x / r.width) * 100;
    const yPercent = (y / r.height) * 100;

    const threadId = Date.now();
    const newThread: AnnotationThread = {
      id: threadId,
      x: xPercent,
      y: yPercent,
      messages: [
        { id: threadId + 1, text: "", createdAt: new Date().toISOString() },
      ],
    };

    setAnnotations((prev) => ({
      ...prev,
      [current.filename]: [...(prev[current.filename] || []), newThread],
    }));
    setActiveThreadId(threadId);
  };

  const onChangeMessage = (threadId: number, messageId: number, text: string) => {
    const img = images[selectedImageIndex];
    if (!img) return;
    setAnnotations((prev) => ({
      ...prev,
      [img.filename]: (prev[img.filename] || []).map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === messageId ? { ...m, text } : m
              ),
            }
          : t
      ),
    }));
  };

  const onAddMessage = (threadId: number) => {
    const img = images[selectedImageIndex];
    if (!img) return;
    const newId = Date.now();
    setAnnotations((prev) => ({
      ...prev,
      [img.filename]: (prev[img.filename] || []).map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: [
                ...t.messages,
                { id: newId, text: "", createdAt: new Date().toISOString() },
              ],
            }
          : t
      ),
    }));
    setActiveThreadId(threadId);
  };

  const deleteThread = (threadId: number) => {
    const img = images[selectedImageIndex];
    if (!img) return;
    setAnnotations((prev) => ({
      ...prev,
      [img.filename]: (prev[img.filename] || []).filter((t) => t.id !== threadId),
    }));
    if (activeThreadId === threadId) setActiveThreadId(null);
  };

  // Validación
  const handleValidateImage = () => {
    const img = images[selectedImageIndex];
    if (!img) return;
    setValidatedImages((prev) => ({ ...prev, [img.filename]: true }));
    if (selectedImageIndex < images.length - 1) {
      setSelectedImageIndex((i) => i + 1);
    }
  };

  const handleUnvalidateImage = () => {
    const img = images[selectedImageIndex];
    if (!img) return;
    setValidatedImages((prev) => ({ ...prev, [img.filename]: false }));
  };

  // Submit
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!images.length || !token) return;
    setSaving(true);
    try {
      const reviewData = images.map((img) => ({
        filename: img.filename,
        validated: validatedImages[img.filename] || false,
        url: img.url,
        annotations: annotations[img.filename] || [],
      }));

      const res = await fetch("/api/submit-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sku, review: reviewData }),
      });

      if (res.status === 401)
        throw new Error("No autorizado. Inicie sesión de nuevo.");
      if (!res.ok) throw new Error("Error en la respuesta del servidor");

      const payload = await res.json();
      alert(`¡Revisión #${payload?.revision} guardada con éxito!`);
      setCompletionMessage("¡Revisión completada! Puedes buscar otra SKU.");
      setImages([]);
      setAnnotations({});
      setValidatedImages({});
    } catch (err: unknown) {
      alert(
        err instanceof Error ? err.message : "Error al guardar la revisión."
      );
    } finally {
      setSaving(false);
    }
  };

  // Selección de imagen
  const selectImage = (index: number) => {
    if (!images.length) return;
    if (index < 0 || index >= images.length) return;
    setSelectedImageIndex(index);
    setActiveThreadId(null);
    requestAnimationFrame(updateImageGeometry);
  };

  // Derivados
  const currentImage = images[selectedImageIndex];

  const threads: AnnotationThread[] = useMemo(
    () => (currentImage ? annotations[currentImage.filename] || [] : []),
    [annotations, currentImage]
  );

  const hasAnyText = useCallback(
    (t: AnnotationThread[]) =>
      t.some((th) => th.messages?.some((m) => m.text.trim() !== "")),
    []
  );

  const withCorrectionsCount = useMemo(
    () =>
      images.reduce(
        (acc, img) =>
          acc + (hasAnyText(annotations[img.filename] || []) ? 1 : 0),
        0
      ),
    [images, annotations, hasAnyText]
  );

  const validatedImagesCount = useMemo(
    () => images.reduce((acc, img) => acc + (validatedImages[img.filename] ? 1 : 0), 0),
    [images, validatedImages]
  );

  const totalCompleted = useMemo(
    () =>
      images.reduce(
        (acc, img) =>
          acc +
          (validatedImages[img.filename] ||
          hasAnyText(annotations[img.filename] || [])
            ? 1
            : 0),
        0
      ),
    [images, validatedImages, annotations, hasAnyText]
  );

  const isSubmitDisabled = images.length === 0 || totalCompleted !== images.length;

  const lightboxSlides: Slide[] = useMemo(
    () => images.map((image) => ({ src: image.url })),
    [images]
  );

  // Render
  if (loading) return <div className={styles.message}>Cargando SKU...</div>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (completionMessage) return <div className={styles.message}>{completionMessage}</div>;
  if (!images.length || !currentImage) return null;

  const isCurrentImageValidated = !!validatedImages[currentImage.filename];

  return (
    <>
      <div className={styles.viewerContainer}>
        <div className={styles.mainViewer}>
          <div className={styles.imageHeader}>
            <h1>Revisión de SKU: {sku}</h1>
            <div className={styles.imageCounter}>
              {selectedImageIndex + 1} de {images.length}
            </div>
          </div>

          <div className={styles.mainImageContainer}>
            <button
              className={`${styles.navButton} ${styles.navLeft}`}
              onClick={() => selectImage(selectedImageIndex - 1)}
              disabled={selectedImageIndex === 0}
              aria-label="Imagen anterior"
            >
              ‹
            </button>

            <div
              className={styles.mainImageWrapper}
              ref={wrapperRef}
              onClick={handleImageClick}
              onDoubleClick={() => setLightboxOpen(true)}
            >
              <AuthenticatedImage
                ref={imgRef}
                src={currentImage.url}
                alt={currentImage.filename}
                className={styles.mainImage}
                token={token}
                lazy={false}
                onLoadRealImage={updateImageGeometry}
              />

              {threads.map((th, index) => {
                const topPx = imgBox.offsetTop + (th.y / 100) * imgBox.height;
                const leftPx = imgBox.offsetLeft + (th.x / 100) * imgBox.width;
                return (
                  <div
                    key={th.id}
                    className={`${styles.annotationNode} ${
                      activeThreadId === th.id ? "activeNode" : ""
                    }`}
                    style={{ top: `${topPx}px`, left: `${leftPx}px` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveThreadId(th.id);
                    }}
                  >
                    {index + 1}
                  </div>
                );
              })}
            </div>

            <button
              className={`${styles.navButton} ${styles.navRight}`}
              onClick={() => selectImage(selectedImageIndex + 1)}
              disabled={selectedImageIndex === images.length - 1}
              aria-label="Imagen siguiente"
            >
              ›
            </button>
          </div>

          <ThumbnailGrid
            images={images}
            selectedIndex={selectedImageIndex}
            onSelect={selectImage}
            annotations={annotations}
            validatedImages={validatedImages}
            token={token}
            thumbSize={112}
          />
        </div>

        <SidePanel
          filename={currentImage.filename}
          isValidated={isCurrentImageValidated}
          threads={threads}
          onValidate={handleValidateImage}
          onUnvalidate={handleUnvalidateImage}
          onAddMessage={onAddMessage}
          onChangeMessage={onChangeMessage}
          onDeleteThread={deleteThread}
          onFocusThread={(id) => setActiveThreadId(id)}
          onSubmit={handleSubmit}
          submitDisabled={isSubmitDisabled}
          saving={saving}
          withCorrectionsCount={withCorrectionsCount}
          validatedImagesCount={validatedImagesCount}
          totalCompleted={totalCompleted}
          totalImages={images.length}
        />
      </div>

      <Lightbox
        open={lightboxOpen}
        close={() => setLightboxOpen(false)}
        slides={lightboxSlides}
        index={selectedImageIndex}
        on={{ view: ({ index }) => setSelectedImageIndex(index) }}
        styles={{ container: { backgroundColor: "rgba(24, 24, 24, .95)" } }}
        render={{
          slide: ({ slide }) => (
            <AuthenticatedImage
              src={(slide as Slide & { src: string }).src}
              alt=""
              token={token}
              lazy={false}
              className={styles.mainImage}
            />
          ),
        }}
      />
    </>
  );
}
