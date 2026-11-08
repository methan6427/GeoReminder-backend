-- Fixes found while reviewing 20261108000000_trip_sharing.sql. That file is not edited.
--
-- 1. share_trip accepted dependency cycles (including a task that depends on itself). Every task
--    on a cycle could then never be completed. Now rejected with DEPENDENCY_CYCLE.
-- 2. share_trip accepted a task marked completed while one of its prerequisites was not, which
--    let the upload skip the dependency rule that complete_task enforces. Now rejected with BLOCKED.
-- 3. Supabase grants every privilege on new public tables to anon and authenticated. The first
--    migration revoked insert, update and delete only; truncate (which row-level security does
--    not cover), references and trigger stayed granted. Revoked here.

create or replace function share_trip(p_trip jsonb, p_nickname text) returns text
language plpgsql security definer set search_path = public as $$
declare v_trip uuid := (p_trip->>'id')::uuid; t jsonb; v_done boolean;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if exists (select 1 from trips where id = v_trip) then raise exception 'ALREADY_SHARED'; end if;

  insert into trips(id, owner, title) values (v_trip, auth.uid(), p_trip->>'title');
  insert into participants(trip_id, user_id, nickname) values (v_trip, auth.uid(), p_nickname);

  for t in select * from jsonb_array_elements(coalesce(p_trip->'tasks', '[]'::jsonb)) loop
    v_done := coalesce((t->>'completed')::boolean, false);
    insert into tasks(id, trip_id, data, depends_on, completed, completed_by, completed_at)
    values ((t->>'id')::uuid, v_trip,
            t - 'id' - 'dependsOn' - 'completed' - 'completedBy' - 'completedAt',
            coalesce(array(select jsonb_array_elements_text(t->'dependsOn'))::uuid[], '{}'),
            v_done,
            case when v_done then auth.uid() end,
            case when v_done then now() end);
  end loop;

  -- every prerequisite must be a task of this same trip, or a task could be blocked forever
  if exists (
    select 1 from tasks x, unnest(x.depends_on) d
    where x.trip_id = v_trip
      and not exists (select 1 from tasks p where p.id = d and p.trip_id = v_trip)
  ) then raise exception 'BAD_DEPENDENCY'; end if;

  -- no task may reach itself by following dependsOn (self-dependency, direct or indirect cycle).
  -- union (not union all) stops the recursion once no new (start, reached) pair appears.
  if exists (
    with recursive reach(start_id, node) as (
      select x.id, d from tasks x, unnest(x.depends_on) d where x.trip_id = v_trip
      union
      select r.start_id, d from reach r join tasks x on x.id = r.node, unnest(x.depends_on) d
    )
    select 1 from reach where start_id = node
  ) then raise exception 'DEPENDENCY_CYCLE'; end if;

  -- a task can arrive already complete only if all of its prerequisites are complete too
  if exists (
    select 1 from tasks x, unnest(x.depends_on) d
    join tasks p on p.id = d
    where x.trip_id = v_trip and x.completed and not p.completed
  ) then raise exception 'BLOCKED'; end if;

  return refresh_join_code(v_trip);
end $$;

revoke truncate, references, trigger on trips, participants, tasks from anon, authenticated;
