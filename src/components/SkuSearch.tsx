"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ImageWithSkeleton from "./ImageWithSkeleton";
import styles from "./SkuSearch.module.css";
import type { SkuWithImages } from "@/types/review";

type Props = {
  skus: SkuWithImages[];
  onSelect: (item: SkuWithImages) => void;
  placeholder?: string;
  maxResults?: number;
  minChars?: number;
  debounceMs?: number;
  thumbSize?: number;
};

export default function SkuSearch({
  skus,
  onSelect,
  placeholder = "Buscar SKU…",
  maxResults = 200,
  minChars = 1,
  debounceMs = 200,
  thumbSize = 40,
}: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), debounceMs);
    return () => clearTimeout(t);
  }, [query, debounceMs]);

  const meetsMin = debounced.trim().length >= minChars;

  const filtered = useMemo(() => {
    if (!meetsMin) return [];
    const q = debounced.trim().toLowerCase();
    if (!q) return [];
    const out: SkuWithImages[] = [];
    for (let i = 0; i < skus.length && out.length < maxResults; i++) {
      const it = skus[i];
      if (it.sku.toLowerCase().includes(q)) out.push(it);
    }
    return out;
  }, [skus, debounced, maxResults, meetsMin]);

  // cerrar en blur fuera
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

  const commit = (item?: SkuWithImages) => {
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

  // scroll item activo
  useEffect(() => {
    if (hi < 0 || !listRef.current) return;
    const el = listRef.current.querySelectorAll("li")[hi] as
      | HTMLLIElement
      | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const hasQuery = query.trim().length > 0;

  return (
    <div
      className={styles.combobox}
      onBlur={handleBlur}
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-owns="sku-search-listbox"
    >
      <div className={styles.inputWrap}>
        <span className={styles.icon} aria-hidden>
          🔎
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
          aria-controls="sku-search-listbox"
          aria-activedescendant={hi >= 0 ? `sku-option-${hi}` : undefined}
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
            ×
          </button>
        )}
      </div>

      {open && (
        <>
          {filtered.length > 0 ? (
            <ul
              ref={listRef}
              id="sku-search-listbox"
              role="listbox"
              className={styles.menu}
            >
              {filtered.map((item, idx) => {
                const active = idx === hi;
                return (
                  <li
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
                    <ImageWithSkeleton
                      src={item.images[0]?.thumbnailUrl}
                      alt={item.sku}
                      width={thumbSize}
                      height={thumbSize}
                      className={styles.thumbnail}
                      sizes={`${thumbSize}px`}
                      quality={100}
                    />
                    <span className={styles.label}>{item.sku}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={styles.empty}>
              {meetsMin
                ? "Sin resultados"
                : `Escribe al menos ${minChars} carácter(es)…`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
