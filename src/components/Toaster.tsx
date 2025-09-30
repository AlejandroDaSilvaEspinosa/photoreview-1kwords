// src/components/Toaster.tsx
"use client";

import React from "react";
import { useToast } from "@/hooks/useToast";
import s from "./Toaster.module.css";
import ReactMarkdown from "react-markdown";
import Image from "next/image";

export default function Toaster() {
  const { toasts, dismiss, pausedAll, pauseAll, resumeAll } = useToast();
  const L = toasts.length; // ← total para calcular el z-index

  return (
    <div
      className={`${s.wrap} ${pausedAll ? s.expanded : ""}`}
      onMouseEnter={pauseAll}
      onMouseLeave={resumeAll}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {toasts.map((t, idx) => {
        const isNewest = idx === 0; // el de más abajo
        return (
          <div
            key={t.id}
            className={`${s.toast} ${s[t.variant]} ${isNewest ? s.isNew : ""}`}
            style={
              { zIndex: 1000 + (L - idx), "--i": idx } as React.CSSProperties
            }
          >
            {t.thumbUrl ? (
              <Image
                width={56}
                height={56}
                className={s.thumb}
                src={t.thumbUrl}
                alt=""
                aria-hidden
              />
            ) : null}

            <div className={s.body}>
              {t.title && <div className={s.title}>{t.title}</div>}
              {t.description && (
                <div className={s.desc}>
                  <ReactMarkdown>{t.description}</ReactMarkdown>
                </div>
              )}
              <div className={s.bottomRow}>
                {t.actionLabel && (
                  <button
                    className={s.action}
                    onClick={() => {
                      t.onAction?.();
                      dismiss(t.id);
                    }}
                  >
                    {t.actionLabel}
                  </button>
                )}
                {t.timeAgo ? (
                  <div className={s.bottomRight}>{t.timeAgo}</div>
                ) : null}
              </div>
            </div>
            <button
              aria-label="Cerrar"
              className={s.close}
              onClick={() => dismiss(t.id)}
            >
              <CloseIcon />
            </button>
            <div
              className={s.progress}
              style={{
                animationDuration: `${t.durationMs}ms`,
                animationPlayState: pausedAll ? "paused" : "running",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

//ACTIVAR TOAST MANERA MANUAL ERRORES O WARNINGS

// import { toastError, emitToast } from "@/hooks/useToast";

// // Caso típico:
// try {
//   // ...
// } catch (e) {
//   toastError(e, { title: "Fallo guardando la revisión" });
// }

// // O manualmente con un toast custom:
// emitToast({
//   variant: "warning",
//   title: "Conexión inestable",
//   description: "Intentaremos reintentar en segundo plano…",
//   durationMs: 5000,
// });
