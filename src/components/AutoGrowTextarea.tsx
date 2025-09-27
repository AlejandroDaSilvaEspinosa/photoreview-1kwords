"use client";
import React, { useCallback, useEffect, useRef } from "react";
import clsx from "clsx";
import styles from "./AutoGrowTextarea.module.css";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number; // por defecto 1
  maxRows?: number; // por defecto 5
  className?: string;
  growsUp?: boolean; // si true, la altura “empuja” hacia arriba (default)
  onEnter?: () => void; // enviar con Enter (Shift+Enter hace salto de línea)
};

export default function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  minRows = 1,
  maxRows = 5,
  className,
  growsUp = true,
  onEnter,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const cs = window.getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 16;
    const padding =
      parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) || 0;
    const border =
      parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) || 0;

    const minH = Math.ceil(minRows * lineHeight + padding + border);
    const maxH = Math.ceil(maxRows * lineHeight + padding + border);

    // clave para evitar el bug de crecimiento infinito
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxH);
    el.style.height = `${Math.max(next, minH)}px`;
    el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
  }, [minRows, maxRows]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  useEffect(() => {
    const ro = new ResizeObserver(() => resize());
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [resize]);

  // --- Markdown helpers (Ctrl/Cmd+B para **negrita**) ---
  const wrapSelection = (before: string, after = before) => {
    const el = ref.current;
    if (!el) return;

    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;

    const selected = value.slice(start, end);
    const alreadyWrapped =
      value.slice(start - before.length, start) === before &&
      value.slice(end, end + after.length) === after;

    let newText: string;
    let caretStart = start;
    let caretEnd = end;

    if (alreadyWrapped) {
      // deshacer envoltura
      newText =
        value.slice(0, start - before.length) +
        selected +
        value.slice(end + after.length);
      caretStart = start - before.length;
      caretEnd = end - after.length;
    } else {
      // aplicar envoltura
      newText =
        value.slice(0, start) + before + selected + after + value.slice(end);
      caretStart = start + before.length;
      caretEnd = end + before.length;
    }

    onChange(newText);

    // reponer selección/caret
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caretStart, caretEnd);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter = enviar (sin Shift)
    if (onEnter && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onEnter();
      return;
    }
    // ⌘/Ctrl + B => **negrita**
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      wrapSelection("**");
    }
  };

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={clsx(styles.chatInput, growsUp && styles.growUp, className)}
      onKeyDown={onKeyDown}
    />
  );
}
