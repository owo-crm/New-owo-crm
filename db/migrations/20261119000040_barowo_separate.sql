-- 0040 · M1.5 закрыт: Barowo — отдельная экосистема Ивана, не связана с OWO Ads и OWO CRM
-- (решение владельца 2026-11-19). Финансовых операций агентства по Barowo не было.
--
-- Убираем Barowo из агентства: строку agency_clients (созданную старой автопривязкой) и связь
-- platform_managed_orgs. Перед удалением прежнее состояние пишется в audit_log (восстановимо).
-- Защита: если у этой строки agency_clients есть хоть один заказ агентства — ничего не удаляется.
-- Участники Barowo (владельцы, доступ админа платформы) не трогаются.

do $$
declare
  r record;
  v_orders int;
begin
  for r in
    select p.agency_org_id, p.org_id, o.name, to_jsonb(p) as rel
      from public.platform_managed_orgs p
      join public.organizations o on o.id = p.org_id
     where p.relation = 'service' and o.name ~* 'barowo'
  loop
    select count(*) into v_orders
      from public.agency_orders ao
      join public.agency_clients ac on ac.organization_id = ao.organization_id and ac.id = ao.client_id
     where ac.organization_id = r.agency_org_id and ac.client_org_id = r.org_id;
    if v_orders > 0 then
      raise notice 'M1.5: % ma % zamówień agencji — nic nie usunięto, potrzebna decyzja', r.name, v_orders;
      continue;
    end if;

    insert into public.audit_log (organization_id, action, entity, entity_id, before, note)
    select r.org_id, 'agency_client.delete', 'agency_clients', ac.id::text, to_jsonb(ac),
           'M1.5: Barowo — osobny ekosystem, bez relacji z OWO Ads (decyzja właściciela 2026-11-19)'
      from public.agency_clients ac
     where ac.organization_id = r.agency_org_id and ac.client_org_id = r.org_id;
    delete from public.agency_clients
     where organization_id = r.agency_org_id and client_org_id = r.org_id;

    insert into public.audit_log (organization_id, action, entity, entity_id, before, note)
    values (r.org_id, 'relation.delete', 'platform_managed_orgs', r.org_id::text, r.rel,
            'M1.5: Barowo — osobny ekosystem, bez relacji z OWO Ads (decyzja właściciela 2026-11-19)');
    delete from public.platform_managed_orgs
     where agency_org_id = r.agency_org_id and org_id = r.org_id;
  end loop;
end $$;
