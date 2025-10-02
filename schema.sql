


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."image_status" AS ENUM (
    'finished',
    'needs_correction'
);


ALTER TYPE "public"."image_status" OWNER TO "postgres";


CREATE TYPE "public"."notification_kind" AS ENUM (
    'new_message',
    'new_thread',
    'change_sku_status',
    'change_image_status'
);


ALTER TYPE "public"."notification_kind" OWNER TO "postgres";


CREATE TYPE "public"."notification_type" AS ENUM (
    'new_thread',
    'new_message',
    'change_thread_status',
    'change_image_status',
    'change_sku_status',
    'image_status_changed',
    'sku_status_changed'
);


ALTER TYPE "public"."notification_type" OWNER TO "postgres";


CREATE TYPE "public"."sku_status" AS ENUM (
    'pending_validation',
    'needs_correction',
    'validated',
    'reopened'
);


ALTER TYPE "public"."sku_status" OWNER TO "postgres";


CREATE TYPE "public"."thread_status" AS ENUM (
    'pending',
    'corrected',
    'reopened',
    'deleted'
);


ALTER TYPE "public"."thread_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_ensure_delivered_receipt"("p_message_id" integer, "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into public.review_message_receipts (message_id, user_id, read_at)
  values (p_message_id, p_user_id, null)
  on conflict (message_id, user_id) do nothing;
$$;


ALTER FUNCTION "public"."_ensure_delivered_receipt"("p_message_id" integer, "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_notify"("p_user_id" "uuid", "p_author_id" "uuid", "p_type" "public"."notification_type", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  -- no notificar al propio autor; si quieres permitirlo, comenta este bloque
  if p_user_id is not null and p_author_id is not null and p_user_id = p_author_id then
    return;
  end if;

  insert into public.notifications (user_id, author_id, type, payload)
  values (
    p_user_id,
    case when public.is_system_user(p_author_id) then null else p_author_id end,
    p_type,
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."_notify"("p_user_id" "uuid", "p_author_id" "uuid", "p_type" "public"."notification_type", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_uid"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;


ALTER FUNCTION "public"."auth_uid"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_image_status"("p_sku" "text", "p_image" "text") RETURNS "public"."image_status"
    LANGUAGE "plpgsql"
    AS $$DECLARE
  c_open int;
  st image_status;
  v_rows int;
BEGIN
  SELECT COUNT(*) INTO c_open
  FROM public.review_threads
  WHERE sku = p_sku
    AND image_name = p_image
    AND status::text IN ('pending','reopened');

  IF COALESCE(c_open,0) > 0 THEN
    st := 'needs_correction'::image_status;
  ELSE
    st := 'finished'::image_status;
  END IF;

  INSERT INTO public.review_images_status (sku, image_name, status, updated_at)
  VALUES (p_sku, p_image, st, now())
  ON CONFLICT (sku, image_name) DO UPDATE
    SET status = EXCLUDED.status,
        updated_at = now()
    -- Solo actualizar si el estado cambia realmente
    WHERE public.review_images_status.status IS DISTINCT FROM EXCLUDED.status;

  -- ¿Se insertó/actualizó alguna fila?
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    PERFORM public.compute_sku_status(p_sku);
  END IF;

  RETURN st;
END$$;


ALTER FUNCTION "public"."compute_image_status"("p_sku" "text", "p_image" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_sku_status"("p_sku" "text") RETURNS "public"."sku_status"
    LANGUAGE "plpgsql"
    AS $$DECLARE
  needs        int;
  total        int;
  current_stat sku_status;
  next_status  sku_status;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status::text = 'needs_correction') AS needs,
    COUNT(*)                                                   AS total
  INTO needs, total
  FROM public.review_images_status
  WHERE sku = p_sku;

  SELECT status INTO current_stat
  FROM public.review_skus_status
  WHERE sku = p_sku;

  IF COALESCE(needs,0) > 0 THEN
    next_status := 'needs_correction';
  ELSE
    IF current_stat IN ('validated','reopened') THEN
      -- Estado "pegajoso": mantenemos validated/reopened si ya estaba así
      next_status := current_stat;
    ELSE
      next_status := 'pending_validation';
    END IF;
  END IF;

  INSERT INTO public.review_skus_status (sku, status, images_total, images_needing_fix, updated_at)
  VALUES (p_sku, next_status, COALESCE(total,0), COALESCE(needs,0), now())
  ON CONFLICT (sku) DO UPDATE
    SET status             = EXCLUDED.status,
        images_total       = EXCLUDED.images_total,
        images_needing_fix = EXCLUDED.images_needing_fix,
        updated_at         = now()
    -- Solo actualizar si algo cambia realmente
    WHERE review_skus_status.status IS DISTINCT FROM EXCLUDED.status
       OR review_skus_status.images_total IS DISTINCT FROM EXCLUDED.images_total
       OR review_skus_status.images_needing_fix IS DISTINCT FROM EXCLUDED.images_needing_fix;

  RETURN next_status;
END$$;


ALTER FUNCTION "public"."compute_sku_status"("p_sku" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "username" "text" NOT NULL,
    "display_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_users" OWNER TO "postgres";


COMMENT ON TABLE "public"."app_users" IS 'Usuarios lógicos de la app (no confundir con auth.users).';



COMMENT ON COLUMN "public"."app_users"."id" IS 'UUID primario (recomendado en Supabase).';



CREATE OR REPLACE FUNCTION "public"."ensure_system_user"() RETURNS "public"."app_users"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  rec public.app_users;
BEGIN
  -- intenta cogerlo
  SELECT * INTO rec
  FROM public.app_users
  WHERE username = 'system'
  LIMIT 1;

  IF rec.id IS NOT NULL THEN
    RETURN rec;
  END IF;

  -- crearlo si no existe
  INSERT INTO public.app_users (username, display_name)
  VALUES ('system', 'Sistema')
  ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
  RETURNING * INTO rec;

  RETURN rec;
END$$;


ALTER FUNCTION "public"."ensure_system_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."image_status_es"("p" "public"."image_status") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  select case $1
    when 'needs_correction'::public.image_status then 'necesita correcciones'
    when 'finished'::public.image_status         then 'finalizada'
    else coalesce($1::text,'?')
  end
$_$;


ALTER FUNCTION "public"."image_status_es"("p" "public"."image_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."init_user_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
declare
  base_username text;
  display       text;
begin
  -- Derivar username/display
  base_username := coalesce(NEW.raw_user_meta_data->>'username',
                            split_part(NEW.email, '@', 1));

  display := coalesce(NEW.raw_user_meta_data->>'display_name',
                      NEW.raw_user_meta_data->>'full_name',
                      base_username);

  -- Completar metadata EN LA FILA NUEVA
  NEW.raw_user_meta_data := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  NEW.raw_user_meta_data := jsonb_set(NEW.raw_user_meta_data, '{display_name}', to_jsonb(display), true);
  NEW.raw_user_meta_data := jsonb_set(NEW.raw_user_meta_data, '{full_name}',    to_jsonb(display), true);

  -- Upsert en perfil (tabla pública)
  insert into public.app_users (id, username, display_name)
  values (NEW.id, base_username, display)
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."init_user_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_in_trigger"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$ select pg_trigger_depth() > 0 $$;


ALTER FUNCTION "public"."is_in_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_system_user"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.app_users u
    where u.id = p_user_id
      and lower(u.username) = 'system'
  )
$$;


ALTER FUNCTION "public"."is_system_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_message_read"("p_message_id" bigint, "p_user_id" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into public.review_message_receipts (message_id, user_id, delivered_at, read_at)
  values (p_message_id, p_user_id, now(), now())
  on conflict (message_id, user_id) do update
    set read_at = coalesce(review_message_receipts.read_at, excluded.read_at);
end
$$;


ALTER FUNCTION "public"."mark_message_read"("p_message_id" bigint, "p_user_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_thread_read"("p_thread_id" bigint, "p_user_id" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into public.review_message_receipts (message_id, user_id, delivered_at, read_at)
  select m.id, p_user_id, now(), now()
  from public.review_messages m
  where m.thread_id = p_thread_id
    and (m.created_by is null or m.created_by <> p_user_id) -- no marques los que escribiste tú
  on conflict (message_id, user_id) do update
    set read_at = coalesce(review_message_receipts.read_at, excluded.read_at);
end
$$;


ALTER FUNCTION "public"."mark_thread_read"("p_thread_id" bigint, "p_user_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reopen_sku"("p_sku" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE current sku_status;
BEGIN
  SELECT status INTO current FROM public.review_skus_status WHERE sku = p_sku;
  IF current IS DISTINCT FROM 'validated' THEN
    RAISE EXCEPTION 'Solo puede reabrirse un SKU validado';
  END IF;

  UPDATE public.review_skus_status
  SET status = 'reopened', updated_at = now()
  WHERE sku = p_sku;
END
$$;


ALTER FUNCTION "public"."reopen_sku"("p_sku" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_sku_to_auto"("p_sku" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  PERFORM public.compute_sku_status(p_sku);
END
$$;


ALTER FUNCTION "public"."reset_sku_to_auto"("p_sku" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_image_reopened"("p_sku" "text", "p_image" "text", "p_on" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  if p_on then
    insert into public.review_images_status (sku, image_name, status, updated_at)
    values (p_sku, p_image, 'reopened', now())
    on conflict (sku, image_name) do update
    set status = 'reopened', updated_at = now();
  else
    -- recalcula automático y guarda (volverá a pending_review / needs_correction / finished)
    perform public.compute_image_status(p_sku, p_image);
  end if;
end
$$;


ALTER FUNCTION "public"."set_image_reopened"("p_sku" "text", "p_image" "text", "p_on" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_message_author_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.is_system then
    new.created_by_username := 'system';
    new.created_by_display_name := 'system';
  else
    select u.username, u.display_name
    into new.created_by_username, new.created_by_display_name
    from public.app_users u
    where u.id = new.created_by;
  end if;

  return new;
end $$;


ALTER FUNCTION "public"."set_message_author_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_sku_reopened"("p_sku" "text", "p_on" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  if p_on then
    insert into public.review_skus_status (sku, status, updated_at)
    values (p_sku, 'reopened', now())
    on conflict (sku) do update
    set status = 'reopened', updated_at = now();
  else
    perform public.compute_sku_status(p_sku);
  end if;
end
$$;


ALTER FUNCTION "public"."set_sku_reopened"("p_sku" "text", "p_on" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_sku_validated"("p_sku" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE needs int;
BEGIN
  SELECT images_needing_fix INTO needs FROM public.review_skus_status WHERE sku = p_sku;
  IF COALESCE(needs,0) > 0 THEN
    RAISE EXCEPTION 'No se puede validar: hay imágenes que necesitan corrección';
  END IF;

  INSERT INTO public.review_skus_status (sku, status, updated_at)
  VALUES (p_sku, 'validated', now())
  ON CONFLICT (sku) DO UPDATE
    SET status = 'validated', updated_at = now();
END
$$;


ALTER FUNCTION "public"."set_sku_validated"("p_sku" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end $$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sku_status_es"("p" "public"."sku_status") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  select case $1
    when 'pending_validation'::public.sku_status then 'pendiente de validación'
    when 'needs_correction'::public.sku_status   then 'necesita correcciones'
    when 'validated'::public.sku_status          then 'validada'
    when 'reopened'::public.sku_status           then 'reabierta'
    else coalesce($1::text,'?')
  end
$_$;


ALTER FUNCTION "public"."sku_status_es"("p" "public"."sku_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_user_to_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  base_username text;
  display       text;
begin
  -- 1) Derivar username/display
  base_username := coalesce(NEW.raw_user_meta_data->>'username',
                            split_part(NEW.email, '@', 1));

  display := coalesce(NEW.raw_user_meta_data->>'display_name',
                      NEW.raw_user_meta_data->>'full_name',
                      base_username);

  -- 2) Completar metadata en la FILA NUEVA (solo funciona en BEFORE)
  NEW.raw_user_meta_data := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  NEW.raw_user_meta_data := jsonb_set(NEW.raw_user_meta_data, '{display_name}', to_jsonb(display), true);
  NEW.raw_user_meta_data := jsonb_set(NEW.raw_user_meta_data, '{full_name}',    to_jsonb(display), true);

  -- 3) Upsert en perfil público
  insert into public.app_users (id, username, display_name)
  values (NEW.id, base_username, display)
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."sync_user_to_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."thread_status_es"("p" "public"."thread_status") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  select case $1
    when 'pending'::public.thread_status   then 'pendiente'
    when 'corrected'::public.thread_status then 'corregido'
    when 'reopened'::public.thread_status  then 'reabierto'
    when 'deleted'::public.thread_status   then 'eliminado'
    else coalesce($1::text,'?')
  end
$_$;


ALTER FUNCTION "public"."thread_status_es"("p" "public"."thread_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_notifications_on_image_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$declare
  v_actor           uuid := auth.uid();   -- quien ejecuta el UPDATE
  v_actor_username  text;
  v_title           text;
  v_text            text;
begin
  -- Solo notificar si hay cambio real de estado
  if TG_OP = 'UPDATE' and (old.status is distinct from new.status) then
    -- Excluir si no hay actor (p.ej. procesos sin token) o si es 'system'
    if v_actor is null or public.is_system_user(v_actor) then
      return new;
    end if;

    select u.username
      into v_actor_username
    from public.app_users u
    where u.id = v_actor;

    -- ===== TÍTULO y TEXTO =====
    -- TITLE: (imagename) cambió de estado a (estado nuevo)
    v_title := 'Imagen cambió de estado a '
               || public.image_status_es(new.status);

    -- TEXTO: @(user) cambió el estado de la imagen de (estado viejo) a (estado nuevo)
    v_text  := '@' || coalesce(nullif(v_actor_username,''),'system')
               || ' cambió el estado de '
               || coalesce(new.image_name, '(sin nombre)') 
               || ' de '               
               || public.image_status_es(old.status)
               || ' a '
               || public.image_status_es(new.status);

    -- Notificar a todos excepto actor y 'system'
    insert into public.notifications (user_id, author_id, type, thread_id, sku, image_name, title, message)
    select u.id, v_actor, 'image_status_changed', null, new.sku, new.image_name, v_title, v_text
    from public.app_users u
    where u.id <> v_actor
      and lower(u.username) <> 'system';
  end if;

  return new;
end$$;


ALTER FUNCTION "public"."trg_notifications_on_image_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_notifications_on_new_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$declare
  v_author           uuid := new.created_by; -- app_users.id == auth.users.id
  v_author_username  text;
  v_msg_title        text;
  v_sku              text;
  v_image_name       text;
  v_excerpt_raw      text;
  v_excerpt          text;
begin
  if coalesce(new.is_system, false) or public.is_system_user(v_author) then
    return new;
  end if;

  select u.username into v_author_username
  from public.app_users u
  where u.id = v_author;

  select t.sku, t.image_name
  into v_sku, v_image_name
  from public.review_threads t
  where t.id = new.thread_id;

  v_msg_title := coalesce(
    'Nuevo mensaje en hilo #' || new.thread_id ||
    case when v_author_username is not null then ' de @' || v_author_username else '' end,
    'Nuevo mensaje'
  );

  v_excerpt_raw := coalesce(new.text, '');
  v_excerpt_raw := trim(regexp_replace(v_excerpt_raw, '\s+', ' ', 'g'));
  if length(v_excerpt_raw) > 75 then
    v_excerpt := substr(v_excerpt_raw, 1, 95) || '...';
  else
    v_excerpt := v_excerpt_raw;
  end if;

  insert into public.notifications (
    user_id, author_id, author_username,
    type, thread_id, message_id,
    sku, image_name,
    message, excerpt
  )
  select u.id, v_author, v_author_username,
         'new_message', new.thread_id, new.id,
         v_sku, v_image_name,
         v_msg_title, v_excerpt
  from public.app_users u
  where u.id <> v_author
    and lower(u.username) <> 'system'
  on conflict do nothing;

  -- insert into public.review_message_receipts (message_id, user_id, delivered_at)
  -- select new.id, u.id, now()
  -- from public.app_users u
  -- where u.id <> v_author
  --   and lower(u.username) <> 'system'
  -- on conflict (message_id, user_id)
  -- do update set delivered_at = coalesce(public.review_message_receipts.delivered_at, excluded.delivered_at);

  return new;
end$$;


ALTER FUNCTION "public"."trg_notifications_on_new_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_notifications_on_new_thread"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_author           uuid := new.created_by; -- app_users.id == auth.users.id
  v_author_username  text;
  v_msg              text;
begin
  -- excluir 'system'
  if public.is_system_user(v_author) then
    return new;
  end if;

  select u.username into v_author_username
  from public.app_users u
  where u.id = v_author;

  v_msg := coalesce(
    'Nuevo hilo en SKU ' || coalesce(new.sku, '') ||
    case when new.image_name is not null then ' ('|| new.image_name ||')' else '' end ||
    case when v_author_username is not null then ' por @' || v_author_username else '' end,
    'Nuevo hilo'
  );

  -- Notificar a todos los usuarios de la app excepto autor y 'system'
  insert into public.notifications (user_id, author_id, type, thread_id, sku, image_name, message)
  select u.id, v_author, 'new_thread', new.id, new.sku, new.image_name, v_msg
  from public.app_users u
  where u.id <> v_author
    and lower(u.username) <> 'system'
  on conflict do nothing; -- por si ya existiera

  return new;
end
$$;


ALTER FUNCTION "public"."trg_notifications_on_new_thread"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_notifications_on_sku_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$declare
  v_actor           uuid := auth.uid();
  v_actor_username  text;
  v_title           text;
  v_text            text;
  v_primary_image   text;
begin
  -- Solo notificar si hay cambio real de estado
  if TG_OP = 'UPDATE' and (OLD.status is distinct from NEW.status) then
    -- Excluir si no hay actor o si es 'system'
    if v_actor is null or public.is_system_user(v_actor) then
      return NEW;
    end if;

    select u.username
      into v_actor_username
    from public.app_users u
    where u.id = v_actor;

    -- Imagen principal del SKU (ajusta el ORDER BY si tienes columna de orden)
    select ris.image_name
      into v_primary_image
    from public.review_images_status ris
    where ris.sku = NEW.sku
    order by ris.image_name asc
    limit 1;

    -- Construir TÍTULO y TEXTO con estados en español
    v_title := 'SKU ' || coalesce(NEW.sku,'?') ||
               ' cambió a ' || public.sku_status_es(NEW.status);

    v_text  := '@' || coalesce(nullif(v_actor_username,''),'system') ||
               ' cambió el estado del SKU ' || coalesce(NEW.sku,'?') ||
               ' de ' || public.sku_status_es(OLD.status) ||
               ' a ' || public.sku_status_es(NEW.status);

    -- Notificar a todos excepto actor y 'system'
    insert into public.notifications
      (user_id, author_id, type, thread_id, sku, image_name, title, message)
    select u.id, v_actor, 'sku_status_changed', null, NEW.sku, v_primary_image, v_title, v_text
    from public.app_users u
    where u.id <> v_actor
      and lower(u.username) <> 'system';
  end if;

  return NEW;
end$$;


ALTER FUNCTION "public"."trg_notifications_on_sku_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_notifications_on_thread_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$declare
  v_actor           uuid := auth.uid(); -- actor real (token)
  v_actor_username  text;
  v_title           text;
  v_text            text;
begin
  -- Disparar solo si cambia status
  if (old.status is not distinct from new.status) then
    return new;
  end if;

  -- Si no hay actor (token nulo) o es 'system', no notificar
  if v_actor is null or public.is_system_user(v_actor) then
    return new;
  end if;

  select u.username
    into v_actor_username
  from public.app_users u
  where u.id = v_actor;

  -- TÍTULO: Hilo (id) cambió de estado a (estado nuevo)
  v_title := 'Hilo #' || new.id || ' cambió de estado a ' || public.thread_status_es(new.status);

  -- TEXTO: @user cambió el estado del hilo (id) de (estado antiguo) a (estado nuevo)
  v_text  := '@' || coalesce(nullif(v_actor_username,''),'system')
            || ' cambió el estado del hilo #' || new.id
            || ' de ' || public.thread_status_es(old.status)
            || ' a ' || public.thread_status_es(new.status);

  insert into public.notifications
    (user_id, author_id, type, thread_id, sku, image_name, title, message)
  select u.id, v_actor, 'thread_status_changed', new.id, new.sku, new.image_name, v_title, v_text
  from public.app_users u
  where u.id <> v_actor
    and lower(u.username) <> 'system';

  return new;
end$$;


ALTER FUNCTION "public"."trg_notifications_on_thread_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_threads_recompute_image"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.compute_image_status(OLD.sku, OLD.image_name);
  ELSE
    PERFORM public.compute_image_status(NEW.sku, NEW.image_name);
    IF TG_OP = 'UPDATE' AND (NEW.sku <> OLD.sku OR NEW.image_name <> OLD.image_name) THEN
      PERFORM public.compute_image_status(OLD.sku, OLD.image_name);
    END IF;
  END IF;
  RETURN NULL;
END
$$;


ALTER FUNCTION "public"."trg_threads_recompute_image"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unread_by_sku"("p_user_id" "uuid", "p_skus" "text"[]) RETURNS TABLE("sku" "text", "unread_count" integer)
    LANGUAGE "sql" STABLE
    AS $$
  select
    t.sku,
    count(*) filter (
      where not exists (
        select 1
        from public.review_message_receipts r
        where r.message_id = m.id
          and r.user_id    = p_user_id
          and r.read_at   is not null
      )
    ) as unread_count
  from public.review_threads   t
  join public.review_messages  m on m.thread_id = t.id
  where t.sku = any (p_skus)
    and t.status <> 'deleted'
    -- excluir mensajes del propio usuario
    and m.created_by <> p_user_id
    -- excluir mensajes del usuario 'system'
    and not public.is_system_user(m.created_by)
  group by t.sku
$$;


ALTER FUNCTION "public"."unread_by_sku"("p_user_id" "uuid", "p_skus" "text"[]) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "author_id" "uuid",
    "type" "text" NOT NULL,
    "message" "text" NOT NULL,
    "sku" "text",
    "image_name" "text",
    "thread_id" bigint,
    "viewed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "message_id" bigint,
    "excerpt" "text",
    "author_username" "text",
    "title" "text"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."notifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."notifications_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."notifications_id_seq" OWNED BY "public"."notifications"."id";



CREATE TABLE IF NOT EXISTS "public"."review_images_status" (
    "sku" "text" NOT NULL,
    "image_name" "text" NOT NULL,
    "status" "public"."image_status" DEFAULT 'finished'::"public"."image_status" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."review_images_status" REPLICA IDENTITY FULL;


ALTER TABLE "public"."review_images_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_message_receipts" (
    "message_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "delivered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."review_message_receipts" REPLICA IDENTITY FULL;


ALTER TABLE "public"."review_message_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_messages" (
    "id" bigint NOT NULL,
    "thread_id" bigint NOT NULL,
    "text" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by_username" "text",
    "created_by_display_name" "text",
    "is_system" boolean DEFAULT false NOT NULL,
    "client_nonce" "text"
);


ALTER TABLE "public"."review_messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."review_messages"."client_nonce" IS 'Nonce de cliente para reconciliar mensajes optimistas y deduplicar en realtime.';



CREATE SEQUENCE IF NOT EXISTS "public"."review_messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."review_messages_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."review_messages_id_seq" OWNED BY "public"."review_messages"."id";



CREATE TABLE IF NOT EXISTS "public"."review_skus_status" (
    "sku" "text" NOT NULL,
    "status" "public"."sku_status" DEFAULT 'pending_validation'::"public"."sku_status" NOT NULL,
    "images_total" integer DEFAULT 0 NOT NULL,
    "images_needing_fix" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."review_skus_status" REPLICA IDENTITY FULL;


ALTER TABLE "public"."review_skus_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_threads" (
    "id" bigint NOT NULL,
    "sku" "text" NOT NULL,
    "image_name" "text" NOT NULL,
    "x" double precision NOT NULL,
    "y" double precision NOT NULL,
    "status" "public"."thread_status" DEFAULT 'pending'::"public"."thread_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "drawing_json" "jsonb",
    CONSTRAINT "review_threads_x_check" CHECK ((("x" >= (0)::double precision) AND ("x" <= (100)::double precision))),
    CONSTRAINT "review_threads_y_check" CHECK ((("y" >= (0)::double precision) AND ("y" <= (100)::double precision)))
);


ALTER TABLE "public"."review_threads" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."review_threads_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."review_threads_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."review_threads_id_seq" OWNED BY "public"."review_threads"."id";



ALTER TABLE ONLY "public"."notifications" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."notifications_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."review_messages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."review_messages_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."review_threads" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."review_threads_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_images_status"
    ADD CONSTRAINT "review_images_status_pkey" PRIMARY KEY ("sku", "image_name");



ALTER TABLE ONLY "public"."review_message_receipts"
    ADD CONSTRAINT "review_message_receipts_pkey" PRIMARY KEY ("message_id", "user_id");



ALTER TABLE ONLY "public"."review_messages"
    ADD CONSTRAINT "review_messages_client_nonce_uk" UNIQUE ("client_nonce");



ALTER TABLE ONLY "public"."review_messages"
    ADD CONSTRAINT "review_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_skus_status"
    ADD CONSTRAINT "review_skus_status_pkey" PRIMARY KEY ("sku");



ALTER TABLE ONLY "public"."review_threads"
    ADD CONSTRAINT "review_threads_pkey" PRIMARY KEY ("id");



CREATE INDEX "app_users_username_idx" ON "public"."app_users" USING "btree" ("username");



CREATE INDEX "idx_msg_receipts_msg" ON "public"."review_message_receipts" USING "btree" ("message_id");



CREATE INDEX "idx_notifications_user_created_at" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_notifications_user_id_created_at" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_notifications_viewed" ON "public"."notifications" USING "btree" ("user_id", "viewed");



CREATE INDEX "idx_receipts_message" ON "public"."review_message_receipts" USING "btree" ("message_id");



CREATE INDEX "idx_receipts_read_at" ON "public"."review_message_receipts" USING "btree" ("read_at") WHERE ("read_at" IS NOT NULL);



CREATE INDEX "idx_receipts_user" ON "public"."review_message_receipts" USING "btree" ("user_id");



CREATE INDEX "idx_review_messages_thread" ON "public"."review_messages" USING "btree" ("thread_id");



CREATE INDEX "idx_review_threads_sku_image" ON "public"."review_threads" USING "btree" ("sku", "image_name");



CREATE INDEX "idx_review_threads_sku_img" ON "public"."review_threads" USING "btree" ("sku", "image_name");



CREATE INDEX "idx_review_threads_status" ON "public"."review_threads" USING "btree" ("status");



CREATE INDEX "notifications_user_id_idx" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "notifications_viewed_idx" ON "public"."notifications" USING "btree" ("user_id", "viewed", "created_at" DESC);



CREATE UNIQUE INDEX "review_messages_client_nonce_key" ON "public"."review_messages" USING "btree" ("client_nonce") WHERE ("client_nonce" IS NOT NULL);



CREATE UNIQUE INDEX "review_messages_client_nonce_uq" ON "public"."review_messages" USING "btree" ("client_nonce") WHERE ("client_nonce" IS NOT NULL);



CREATE UNIQUE INDEX "uq_notifications_msg_per_user" ON "public"."notifications" USING "btree" ("user_id", "message_id", "type") WHERE ("type" = 'new_message'::"text");



CREATE UNIQUE INDEX "uq_notifications_new_thread_per_user" ON "public"."notifications" USING "btree" ("user_id", "thread_id", "type") WHERE ("type" = 'new_thread'::"text");



CREATE OR REPLACE TRIGGER "notifications_on_image_status" AFTER UPDATE OF "status" ON "public"."review_images_status" FOR EACH ROW EXECUTE FUNCTION "public"."trg_notifications_on_image_status"();



CREATE OR REPLACE TRIGGER "notifications_on_new_message" AFTER INSERT ON "public"."review_messages" FOR EACH ROW EXECUTE FUNCTION "public"."trg_notifications_on_new_message"();



CREATE OR REPLACE TRIGGER "notifications_on_new_thread" AFTER INSERT ON "public"."review_threads" FOR EACH ROW EXECUTE FUNCTION "public"."trg_notifications_on_new_thread"();



CREATE OR REPLACE TRIGGER "notifications_on_sku_status" AFTER UPDATE OF "status" ON "public"."review_skus_status" FOR EACH ROW EXECUTE FUNCTION "public"."trg_notifications_on_sku_status"();



CREATE OR REPLACE TRIGGER "notifications_on_thread_status" AFTER UPDATE OF "status" ON "public"."review_threads" FOR EACH ROW EXECUTE FUNCTION "public"."trg_notifications_on_thread_status"();



CREATE OR REPLACE TRIGGER "trg_msgs_set_updated_at" BEFORE UPDATE ON "public"."review_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_review_messages_author_bi" BEFORE INSERT ON "public"."review_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_message_author_fields"();



CREATE OR REPLACE TRIGGER "trg_review_messages_author_bu" BEFORE UPDATE OF "created_by", "is_system" ON "public"."review_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_message_author_fields"();



CREATE OR REPLACE TRIGGER "trg_threads_recompute_image" AFTER INSERT OR DELETE OR UPDATE ON "public"."review_threads" FOR EACH ROW EXECUTE FUNCTION "public"."trg_threads_recompute_image"();



CREATE OR REPLACE TRIGGER "trg_threads_set_updated_at" BEFORE UPDATE ON "public"."review_threads" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."review_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_message_receipts"
    ADD CONSTRAINT "review_message_receipts_message_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."review_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_message_receipts"
    ADD CONSTRAINT "review_message_receipts_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_messages"
    ADD CONSTRAINT "review_messages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."review_messages"
    ADD CONSTRAINT "review_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."review_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_threads"
    ADD CONSTRAINT "review_threads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE SET NULL;



ALTER TABLE "public"."app_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auth admin can update" ON "public"."app_users" FOR UPDATE TO "supabase_auth_admin" USING (true) WITH CHECK (true);



CREATE POLICY "auth admin can upsert" ON "public"."app_users" FOR INSERT TO "supabase_auth_admin" WITH CHECK (true);



CREATE POLICY "insert own receipt" ON "public"."review_message_receipts" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_insert_any" ON "public"."notifications" FOR INSERT WITH CHECK ("public"."is_in_trigger"());



CREATE POLICY "notifications_insert_trigger_only" ON "public"."notifications" FOR INSERT WITH CHECK ("public"."is_in_trigger"());



CREATE POLICY "notifications_no_delete" ON "public"."notifications" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "notifications_select_own" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_select_self" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_update_self" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_update_viewed_own" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "read app_users" ON "public"."app_users" FOR SELECT USING (true);



CREATE POLICY "select own receipts" ON "public"."review_message_receipts" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "sender can see receipts" ON "public"."review_message_receipts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."review_messages" "m"
  WHERE (("m"."id" = "review_message_receipts"."message_id") AND ("m"."created_by" = "auth"."uid"())))));



CREATE POLICY "update own receipt" ON "public"."review_message_receipts" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."_ensure_delivered_receipt"("p_message_id" integer, "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_ensure_delivered_receipt"("p_message_id" integer, "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ensure_delivered_receipt"("p_message_id" integer, "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_notify"("p_user_id" "uuid", "p_author_id" "uuid", "p_type" "public"."notification_type", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."_notify"("p_user_id" "uuid", "p_author_id" "uuid", "p_type" "public"."notification_type", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_notify"("p_user_id" "uuid", "p_author_id" "uuid", "p_type" "public"."notification_type", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_uid"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_uid"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_uid"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_image_status"("p_sku" "text", "p_image" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_image_status"("p_sku" "text", "p_image" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_image_status"("p_sku" "text", "p_image" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_sku_status"("p_sku" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_sku_status"("p_sku" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_sku_status"("p_sku" "text") TO "service_role";



GRANT ALL ON TABLE "public"."app_users" TO "anon";
GRANT ALL ON TABLE "public"."app_users" TO "authenticated";
GRANT ALL ON TABLE "public"."app_users" TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_system_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_system_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_system_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."image_status_es"("p" "public"."image_status") TO "anon";
GRANT ALL ON FUNCTION "public"."image_status_es"("p" "public"."image_status") TO "authenticated";
GRANT ALL ON FUNCTION "public"."image_status_es"("p" "public"."image_status") TO "service_role";



GRANT ALL ON FUNCTION "public"."init_user_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."init_user_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."init_user_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_in_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_in_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_in_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_system_user"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_system_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_system_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_message_read"("p_message_id" bigint, "p_user_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_message_read"("p_message_id" bigint, "p_user_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_message_read"("p_message_id" bigint, "p_user_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_thread_read"("p_thread_id" bigint, "p_user_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_thread_read"("p_thread_id" bigint, "p_user_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_thread_read"("p_thread_id" bigint, "p_user_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reopen_sku"("p_sku" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reopen_sku"("p_sku" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reopen_sku"("p_sku" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reset_sku_to_auto"("p_sku" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reset_sku_to_auto"("p_sku" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_sku_to_auto"("p_sku" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_image_reopened"("p_sku" "text", "p_image" "text", "p_on" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_image_reopened"("p_sku" "text", "p_image" "text", "p_on" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_image_reopened"("p_sku" "text", "p_image" "text", "p_on" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_message_author_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_message_author_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_message_author_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_sku_reopened"("p_sku" "text", "p_on" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_sku_reopened"("p_sku" "text", "p_on" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_sku_reopened"("p_sku" "text", "p_on" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_sku_validated"("p_sku" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_sku_validated"("p_sku" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_sku_validated"("p_sku" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sku_status_es"("p" "public"."sku_status") TO "anon";
GRANT ALL ON FUNCTION "public"."sku_status_es"("p" "public"."sku_status") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sku_status_es"("p" "public"."sku_status") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_user_to_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_user_to_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_user_to_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."thread_status_es"("p" "public"."thread_status") TO "anon";
GRANT ALL ON FUNCTION "public"."thread_status_es"("p" "public"."thread_status") TO "authenticated";
GRANT ALL ON FUNCTION "public"."thread_status_es"("p" "public"."thread_status") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_notifications_on_image_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_notifications_on_image_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_notifications_on_image_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_notifications_on_new_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_notifications_on_new_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_notifications_on_new_message"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_notifications_on_new_thread"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_notifications_on_new_thread"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_notifications_on_new_thread"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_notifications_on_sku_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_notifications_on_sku_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_notifications_on_sku_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_notifications_on_thread_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_notifications_on_thread_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_notifications_on_thread_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_threads_recompute_image"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_threads_recompute_image"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_threads_recompute_image"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unread_by_sku"("p_user_id" "uuid", "p_skus" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."unread_by_sku"("p_user_id" "uuid", "p_skus" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."unread_by_sku"("p_user_id" "uuid", "p_skus" "text"[]) TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."review_images_status" TO "anon";
GRANT ALL ON TABLE "public"."review_images_status" TO "authenticated";
GRANT ALL ON TABLE "public"."review_images_status" TO "service_role";



GRANT ALL ON TABLE "public"."review_message_receipts" TO "anon";
GRANT ALL ON TABLE "public"."review_message_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."review_message_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."review_messages" TO "anon";
GRANT ALL ON TABLE "public"."review_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."review_messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."review_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."review_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."review_messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."review_skus_status" TO "anon";
GRANT ALL ON TABLE "public"."review_skus_status" TO "authenticated";
GRANT ALL ON TABLE "public"."review_skus_status" TO "service_role";



GRANT ALL ON TABLE "public"."review_threads" TO "anon";
GRANT ALL ON TABLE "public"."review_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."review_threads" TO "service_role";



GRANT ALL ON SEQUENCE "public"."review_threads_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."review_threads_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."review_threads_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







RESET ALL;
