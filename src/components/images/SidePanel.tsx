"use client";

import React from "react";
import styles from "./SidePanel.module.css";
import type { Annotation } from "@/types/review";

type Props = {
  filename: string;
  isValidated: boolean;
  annotations: Annotation[];
  onValidate: () => void;
  onUnvalidate: () => void;
  onChangeComment: (id: number, comment: string) => void;
  onDeleteAnnotation: (id: number) => void;
  onFocusAnnotation: (id: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitDisabled: boolean;
  saving: boolean;
  withCorrectionsCount: number;
  validatedImagesCount: number;
  totalCompleted: number;
  totalImages: number;
};

export default function SidePanel({
  filename,
  isValidated,
  annotations,
  onValidate,
  onUnvalidate,
  onChangeComment,
  onDeleteAnnotation,
  onFocusAnnotation,
  onSubmit,
  submitDisabled,
  saving,
  withCorrectionsCount,
  validatedImagesCount,
  totalCompleted,
  totalImages,
}: Props) {
  return (
    <div className={styles.sidePanel}>
      <div className={styles.commentSection}>
        <h3>Revisión de:</h3>
        <div className={styles.currentImageInfo}>
          <span>{filename}</span>
          {isValidated && <span className={styles.validatedBadge}>✅ Validada</span>}
        </div>

        <form onSubmit={onSubmit}>
          <div className={styles.validationButtons}>
            {!isValidated ? (
              <button
                type="button"
                className={styles.validateButton}
                onClick={onValidate}
              >
                ✅ Validar sin correcciones
              </button>
            ) : (
              <button
                type="button"
                className={styles.unvalidateButton}
                onClick={onUnvalidate}
              >
                ↩️ Desvalidar imagen
              </button>
            )}
          </div>

          <div className={styles.divider}>
            <span>
              {isValidated
                ? "Imagen validada"
                : "Añadir correcciones (haz clic en la imagen)"}
            </span>
          </div>

          <div className={styles.annotationsList}>
            {annotations.length === 0 && !isValidated && (
              <p className={styles.noAnnotations}>
                Haz clic en un punto de la imagen para añadir una corrección.
              </p>
            )}

            {annotations.map((ann, index) => (
              <div key={ann.id} className={styles.annotationItem}>
                <div className={styles.annotationHeader}>
                  <span className={styles.annotationNumber}>{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => onDeleteAnnotation(ann.id)}
                    className={styles.deleteAnnotationBtn}
                    aria-label="Eliminar anotación"
                  >
                    ×
                  </button>
                </div>
                <textarea
                  placeholder={`Corrección #${index + 1}...`}
                  className={styles.commentBox}
                  value={ann.comment}
                  onChange={(e) => onChangeComment(ann.id, e.target.value)}
                  rows={4}
                  disabled={isValidated}
                  onFocus={() => onFocusAnnotation(ann.id)}
                />
              </div>
            ))}
          </div>

          <div className={styles.actionButtons}>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={submitDisabled || saving}
            >
              {saving ? "Guardando…" : "Guardar Revisión Completa"}
            </button>
            {submitDisabled && !saving && (
              <p className={styles.submitDisabledMessage}>
                Debes revisar todas las imágenes para poder guardar.
              </p>
            )}
          </div>
        </form>

        <div className={styles.reviewSummary}>
          <h4>Progreso:</h4>
          <div className={styles.progressInfo}>
            <span>Con correcciones:</span>
            <strong className={styles.commentCount}>{withCorrectionsCount}</strong>
          </div>
          <div className={styles.progressInfo}>
            <span>Validadas:</span>
            <strong className={styles.validatedCount}>{validatedImagesCount}</strong>
          </div>
          <div className={styles.progressInfo}>
            <span>Completadas:</span>
            <strong>
              {totalCompleted} / {totalImages}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}
