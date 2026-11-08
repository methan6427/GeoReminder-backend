-- GeoReminder trip sharing: the whole backend, one file.
-- Run in the Supabase SQL editor (or as a migration). Needs "Anonymous sign-ins" enabled in Auth settings.
--
-- Rules this file enforces:
--   1. Only participants can read a shared trip.
--   2. Clients can never write to the tables. Every change goes through a function below.
--   3. A task can be completed only if every prerequisite is already complete.
--   4. Completion is one-way on shared trips (no un-complete). That one rule is what makes
--      rule 3 race-free without any row locking: a prerequisite can only go false -> true,
--      so a stale read can wrongly BLOCK a completion (the client retries) but never wrongly ALLOW one.

create table trips (
  id uuid primary key,                         -- same id as the trip in the local JSON file
  owner uuid not null,
  title text not null,
  join_code text unique,
  join_code_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table participants (
  trip_id uuid not null references trips(id) on delete cascade,
  user_id uuid not null,
  nickname text not null,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table tasks (
  id uuid primary key,                         -- same id as the task in the local JSON file
  trip_id uuid not null references trips(id) on delete cascade,
  data jsonb not null,                         -- title, place, radius, ... whatever the app stores; server never looks inside
  depends_on uuid[] not null default '{}',     -- prerequisite task ids
  completed boolean not null default false,
  completed_by uuid,
  completed_at timestamptz
);
create index tasks_trip_idx on tasks(trip_id);

-- ---------- access: read-only for participants, no direct writes ----------

create function is_participant(p_trip uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from participants where trip_id = p_trip and user_id = auth.uid());
$$;

alter table trips        enable row level security;
alter table participants enable row level security;
alter table tasks        enable row level security;

create policy trips_read        on trips        for select using (is_participant(id));
create policy participants_read on participants for select using (is_participant(trip_id));
create policy tasks_read        on tasks        for select using (is_participant(trip_id));
-- No insert/update/delete policies exist, so clients cannot write. Belt and braces:
revoke insert, update, delete on trips, participants, tasks from anon, authenticated;

-- ---------- functions (the only way to change anything) ----------

-- Owner makes a fresh 10-minute join code. Also used by share_trip.
create function refresh_join_code(p_trip uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not exists (select 1 from trips where id = p_trip and owner = auth.uid()) then
    raise exception 'NOT_OWNER';
  end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from trips where join_code = v_code);
  end loop;
  update trips set join_code = v_code, join_code_expires_at = now() + interval '10 minutes' where id = p_trip;
  return v_code;
end $$;

-- One-time upload of a local trip. p_trip is the trip as the app already stores it:
--   { "id": "<uuid>", "title": "...", "tasks": [ { "id": "<uuid>", "dependsOn": ["<uuid>"], "completed": false, ...anything else } ] }
create function share_trip(p_trip jsonb, p_nickname text) returns text
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

  return refresh_join_code(v_trip);
end $$;

-- Full snapshot of a trip for a participant (used on join, on reconnect, and after any realtime ping).
create function get_trip(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_participant(p_trip) then raise exception 'NOT_ALLOWED'; end if;
  return (
    select jsonb_build_object(
      'id', tr.id, 'title', tr.title, 'owner', tr.owner,
      'participants', (select coalesce(jsonb_agg(jsonb_build_object('userId', p.user_id, 'nickname', p.nickname)), '[]'::jsonb)
                       from participants p where p.trip_id = tr.id),
      'tasks', (select coalesce(jsonb_agg(
                  x.data || jsonb_build_object('id', x.id, 'dependsOn', to_jsonb(x.depends_on),
                    'completed', x.completed, 'completedBy', x.completed_by, 'completedAt', x.completed_at)), '[]'::jsonb)
                from tasks x where x.trip_id = tr.id))
    from trips tr where tr.id = p_trip);
end $$;

-- Join with a code. Returns the trip snapshot.
create function join_trip(p_code text, p_nickname text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v trips;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into v from trips
   where join_code = upper(trim(p_code)) and join_code_expires_at > now()
   for update;                                   -- serialises joins so the cap cannot be beaten
  if not found then raise exception 'INVALID_OR_EXPIRED_CODE'; end if;
  if not is_participant(v.id) and (select count(*) from participants where trip_id = v.id) >= 10 then
    raise exception 'TRIP_FULL';
  end if;
  insert into participants(trip_id, user_id, nickname) values (v.id, auth.uid(), p_nickname)
  on conflict (trip_id, user_id) do update set nickname = excluded.nickname;
  return get_trip(v.id);
end $$;

-- THE dependency rule. Idempotent: completing an already-complete task just returns it.
-- Errors the client should expect: BLOCKED, NOT_ALLOWED.
create function complete_task(p_task uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task;
  if not found or not is_participant(t.trip_id) then raise exception 'NOT_ALLOWED'; end if;
  if t.completed then return to_jsonb(t); end if;

  if exists (select 1 from tasks p where p.id = any(t.depends_on) and not p.completed) then
    raise exception 'BLOCKED';
  end if;

  update tasks set completed = true, completed_by = auth.uid(), completed_at = now()
   where id = p_task and not completed returning * into t;
  if not found then select * into t from tasks where id = p_task; end if;   -- someone else completed it a moment ago
  return to_jsonb(t);
end $$;

-- Owner deletes the shared copy (cascades). The local trip on each phone is untouched.
create function stop_sharing(p_trip uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from trips where id = p_trip and owner = auth.uid();
end $$;

-- ---------- realtime ----------
-- Phones subscribe to changes on tasks (filtered by trip_id) and call get_trip on any event.
alter publication supabase_realtime add table tasks;
