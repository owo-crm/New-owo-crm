-- Исправления ревью фазы 2 (0046–0048 не меняются):
--  1) template_files (PDF-вложения шаблонов чата, 0043) — в общем реестре files, как остальные bytea-источники;
--  2) аудит изменений фото объекта (position, is_cover, is_public, alt_text).

-- ───────────────────────── 1. template_files в реестре ─────────────────────────
alter table public.files drop constraint files_source_table_check;
alter table public.files add constraint files_source_table_check
  check (source_table in ('lead_attachments','document_files','organization_templates','template_files'));

-- Та же функция синхронизации, что в 0047, + ветка template_files (id файла = id строки).
create or replace function public.files_sync_legacy() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_key text; v_type text; v_size bigint; v_name text; v_by uuid;
begin
  if tg_op = 'DELETE' then
    update public.files set deleted_at = now()
     where source_table = tg_table_name
       and source_id = case when tg_table_name = 'organization_templates' then old.organization_id else old.id end;
    return old;
  end if;
  if tg_table_name = 'organization_templates' then
    v_id := new.organization_id; v_type := 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    v_size := new.size_bytes; v_by := new.uploaded_by;
  elsif tg_table_name = 'document_files' then
    v_id := new.id; v_type := case new.format when 'pdf' then 'application/pdf'
      else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end;
    v_size := octet_length(new.content); v_by := null;
  elsif tg_table_name = 'template_files' then
    v_id := new.id; v_type := new.content_type; v_size := new.size_bytes; v_by := null;
  else
    v_id := new.id; v_type := new.content_type; v_size := new.size_bytes; v_by := new.uploaded_by;
  end if;
  v_key := 'pg:' || tg_table_name || ':' || v_id;
  v_name := new.filename;
  insert into public.files (id, organization_id, filename, content_type, size_bytes, sha256, storage, storage_key,
                            source_table, source_id, created_by)
  values (case when tg_table_name = 'organization_templates' then gen_random_uuid() else v_id end,
          new.organization_id, v_name, v_type, v_size, encode(sha256(new.content), 'hex'), 'postgres', v_key,
          tg_table_name, v_id, v_by)
  on conflict (source_table, source_id) do update
    set filename = excluded.filename, content_type = excluded.content_type, size_bytes = excluded.size_bytes,
        sha256 = excluded.sha256, storage = 'postgres', storage_key = excluded.storage_key,
        migrated_at = null, deleted_at = null;
  return new;
end;
$$;
revoke all on function public.files_sync_legacy() from public, anon, authenticated;

create trigger template_files_files after insert or delete on public.template_files
  for each row execute function public.files_sync_legacy();

insert into public.files (id, organization_id, filename, content_type, size_bytes, sha256, storage, storage_key,
                          source_table, source_id, created_at)
select t.id, t.organization_id, t.filename, t.content_type, t.size_bytes, encode(sha256(t.content), 'hex'),
       'postgres', 'pg:template_files:' || t.id, 'template_files', t.id, t.created_at
  from public.template_files t
on conflict (source_table, source_id) do nothing;

-- ───────────────────────── 2. Аудит изменений фото ─────────────────────────
-- INSERT/DELETE — как раньше; UPDATE — только изменившиеся поля (before/after).
create or replace function public.property_media_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_before jsonb := '{}'; v_after jsonb := '{}';
begin
  if tg_op = 'UPDATE' then
    if new.position is distinct from old.position then
      v_before := v_before || jsonb_build_object('position', old.position);
      v_after := v_after || jsonb_build_object('position', new.position);
    end if;
    if new.is_cover is distinct from old.is_cover then
      v_before := v_before || jsonb_build_object('is_cover', old.is_cover);
      v_after := v_after || jsonb_build_object('is_cover', new.is_cover);
    end if;
    if new.is_public is distinct from old.is_public then
      v_before := v_before || jsonb_build_object('is_public', old.is_public);
      v_after := v_after || jsonb_build_object('is_public', new.is_public);
    end if;
    if new.alt_text is distinct from old.alt_text then
      v_before := v_before || jsonb_build_object('alt_text', old.alt_text);
      v_after := v_after || jsonb_build_object('alt_text', new.alt_text);
    end if;
    if v_after = '{}'::jsonb then return null; end if;
    insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, before, after)
    values (new.organization_id, auth.uid(), 'property.media_update', 'properties', new.property_id::text,
            v_before || jsonb_build_object('media_id', new.id), v_after || jsonb_build_object('media_id', new.id));
    return null;
  end if;
  if tg_op = 'DELETE' then
    insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, after)
    values (old.organization_id, auth.uid(), 'property.media_remove', 'properties', old.property_id::text,
            jsonb_build_object('media_id', old.id));
    return null;
  end if;
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, after)
  values (new.organization_id, auth.uid(), 'property.media_add', 'properties', new.property_id::text,
          jsonb_build_object('media_id', new.id));
  return null;
end;
$$;
revoke all on function public.property_media_audit() from public, anon, authenticated;

drop trigger property_media_audit on public.property_media;
create trigger property_media_audit after insert or update or delete on public.property_media
  for each row execute function public.property_media_audit();
