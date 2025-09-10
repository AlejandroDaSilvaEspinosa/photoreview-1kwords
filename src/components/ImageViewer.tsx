"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./ImageViewer.module.css";
import { useAuth } from "@/contexts/AuthContext";
import Lightbox, { type Slide } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import AuthenticatedImage from "./images/AuthenticatedImage";
import ThumbnailGrid from "./images/ThumbnailGrid";
import SidePanel from "./images/SidePanel";
import type {
  Annotation,
  AnnotationState,
  ValidationState,
  SkuData,
  ImageItem,
} from "@/types/review";

interface ImageViewerProps {
  sku: string;
  targetImage?: string;
}

export default function ImageViewer({ sku, targetImage }: ImageViewerProps) {
  const { token } = useAuth();

  const [data, setData] = useState<SkuData | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationState>({});
  const [validatedImages, setValidatedImages] = useState<ValidationState>({});
  const [activeAnnotationId, setActiveAnnotationId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [completionMessage, setCompletionMessage] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Geometría para anotaciones
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

  useEffect(() => {
    const onResize = () => updateImageGeometry();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateImageGeometry]);

  // Cargar datos
  useEffect(() => {
    if (!sku || !token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    setCompletionMessage("");
    setData(null);

    fetch(`/api/images/${sku}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) throw new Error("No autorizado. Inicie sesión de nuevo.");
        if (!res.ok) throw new Error("Fallo al obtener las imágenes de la SKU.");
        return res.json();
      })
      .then((fetchedData: SkuData) => {
        if (fetchedData.allReviewed) {
          setCompletionMessage("¡Todas las imágenes para esta SKU ya han sido revisadas!");
          return;
        }
        if (!fetchedData.images?.length) {
          setError(`No se encontraron imágenes pendientes para la SKU ${sku}.`);
          return;
        }

        setData(fetchedData);

        // Estados iniciales
        const initialAnnotations: AnnotationState = {};
        const initialValidation: ValidationState = {};
        fetchedData.images.forEach((img) => {
          initialAnnotations[img.filename] = [];
          initialValidation[img.filename] = false;
        });
        setAnnotations(initialAnnotations);
        setValidatedImages(initialValidation);

        // Selección inicial
        const idx = targetImage
          ? fetchedData.images.findIndex((img) => img.filename === targetImage)
          : -1;
        setSelectedImageIndex(idx !== -1 ? idx : 0);
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        setLoading(false);
        setTimeout(updateImageGeometry, 0);
      });
  }, [sku, token, targetImage, updateImageGeometry]);

  // Reposicionar al cambiar ?image=
  useEffect(() => {
    if (!data || !targetImage) return;
    const idx = data.images.findIndex((img) => img.filename === targetImage);
    if (idx !== -1) setSelectedImageIndex(idx);
  }, [targetImage, data]);

  // Click para anotar
  const handleImageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(`.${styles.annotationNode}`)) return;
    if (!data?.images[selectedImageIndex]) return;
    if (validatedImages[data.images[selectedImageIndex].filename]) return;

    const imgEl = imgRef.current;
    if (!imgEl) return;

    const iRect = imgEl.getBoundingClientRect();
    const x = event.clientX - iRect.left;
    const y = event.clientY - iRect.top;
    if (x < 0 || y < 0 || x > iRect.width || y > iRect.height) return;

    const xPercent = (x / iRect.width) * 100;
    const yPercent = (y / iRect.height) * 100;

    const currentImage = data.images[selectedImageIndex];
    const newAnnotation: Annotation = {
      id: Date.now(),
      x: xPercent,
      y: yPercent,
      comment: "",
    };

    setAnnotations((prev) => ({
      ...prev,
      [currentImage.filename]: [...(prev[currentImage.filename] || []), newAnnotation],
    }));
    setActiveAnnotationId(newAnnotation.id);
  };

  const handleAnnotationChange = (id: number, comment: string) => {
    if (!data?.images[selectedImageIndex]) return;
    const currentImage = data.images[selectedImageIndex];
    setAnnotations((prev) => ({
      ...prev,
      [currentImage.filename]: prev[currentImage.filename].map((ann) =>
        ann.id === id ? { ...ann, comment } : ann
      ),
    }));
  };

  const deleteAnnotation = (id: number) => {
    if (!data?.images[selectedImageIndex]) return;
    const currentImage = data.images[selectedImageIndex];
    setAnnotations((prev) => ({
      ...prev,
      [currentImage.filename]: prev[currentImage.filename].filter((ann) => ann.id !== id),
    }));
    if (activeAnnotationId === id) setActiveAnnotationId(null);
  };

  const handleValidateImage = () => {
    if (!data?.images[selectedImageIndex]) return;
    const currentImage = data.images[selectedImageIndex];
    setValidatedImages((prev) => ({ ...prev, [currentImage.filename]: true }));
    if (selectedImageIndex < (data?.images.length || 1) - 1) {
      setTimeout(() => setSelectedImageIndex((i) => i + 1), 300);
    }
  };

  const handleUnvalidateImage = () => {
    if (!data?.images[selectedImageIndex]) return;
    const currentImage = data.images[selectedImageIndex];
    setValidatedImages((prev) => ({ ...prev, [currentImage.filename]: false }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!data || !token) return;

    setSaving(true);
    try {
      const reviewData = data.images.map((img) => ({
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
        body: JSON.stringify({ sku: data.sku, review: reviewData }),
      });

      if (res.status === 401) throw new Error("No autorizado. Inicie sesión de nuevo.");
      if (!res.ok) throw new Error("Error en la respuesta del servidor");

      alert("¡Revisión guardada con éxito!");
      setCompletionMessage("¡Revisión completada! Puedes buscar otra SKU.");
      setData(null);
    } catch (err: any) {
      console.error("Error al guardar:", err);
      alert(err?.message || "Error al guardar la revisión.");
    } finally {
      setSaving(false);
    }
  };

  const selectImage = (index: number) => {
    if (!data?.images?.length) return;
    if (index < 0 || index >= data.images.length) return;
    setSelectedImageIndex(index);
    setActiveAnnotationId(null);
    setTimeout(updateImageGeometry, 0);
  };

  if (loading) return <div className={styles.message}>Cargando SKU...</div>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (completionMessage) return <div className={styles.message}>{completionMessage}</div>;
  if (!data?.images?.length) return null;

  const currentImage = data.images[selectedImageIndex];
  const currentAnnotations = annotations[currentImage.filename] || [];
  const isCurrentImageValidated = !!validatedImages[currentImage.filename];

  const withCorrectionsCount = data.images.filter((img) => {
    const anns = annotations[img.filename] || [];
    return anns.length > 0 && anns.every((a) => a.comment.trim() !== "");
  }).length;

  const validatedImagesCount = data.images.filter(
    (img) => validatedImages[img.filename]
  ).length;

  const isCompleted = (img: ImageItem) => {
    const anns = annotations[img.filename] || [];
    const hasAll = anns.length > 0 && anns.every((a) => a.comment.trim() !== "");
    return validatedImages[img.filename] || hasAll;
  };
  const totalCompleted = data.images.filter(isCompleted).length;
  const isSubmitDisabled = totalCompleted !== data.images.length;

  const lightboxSlides: Slide[] = data.images.map((image) => ({ src: image.url }));

  return (
    <>
      <div className={styles.viewerContainer}>
        {/* Panel principal */}
        <div className={styles.mainViewer}>
          <div className={styles.imageHeader}>
            <h1>Revisión de SKU: {data.sku}</h1>
            <div className={styles.imageCounter}>
              {selectedImageIndex + 1} de {data.images.length}
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

              <button
                type="button"
                className={styles.zoomButton}
                aria-label="Abrir visor"
                onClick={() => setLightboxOpen(true)}
              >
                🔍
              </button>

              {/* Puntos de anotación */}
              {currentAnnotations.map((ann, index) => {
                const topPx = imgBox.offsetTop + (ann.y / 100) * imgBox.height;
                const leftPx = imgBox.offsetLeft + (ann.x / 100) * imgBox.width;
                return (
                  <div
                    key={ann.id}
                    className={`${styles.annotationNode} ${
                      activeAnnotationId === ann.id ? styles.activeNode : ""
                    }`}
                    style={{ top: `${topPx}px`, left: `${leftPx}px` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveAnnotationId(ann.id);
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
              disabled={selectedImageIndex === data.images.length - 1}
              aria-label="Imagen siguiente"
            >
              ›
            </button>
          </div>

          {/* Thumbnails */}
          <ThumbnailGrid
            images={data.images}
            selectedIndex={selectedImageIndex}
            onSelect={selectImage}
            annotations={annotations}
            validatedImages={validatedImages}
            token={token}
            thumbSize={112}
          />
        </div>

        {/* Panel lateral */}
        <SidePanel
          filename={currentImage.filename}
          isValidated={isCurrentImageValidated}
          annotations={currentAnnotations}
          onValidate={handleValidateImage}
          onUnvalidate={handleUnvalidateImage}
          onChangeComment={handleAnnotationChange}
          onDeleteAnnotation={deleteAnnotation}
          onFocusAnnotation={(id) => setActiveAnnotationId(id)}
          onSubmit={handleSubmit}
          submitDisabled={isSubmitDisabled}
          saving={saving}
          withCorrectionsCount={withCorrectionsCount}
          validatedImagesCount={validatedImagesCount}
          totalCompleted={totalCompleted}
          totalImages={data.images.length}
        />
      </div>

      {/* Lightbox */}
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
