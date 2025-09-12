"use client";
import React from "react";
import styles from "./SidePanel.module.css";
import type { AnnotationThread } from "@/types/review";
import { format } from "timeago.js";
import "@/lib/timeago";
type Props = {
  name: string | null;
  isValidated: boolean;
  threads: AnnotationThread[]; // cada message puede tener createdByName
  onValidate: () => void;
  onUnvalidate: () => void;
  onAddMessage: (threadId: number) => void;
  onChangeMessage: (threadId: number, messageId: number, text: string) => void;
  onDeleteThread: (threadId: number) => void;
  onFocusThread: (id: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitDisabled: boolean;
  saving: boolean;
  withCorrectionsCount: number;
  validatedImagesCount: number;
  totalCompleted: number;
  totalImages: number;
  onlineUsers?: { username: string }[]; // opcional: presencia
};

export default function SidePanel({
  name,
  isValidated,
  threads,
  onValidate,
  onUnvalidate,
  onAddMessage,
  onChangeMessage,
  onDeleteThread,
  onFocusThread,
  onSubmit,
  submitDisabled,
  saving,
  withCorrectionsCount,
  validatedImagesCount,
  totalCompleted,
  totalImages,
  onlineUsers = [],
}: Props) {
  return (
    <div className={styles.sidePanel}>
      <div className={styles.commentSection}>
        <h3>Revisión de:</h3>
        <div className={styles.currentImageInfo}>
          <span>{name}</span>
          <div className={styles.presenceWrap}>
            <span className={styles.presenceDot} />
            <span className={styles.presenceText}>
              {onlineUsers.length} en línea
            </span>
          </div>
          {isValidated && <span className={styles.validatedBadge}>✅ Validada</span>}
        </div>

        <form onSubmit={onSubmit}>
          <div className={styles.validationButtons}>
            {!isValidated ? (
              <button type="button" className={styles.validateButton} onClick={onValidate}>
                ✅ Validar sin correcciones
              </button>
            ) : (
              <button type="button" className={styles.unvalidateButton} onClick={onUnvalidate}>
                ↩️ Desvalidar imagen
              </button>
            )}
          </div>

          <div className={styles.divider}>
            <span>{isValidated ? "Imagen validada" : "Añadir correcciones (haz clic en la imagen)"}</span>
          </div>

          <div className={styles.annotationsList}>
            {threads.length === 0 && !isValidated && (
              <p className={styles.noAnnotations}>
                Haz clic en un punto de la imagen para añadir una corrección.
              </p>
            )}

            {threads.map((th, index) => (
              <div key={th.id} className={styles.annotationItem}>
                <div className={styles.annotationHeader}>
                  <span className={styles.annotationNumber}>{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => onDeleteThread(th.id)}
                    className={styles.deleteAnnotationBtn}
                    aria-label="Eliminar anotación"
                  >
                    ×
                  </button>
                </div>

                {th.messages?.map((m) => (
                  <div key={m.id} className={styles.messageBlock}>
                    <div className={styles.messageMeta}>
                      <span className={styles.author}>
                        {m as any && (m as any).createdByName ? (m as any).createdByName : "Usuario"}
                      </span>
                      <span className={styles.timeago}>{format(m.createdAt, "es")}</span>
                    </div>
                    <textarea
                      placeholder="Mensaje…"
                      className={styles.commentBox}
                      value={m.text}
                      onChange={(e) => onChangeMessage(th.id, m.id, e.target.value)}
                      rows={3}
                      disabled={isValidated}
                      onFocus={() => onFocusThread(th.id)}
                    />
                  </div>
                ))}

                {!isValidated && (
                  <button
                    type="button"
                    className={styles.validateButton}
                    style={{ background: "#444", marginTop: 8 }}
                    onClick={() => onAddMessage(th.id)}
                  >
                    ➕ Añadir mensaje
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className={styles.actionButtons}>
            <button type="submit" className={styles.submitButton} disabled={submitDisabled || saving}>
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
            <strong>{totalCompleted} / {totalImages}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
