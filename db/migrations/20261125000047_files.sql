-- M3 (часть «файлы», D-22) — общий реестр метаданных файлов. Номер по фактическому main.
-- Содержимое пока остаётся в bytea исходных таблиц (storage='postgres'); перенос в приватный
-- bucket — отдельный шаг M3.x (scripts/files-to-s3.ts), bytea не удаляется до M9.
-- Контакты, платежи, задачи и activities из M3 — отдельными миграциями (деньги и склейка
-- контактов требуют своих тестов идентичности и ручного отчёта, D-11/D-15).

create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 200),
  content_type text not null default 'application/octet-stream' check (char_length(content_type) <= 120),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage text not null check (storage in ('postgres','s3')),
  -- postgres: 'pg:<table>:<uuid>' (PostgresStorage); s3: ключ объекта в приватном bucket.
  storage_key text not null check (char_length(storage_key) <= 400),
  -- Откуда пришёл файл: строка старой таблицы (fallback на bytea) или null — новый файл (только s3).
  source_table text check (source_table in ('lead_attachments','document_files','organization_templates')),
  source_id uuid,
  purpose text not null default 'legacy' check (purpose in ('legacy','property_media')),
  created_by uuid,
  created_at timestamptz not null default now(),
  migrated_at timestamptz,
  deleted_at timestamptz,
  unique (organization_id, id),
  unique (source_table, source_id),
  check ((source_table is null) = (source_id is null)),
  check (storage = 's3' or source_table is not null)
);
create index files_org_idx on public.files (organization_id, created_at desc) where deleted_at is null;
create index files_storage_idx on public.files (storage) where deleted_at is null;

alter table public.files enable row level security;
create policy "members read" on public.files for select to authenticated using (public.is_member(organization_id));
revoke all on public.files from anon, authenticated;
grant select on public.files to authenticated;
-- Запись: триггеры старых таблиц и сервис файлов (security definer / service_role), не клиент напрямую.

-- ───────────────────────── Синхронизация со старыми таблицами ─────────────────────────
-- Id файла = id исходной строки (у шаблонов — новый id; источник адресуется organization_id).
create function public.files_sync_legacy() returns trigger
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
    -- Шаблон заменили: содержимое снова в БД, прежний объект в bucket устарел.
    set filename = excluded.filename, content_type = excluded.content_type, size_bytes = excluded.size_bytes,
        sha256 = excluded.sha256, storage = 'postgres', storage_key = excluded.storage_key,
        migrated_at = null, deleted_at = null;
  return new;
end;
$$;

create trigger lead_attachments_files after insert or delete on public.lead_attachments
  for each row execute function public.files_sync_legacy();
create trigger document_files_files after insert or delete on public.document_files
  for each row execute function public.files_sync_legacy();
create trigger organization_templates_files after insert or update of content or delete on public.organization_templates
  for each row execute function public.files_sync_legacy();

-- ───────────────────────── Перенос метаданных существующих файлов ─────────────────────────
insert into public.files (id, organization_id, filename, content_type, size_bytes, sha256, storage, storage_key,
                          source_table, source_id, created_by, created_at)
select a.id, a.organization_id, a.filename, a.content_type, a.size_bytes, encode(sha256(a.content), 'hex'),
       'postgres', 'pg:lead_attachments:' || a.id, 'lead_attachments', a.id, a.uploaded_by, a.created_at
  from public.lead_attachments a;

insert into public.files (id, organization_id, filename, content_type, size_bytes, sha256, storage, storage_key,
                          source_table, source_id, created_at)
select d.id, d.organization_id, d.filename,
       case d.format when 'pdf' then 'application/pdf'
         else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end,
       octet_length(d.content), encode(sha256(d.content), 'hex'),
       'postgres', 'pg:document_files:' || d.id, 'document_files', d.id, d.created_at
  from public.document_files d;

insert into public.files (organization_id, filename, content_type, size_bytes, sha256, storage, storage_key,
                          source_table, source_id, created_by, created_at)
select t.organization_id, t.filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       t.size_bytes, encode(sha256(t.content), 'hex'),
       'postgres', 'pg:organization_templates:' || t.organization_id, 'organization_templates', t.organization_id,
       t.uploaded_by, t.updated_at
  from public.organization_templates t;

-- ───────────────────────── Отметка переноса (только сервер, M3.x) ─────────────────────────
-- Вызывается скриптом переноса после put → head → сверки размера и sha256. Проверяет, что
-- объявленный размер и хеш совпадают с записью; bytea не трогает.
create function public.file_mark_s3(p_file uuid, p_key text, p_size bigint, p_sha256 text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or p_key !~ '^org/[0-9a-f-]{36}/[0-9a-f-]{36}$' then
    raise exception 'invalid key' using errcode = '22023';
  end if;
  update public.files set storage = 's3', storage_key = p_key, migrated_at = now()
   where id = p_file and storage = 'postgres' and deleted_at is null
     and size_bytes = p_size and sha256 = p_sha256
     and p_key = 'org/' || organization_id || '/' || id;
  return found;
end;
$$;
revoke all on function public.file_mark_s3(uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.files_sync_legacy() from public, anon, authenticated;
