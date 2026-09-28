-- The bell is pushed, not polled: Supabase Realtime streams changes to a
-- person's own notifications to their open tabs. RLS ("notifications: read
-- your own") decides who receives each row, exactly as it does for a select.
-- Written to be re-runnable, so it is safe however it gets applied.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
