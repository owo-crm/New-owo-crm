-- 0035 · Аватарки аккаунтов и кабинетов (решение 039).
--
-- Рядом с названием кабинета вместо цветного квадратика — мини-иконка (логотип фирмы),
-- рядом с именем человека — его фото. Картинку уменьшает браузер до 256×256 перед загрузкой,
-- поэтому в базе лежат маленькие файлы (до 256 КБ): отдельное хранилище не нужно.
-- Только PNG/JPEG/WebP — SVG не принимаем (в нём может быть скрипт).
-- Поле «kolor marki» больше не показывается: без логотипа цвет иконки берётся из id кабинета.

create table public.organization_avatars (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 262144),
  content bytea not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Аватарка человека — его собственная, не фирмы (как public.profiles: без organization_id).
create table public.profile_avatars (
  user_id uuid primary key references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 262144),
  content bytea not null,
  updated_at timestamptz not null default now()
);

alter table public.organization_avatars enable row level security;
alter table public.profile_avatars enable row level security;

create policy "members read" on public.organization_avatars
  for select to authenticated using ((select public.is_member(organization_id)));
create policy "admins insert" on public.organization_avatars
  for insert to authenticated
  with check ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])));
create policy "admins update" on public.organization_avatars
  for update to authenticated
  using ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])))
  with check ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])));
create policy "admins delete" on public.organization_avatars
  for delete to authenticated
  using ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])));

create policy "read own or teammate" on public.profile_avatars
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.shares_organization(user_id)));
create policy "own insert" on public.profile_avatars
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own update" on public.profile_avatars
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own delete" on public.profile_avatars
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.organization_avatars, public.profile_avatars from anon, authenticated;
grant select, insert, update, delete on public.organization_avatars, public.profile_avatars to authenticated;
grant all on public.organization_avatars, public.profile_avatars to service_role;
