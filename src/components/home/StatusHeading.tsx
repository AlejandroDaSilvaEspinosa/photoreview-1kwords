// src/components/home/StatusHeading.tsx
"use client";

import styles from "./StatusHeading.module.css";

export default function StatusHeading({ label }: { label: string }) {
  return (
    <div className={styles.heading} role="separator" aria-label={label}>
      {label}
    </div>
  );
}
