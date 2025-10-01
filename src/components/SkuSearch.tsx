"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ImageWithSkeleton from "./ImageWithSkeleton";
import styles from "./SkuSearch.module.css";
import type { SkuWithImagesAndStatus, SkuStatus } from "@/types/review";
import SearchIcon from "@/icons/search.svg";
import CloseIcon from "@/icons/close.svg";
import ChatIcon from "@/icons/chat.svg"; // ⬅️ NUEVO

type Props = {
  skus: SkuWithImagesAndStatus[];
  onSelect: (item: SkuWithImagesAndStatus) => void;
  placeholder?: string;
  maxResults?: number;
  minChars?: number;
  debounceMs?: number;
  thumbSize?: number;
  /** mapa sku -> tiene mensajes sin leer */
  unreadBySku?: Record<string, boolean>; // ⬅️ NUEVO
};

const STATUS_LABEL: Record<SkuStatus, string> = {
  pending_validation: "Pendiente de validación",
  needs_correction: "Con correcciones",
  validated: "Validado",
  reopened: "Reabierto",
};

export default function SkuSearch({
  skus,
  onSelect,
  placeholder = "Buscar SKU…",
  maxResults = 200,
  minChars = 1,
  debounceMs = 200,
  thumbSize = 64,
  unreadBySku,
}: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), debounceMs);
    return () => clearTimeout(t);
  }, [query, debounceMs]);

  const meetsMin = debounced.trim().length >= minChars;

  const filtered = useMemo(() => {
    if (!meetsMin) return [];
    const q = debounced.trim().toLowerCase();
    if (!q) return [];
    const out: SkuWithImagesAndStatus[] = [];
    for (let i = 0; i < skus.length && out.length < maxResults; i++) {
      const it = skus[i];
      if (it.sku.toLowerCase().includes(q)) out.push(it);
    }
    return out;
  }, [skus, debounced, maxResults, meetsMin]);

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const root = e.currentTarget;
    const next = (e.relatedTarget as Node | null) ?? null;
    requestAnimationFrame(() => {
      if (!root || !document.body.contains(root)) {
        setOpen(false);
        setHi(-1);
        return;
      }
      const active = next ?? (document.activeElement as Node | null);
      if (!active || !root.contains(active)) {
        setOpen(false);
        setHi(-1);
      }
    });
  };

  const commit = (item?: SkuWithImagesAndStatus) => {
    if (!item) return;
    onSelect(item);
    setQuery(item.sku);
    setOpen(false);
    setHi(-1);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      if (meetsMin) setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(filtered[hi] ?? filtered[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setHi(-1);
    }
  };

  useEffect(() => {
    if (hi < 0 || !panelRef.current) return;
    const list = panelRef.current.querySelector(`[role="listbox"]`);
    const el =
      (list?.querySelectorAll('[role="option"]')?.[hi] as HTMLElement) || null;
    el?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const hasQuery = query.trim().length > 0;

  const renderMatch = useCallback(
    (text: string) => {
      const q = debounced.trim();
      if (!q) return <>{text}</>;
      const lower = text.toLowerCase();
      const needle = q.toLowerCase();
      const nodes: React.ReactNode[] = [];
      let i = 0;
      while (i < text.length) {
        const idx = lower.indexOf(needle, i);
        if (idx === -1) {
          nodes.push(<span key={i}>{text.slice(i)}</span>);
          break;
        }
        if (idx > i) nodes.push(<span key={i}>{text.slice(i, idx)}</span>);
        nodes.push(
          <span key={`m-${idx}`} className={styles.match}>
            {text.slice(idx, idx + q.length)}
          </span>
        );
        i = idx + q.length;
      }
      return <>{nodes}</>;
    },
    [debounced]
  );

  const statusClass = (s: SkuStatus) => {
    switch (s) {
      case "validated":
        return styles.stValidated;
      case "needs_correction":
        return styles.stNeedsFix;
      case "pending_validation":
        return styles.stPending;
      case "reopened":
        return styles.stReopened;
      default:
        return "";
    }
  };

  return (
    <div
      className={styles.combobox}
      onBlur={handleBlur}
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
    >
      <div className={styles.inputWrap}>
        <span className={styles.icon} aria-hidden>
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          className={styles.input}
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(meetsMin)}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setOpen(next.trim().length >= minChars);
            setHi(-1);
          }}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
        />
        {hasQuery && (
          <button
            type="button"
            className={styles.clearBtn}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery("");
              setOpen(false);
              setHi(-1);
              inputRef.current?.focus();
            }}
            aria-label="Limpiar búsqueda"
            title="Limpiar"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {open && (
        <div className={styles.panel} ref={panelRef}>
          <div role="listbox" className={styles.list} id="sku-search-listbox">
            {filtered.length === 0 ? (
              <div className={styles.empty}>
                {meetsMin
                  ? "Sin resultados"
                  : `Escribe al menos ${minChars} carácter(es)…`}
              </div>
            ) : (
              filtered.map((item, idx) => {
                const active = idx === hi;
                const total = item.counts?.total ?? item.images?.length ?? 0;
                const needsFix = item.counts?.needs_correction ?? 0;
                const hasUnread = unreadBySku?.[item.sku];

                return (
                  <div
                    key={`${item.sku}-${idx}`}
                    id={`sku-option-${idx}`}
                    role="option"
                    aria-selected={active}
                    className={`${styles.item} ${active ? styles.active : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(item);
                    }}
                    onMouseEnter={() => setHi(idx)}
                  >
                    <div className={styles.thumbWrap}>
                      <ImageWithSkeleton
                        src={item.images?.[0]?.thumbnailUrl}
                        alt={item.sku}
                        width={thumbSize}
                        height={thumbSize}
                        className={styles.thumb}
                        sizes={`${thumbSize}px`}
                        quality={100}
                      />
                    </div>

                    <div className={styles.itemContent}>
                      <div className={styles.itemTop}>
                        <span className={styles.kind}>
                          SKU: {renderMatch(item.sku)}
                        </span>

                        <span
                          className={`${styles.statusPill} ${statusClass(
                            item.status
                          )}`}
                          title={STATUS_LABEL[item.status]}
                        >
                          {STATUS_LABEL[item.status]}
                        </span>
                      </div>

                      <div className={styles.line}>
                        <span className={styles.meta}>
                          Número imágenes: <strong>{total}</strong>
                          {needsFix > 0 && (
                            <span className={styles.corrections}>
                              {" "}
                              · {needsFix} con correcciones
                            </span>
                          )}
                        </span>
                        {hasUnread && (
                          <span
                            className={styles.chatBadge}
                            title="Mensajes sin leer"
                          >
                            <ChatIcon />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
