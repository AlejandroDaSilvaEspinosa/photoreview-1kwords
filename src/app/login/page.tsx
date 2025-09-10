// Fichero: src/app/login/page.tsx
"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setError("");
    setSubmitting(true);
    const controller = new AbortController();

    try {
      // Consumimos la API propia de Next.js (misma origin)
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });

      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        // El backend podría no devolver JSON en error → ignoramos
      }

      if (!res.ok) {
        const msg =
          payload?.message ||
          payload?.error ||
          (res.status === 401
            ? "Credenciales incorrectas"
            : `Error ${res.status}`);
        throw new Error(msg);
      }

      const accessToken = payload?.accessToken;
      if (!accessToken) throw new Error("Respuesta inválida del servidor");

      login(accessToken); // guarda el token en tu AuthContext
      router.replace("/");
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError(
        err?.message ||
          "Usuario o contraseña incorrectos. Por favor, inténtalo de nuevo."
      );
    } finally {
      setSubmitting(false);
    }

    return () => controller.abort();
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
            type="text"
            placeholder="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            className={styles.input}
            aria-label="Usuario"
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
