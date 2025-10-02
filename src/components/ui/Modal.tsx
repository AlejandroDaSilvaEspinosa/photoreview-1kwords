"use client";

import React, { PropsWithChildren, useEffect } from "react";
import styles from "./Modal.module.css";
import CloseIcon from "@/icons/close.svg";

type ActionType = "primary" | "warn" | "danger" | "cancel";

type Action = {
  label: string;
  type?: ActionType;
  onClick: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  footer?: React.ReactNode;
  actions?: Action[];
};

export default function AppModal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  actions,
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
            <CloseIcon />
          </button>
        </header>

        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}

        {children && <div className={styles.body}>{children}</div>}

        {(footer || actions) && (
          <div className={styles.footer}>
            {footer}
            {actions &&
              actions.map((a, i) => (
                <button
                  key={i}
                  className={`${styles.actionBtn} ${
                    a.type === "primary"
                      ? styles.actionPrimary
                      : a.type === "warn"
                      ? styles.actionWarn
                      : a.type === "danger"
                      ? styles.actionDanger
                      : ""
                  }`}
                  onClick={a.onClick}
                >
                  {a.label}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
