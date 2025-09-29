"use client";

import React, { PropsWithChildren, useEffect } from "react";
import styles from "./AppModal.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  footer?: React.ReactNode; // opcional (botonera personalizada)
};

export default function AppModal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
}: PropsWithChildren<Props>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <header className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
          >
            ✕
          </button>
        </header>

        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}

        <div className={styles.body}>{children}</div>

        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>
  );
}
