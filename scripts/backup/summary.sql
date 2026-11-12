-- Сводка восстановленной базы: только количества, без персональных данных.
select 'migrations' as what, count(*)::text as n from public.schema_migrations
union all select 'organizations', count(*)::text from public.organizations
union all select 'users', count(*)::text from auth.users
union all select 'leads', count(*)::text from public.leads
union all select 'leads_deleted', count(*)::text from public.leads where deleted_at is not null
union all select 'lead_events', count(*)::text from public.lead_events
union all select 'documents', count(*)::text from public.documents
union all select 'newest_lead', coalesce(max(created_at)::text, '—') from public.leads;
