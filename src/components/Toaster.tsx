"use client";

import React from "react";
import { useToast } from "@/hooks/useToast";
import s from "./Toaster.module.css";

const ICON: Record<string, string> = {
  info: "🟦",
  success: "🟢",
  warning: "🟠",
  error: "🔴",
};

export default function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className={s.wrap} aria-live="polite" aria-relevant="additions text">
      {toasts.map(t => (
        <div key={t.id} className={`${s.toast} ${s[t.variant]}`}>
          <div className={s.icon}>{ICON[t.variant]}</div>
          <div className={s.body}>
            {t.title && <div className={s.title}>{t.title}</div>}
            {t.description && <div className={s.desc}>{t.description}</div>}
            {t.actionLabel && (
              <button
                className={s.action}
                onClick={() => { t.onAction?.(); dismiss(t.id); }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
          <button aria-label="Cerrar" className={s.close} onClick={() => dismiss(t.id)}>×</button>
          <div className={s.progress} style={{ animationDuration: `${t.durationMs}ms` }} />
        </div>
      ))}
    </div>
  );
}
