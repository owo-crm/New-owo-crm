-- 0024 · Часы не учитываются (решение 026): 65 % делятся по согласованным процентам вклада.
-- Колонка agency_order_work.hours хранит этот процент (0,01–100); формула не меняется — пропорция.
alter table public.agency_orders alter column work_basis set default 'points';
update public.agency_orders set work_basis = 'points';
comment on column public.agency_order_work.hours is
  'Согласованный процент вклада исполнителя в фонд 65 % (сумма по заказу — 100). Часы не учитываются.';
