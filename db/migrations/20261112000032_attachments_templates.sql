-- 0032 · Свои файлы у лида и свой шаблон умовы (решение 038).
--
-- Раньше в карточке лида можно было получить только сгенерированные оферту, меню и умову.
-- Но у заказа бывает и прочее: подписанный скан, план зала, список гостей, фото площадки.
-- Такие файлы не нумеруются и не имеют отношения к генератору — им нужна своя таблица.

create table public.lead_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  filename text not null check (char_length(filename) between 1 and 200),
  content_type text not null check (char_length(content_type) <= 120),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  content bytea not null,
  note text check (char_length(note) <= 300),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade
);
create index lead_attachments_lead on public.lead_attachments (organization_id, lead_id, created_at desc);

-- Свой шаблон умовы вместо встроенного. Встроенный лежит в коде
-- (lib/documents/barowo/umowa-template.docx) и используется, пока своего нет.
create table public.organization_templates (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('contract')),
  filename text not null check (char_length(filename) between 1 and 200),
  content bytea not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, kind)
);

do $$
declare t text;
begin
  foreach t in array array['lead_attachments','organization_templates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(organization_id))', t);
    execute format('create policy "members write" on public.%I for insert to authenticated with check (public.is_member(organization_id))', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.is_member(organization_id)) with check (public.is_member(organization_id))', t);
    execute format('create policy "members delete" on public.%I for delete to authenticated using (public.is_member(organization_id))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant update (filename, content, size_bytes, uploaded_by, updated_at) on public.organization_templates to authenticated;
grant update (note) on public.lead_attachments to authenticated;

-- История лида должна уметь записать загрузку файла.
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.lead_events'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%document_generated%';
  if v_name is not null then
    execute format('alter table public.lead_events drop constraint %I', v_name);
  end if;
  alter table public.lead_events add constraint lead_events_type_check check (type in (
    'created','possible_duplicate','stage_changed','note','call','email_sent',
    'document_generated','offer_viewed','offer_accepted','edited','contacted','restored',
    'file_uploaded'));
end $$;
