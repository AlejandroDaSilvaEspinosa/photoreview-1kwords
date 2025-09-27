// app/login/page.tsx
"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState(""); // ← usa email
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);

    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message || "Credenciales incorrectas");
      setSubmitting(false);
      return;
    }
    // La cookie de sesión queda gestionada por @supabase/ssr
    router.replace("/");
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.logoWrapper}>
        <Image
          src="/1kwords-logo.png"
          alt="1K Words Logo"
          width={250}
          height={70}
          priority
        />
      </div>

      <div className={styles.loginBox}>
        <h1>Iniciar Sesión</h1>
        <p>Acceso al panel de revisión de productos</p>

        <form onSubmit={handleSubmit} noValidate>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            className={styles.input}
            aria-label="Email"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className={styles.input}
            aria-label="Contraseña"
          />

          {error && <p className={styles.error}>{error}</p>}

          <button
            type="submit"
            className={styles.button}
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? "Accediendo…" : "Acceder"}
          </button>
        </form>
      </div>
    </div>
  );
}
