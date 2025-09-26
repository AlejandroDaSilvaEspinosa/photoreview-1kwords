// src/lib/api.ts
export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** Fetch JSON con manejo de errores coherente. */
export async function apiJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new ApiError("No hay conexión. Reintentaremos en breve.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(text || "Error del servidor", res.status);
  }
  return res.json() as Promise<T>;
}
