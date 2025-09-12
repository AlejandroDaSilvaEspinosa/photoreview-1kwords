"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import styles from "./SkuSearch.module.css";
import type { ImageItem } from "@/types/review";

export type SkuItem = {
  sku: string;
  image: ImageItem[];
};

type Props = {
  skus: [{ sku: string; images: ImageItem[]; }];
  onSelect: (item: { sku: string; images: ImageItem[]; }) => void;
  placeholder?: string;
  maxResults?: number;  // default 20
  minChars?: number;    // default 2
  debounceMs?: number;  // default 200
  thumbSize?: number;   // default 28 (px)
};

export default function SkuSearch({
  skus,
  onSelect,
  placeholder = "Buscar SKU…",
  maxResults = 200,
  minChars = 1,
  debounceMs = 200,
  thumbSize = 28,
}: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<number>(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(t);
  }, [query, debounceMs]);

  const meetsMinChars = debouncedQuery.trim().length >= minChars;

  const filtered = useMemo(() => {
    if (!meetsMinChars) return [];
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    const out:any[] = [];
    for (let i = 0; i < skus.length && out.length < maxResults; i++) {
      const it = skus[i];
      if (it.sku.toLowerCase().includes(q)) out.push(it);
    }
    return out;
  }, [skus, debouncedQuery, maxResults, meetsMinChars]);

  // cerrar en blur fuera
    // dentro de SkuSearch.tsx
    const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    // ⬇️ snapshot antes del rAF (el synthetic event puede “vaciarse”)
    const root = e.currentTarget;
    const nextFocus = (e.relatedTarget as Node | null) ?? null;

    requestAnimationFrame(() => {
        // puede que el componente se haya desmontado
        if (!root || !document.body.contains(root)) {
        setOpen(false);
        setHighlighted(-1);
        return;
        }

        // intenta usar el target calculado; si no, cae a activeElement
        const active = nextFocus ?? (document.activeElement as Node | null);
        if (!active || !root.contains(active)) {
        setOpen(false);
        setHighlighted(-1);
        }
    });
    };


  const commitSelection = (item: { sku: string; images: ImageItem[]; } | undefined) => {
    if (!item) return;
    onSelect(item); 
    setQuery(item.sku);
    setOpen(false);
    setHighlighted(-1);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      if (meetsMinChars) setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitSelection(filtered[highlighted] ?? filtered[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  };

  // scroll item activo a la vista
  useEffect(() => {
    if (highlighted < 0 || !listRef.current) return;
    const el = listRef.current.querySelectorAll("li")[highlighted] as HTMLLIElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <div
      className={styles.combobox}
      onBlur={handleBlur}
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-owns="sku-search-listbox"
    >
      <input
        ref={inputRef}
        className={styles.input}
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(meetsMinChars)}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(next.trim().length >= minChars);
          setHighlighted(-1);
        }}
        onKeyDown={onKeyDown}
        aria-autocomplete="list"
        aria-controls="sku-search-listbox"
        aria-activedescendant={highlighted >= 0 ? `sku-option-${highlighted}` : undefined}
      />

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          id="sku-search-listbox"
          role="listbox"
          className={styles.menu}
        >
          {filtered.map((item, idx) => {
            const isActive = idx === highlighted;
            return (
              <li
                key={`${item.sku}-${idx}`}
                id={`sku-option-${idx}`}
                role="option"
                aria-selected={isActive}
                className={`${styles.item} ${isActive ? styles.active : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitSelection(item);
                }}
                onMouseEnter={() => setHighlighted(idx)}
              >
                <Image
                  src={item.images[0].thumbnailUrl}
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
      )}
    </div>
  );
}
