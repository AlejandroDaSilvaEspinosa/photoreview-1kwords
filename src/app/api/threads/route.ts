// api/threads/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase"; // [30]
import { cookies } from "next/headers";
import { verifyToken, SESSION_COOKIE_NAME, UserPayload } from "@/lib/auth"; // Importar UserPayload [6, 30]

export async function POST(req: Request) {
  const body = await req.json();
  const { sku, imageName, x, y } = body;

  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const user: UserPayload | null = token ? verifyToken(token) : null; // Tipado explícito

  if (!user?.name) { // Verificar que el nombre de usuario existe
    return new NextResponse("No autorizado", { status: 401 }); // Mensaje en español
  }

  const sb = supabaseAdmin();

  // Obtener el ID del usuario desde la tabla app_users basado en el nombre de usuario del JWT [32]
  const { data: appUser, error: userError } = await sb
    .from("app_users")
    .select("id")
    .eq("username", user.name)
    .single();

  if (userError || !appUser) {
    console.error("Error obteniendo el ID del usuario:", userError);
    return NextResponse.json({ error: "Fallo al autenticar al usuario" }, { status: 500 });
  }

  const authorId = appUser.id; // ID del usuario de la base de datos

  // Insertar un nuevo hilo de revisión en la tabla 'review_threads' [31]
  const { data, error } = await sb
    .from("review_threads")
    .insert({
      sku,
      image_name: imageName,
      x,
      y,
      status: "pending",
      created_by: authorId, // Usar el ID del usuario de la base de datos
    })
    .select("id") // Seleccionar solo el ID del nuevo hilo para devolverlo
    .single();

  if (error) {
    console.error("Error creando hilo en /api/threads:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Devolver el ID del hilo creado para el cliente
  return NextResponse.json({ threadId: data.id });
}