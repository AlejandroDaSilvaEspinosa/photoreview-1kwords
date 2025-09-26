
--######trg_notifications_on_thread_status

declare
  v_actor           uuid := auth.uid(); -- actor real (token)
  v_actor_username  text;
  v_msg             text;
begin
  -- Disparar solo si cambia status
  if (old.status is not distinct from new.status) then
    return new;
  end if;

  -- Si no hay actor (token nulo) o es 'system', no notificar
  if v_actor is null or public.is_system_user(v_actor) then
    return new;
  end if;

  select u.username into v_actor_username
  from public.app_users u
  where u.id = v_actor;

  v_msg := coalesce(
    'Hilo #'|| new.id || ' cambió de estado a "' || new.status || '" en SKU ' || coalesce(new.sku,'') ||
    case when new.image_name is not null then ' ('|| new.image_name ||')' else '' end ||
    case when v_actor_username is not null then ' por @' || v_actor_username else '' end,
    'Cambio de estado de hilo'
  );

  insert into public.notifications (user_id, author_id, type, thread_id, sku, image_name, message)
  select u.id, v_actor, 'thread_status_changed', new.id, new.sku, new.image_name, v_msg
  from public.app_users u
  where u.id <> v_actor
    and lower(u.username) <> 'system';

  return new;
end

--####trg_notifications_on_sku_status
declare
  v_actor           uuid := auth.uid();   -- quien ejecuta el UPDATE
  v_actor_username  text;
  v_msg             text;
begin
  -- Solo notificar si hay cambio real de estado
  if TG_OP = 'UPDATE' and (old.status is distinct from new.status) then
    -- Excluir si no hay actor o si es 'system'
    if v_actor is null or public.is_system_user(v_actor) then
      return new;
    end if;

    select u.username into v_actor_username
    from public.app_users u
    where u.id = v_actor;

    v_msg := coalesce(
      'SKU ' || coalesce(new.sku,'?') ||
      ' cambió de "' || coalesce(old.status::text,'?') || '" a "' || coalesce(new.status::text,'?') || '"' ||
      case when v_actor_username is not null then ' por @' || v_actor_username else '' end,
      'Cambio de estado de SKU'
    );

    -- Notificar a todos excepto actor y 'system'
    insert into public.notifications (user_id, author_id, type, thread_id, sku, image_name, message)
    select u.id, v_actor, 'sku_status_changed', null, new.sku, null, v_msg
    from public.app_users u
    where u.id <> v_actor
      and lower(u.username) <> 'system';
  end if;

  return new;
end

--###### trg_notifications_on_new_thread
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

--######trg_notifications_on_new_message

declare
  v_author           uuid := new.created_by; -- app_users.id == auth.users.id
  v_author_username  text;
  v_msg              text;
begin
  -- No notificar si es mensaje del sistema o autor 'system'
  if coalesce(new.is_system, false) or public.is_system_user(v_author) then
    return new;
  end if;

  select u.username into v_author_username
  from public.app_users u
  where u.id = v_author;

  v_msg := coalesce(
    'Nuevo mensaje en hilo #' || new.thread_id ||
    case when v_author_username is not null then ' de @' || v_author_username else '' end,
    'Nuevo mensaje'
  );

  -- Notificaciones para todos excepto autor y 'system'
  insert into public.notifications (user_id, author_id, type, thread_id, message_id, message)
  select u.id, v_author, 'new_message', new.thread_id, new.id, v_msg
  from public.app_users u
  where u.id <> v_author
    and lower(u.username) <> 'system'
  on conflict do nothing;

  -- Marcar DELIVERED en receipts (idempotente)
  insert into public.review_message_receipts (message_id, user_id, delivered_at)
  select new.id, u.id, now()
  from public.app_users u
  where u.id <> v_author
    and lower(u.username) <> 'system'
  on conflict (message_id, user_id)
  do update set delivered_at = coalesce(public.review_message_receipts.delivered_at, excluded.delivered_at);

  return new;
end


--######## trg_notifications_on_image_status
declare
  v_actor           uuid := auth.uid();   -- quien ejecuta el UPDATE
  v_actor_username  text;
  v_msg             text;
begin
  -- Solo notificar si hay cambio real de estado
  if TG_OP = 'UPDATE' and (old.status is distinct from new.status) then
    -- Excluir si no hay actor (p.ej. procesos sin token) o si es 'system'
    if v_actor is null or public.is_system_user(v_actor) then
      return new;
    end if;

    select u.username into v_actor_username
    from public.app_users u
    where u.id = v_actor;

    v_msg := coalesce(
      'Imagen "'|| coalesce(new.image_name,'?') || '" en SKU ' || coalesce(new.sku,'?') ||
      '" cambió de "' || coalesce(old.status::text,'?') || '" a "' || coalesce(new.status::text,'?') || '"' ||
      case when v_actor_username is not null then ' por @' || v_actor_username else '' end,
      'Cambio de estado de imagen'
    );

    -- Notificar a todos excepto actor y 'system'
    insert into public.notifications (user_id, author_id, type, thread_id, sku, image_name, message)
    select u.id, v_actor, 'image_status_changed', null, new.sku, new.image_name, v_msg
    from public.app_users u
    where u.id <> v_actor
      and lower(u.username) <> 'system';
  end if;

  return new;
end
