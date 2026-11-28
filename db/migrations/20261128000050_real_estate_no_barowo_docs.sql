-- Кабинеты «Nieruchomości», созданные через /firma, получали генератор документов Barowo
-- (DEFAULT_DOCUMENT_ENGINE) — отсюда оферты, договоры и меню мероприятий у агента недвижимости.
-- Код исправлен (lib/organizations/actions.ts); здесь — уже созданные кабинеты. Прежнее значение — в audit_log.
insert into public.audit_log (organization_id, action, entity, entity_id, before, note)
select id, 'organization.document_engine_clear', 'organizations', id::text,
       jsonb_build_object('document_engine', document_engine), 'real-estate: generator dokumentów eventowych nie dotyczy'
  from public.organizations
 where industry_preset = 'real-estate' and document_engine is not null;

update public.organizations set document_engine = null
 where industry_preset = 'real-estate' and document_engine is not null;
