import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Every migration, in filename order, exactly as Supabase would apply them.
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync(new URL(f, migrationsDir), 'utf8')
    .replace('alter publication supabase_realtime add table tasks;', '-- (publication line skipped in local test)'));

const db = new PGlite();
// Minimal stand-ins for what Supabase provides, including its default grant of every
// privilege on new public tables to anon and authenticated.
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`);
for (const sql of migrations) await db.exec(sql);

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const trip = '11111111-1111-1111-1111-111111111111';
const t1 = '22222222-2222-2222-2222-222222222221';
const t2 = '22222222-2222-2222-2222-222222222222';
const t3 = '22222222-2222-2222-2222-222222222223';

const as = async (u) => { await db.exec(`select set_config('app.uid', '${u ?? ''}', false)`); };
const call = async (q, params = []) => { try { const r = await db.query(q, params); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, err: e.message }; } };

// Every test name starts with the ID of the commit that added it (see docs/sprints/SPRINTS.md).
// The checks run in order against one database; each result is reported as its own test.
let commitId = 'SP01-C01';
const check = (name, cond, extra = '') => test(`[${commitId}] ${name}`, () => assert.ok(cond, extra));

const localTrip = {
  id: trip, title: 'Errands',
  tasks: [
    { id: t1, title: 'Pharmacy', lat: 31.9, lng: 35.2, dependsOn: [] },
    { id: t2, title: 'Bank', lat: 31.91, lng: 35.21, dependsOn: [t1] },
    { id: t3, title: 'Post office', lat: 31.92, lng: 35.22, dependsOn: [t1, t2], completed: false },
  ],
};

// --- share
await as(A);
let r = await call('select share_trip($1::jsonb, $2) as code', [JSON.stringify(localTrip), 'Adam']);
check('owner can share a trip and gets a 6-char code', r.ok && /^[0-9A-F]{6}$/.test(r.rows[0].code), JSON.stringify(r));
const code = r.rows?.[0]?.code;

r = await call('select share_trip($1::jsonb, $2) as code', [JSON.stringify(localTrip), 'Adam']);
check('sharing the same trip twice is rejected', !r.ok && r.err.includes('ALREADY_SHARED'), JSON.stringify(r));

const bad = { ...localTrip, id: '33333333-3333-3333-3333-333333333333',
  tasks: [{ id: '44444444-4444-4444-4444-444444444441', dependsOn: ['99999999-9999-9999-9999-999999999999'] }] };
r = await call('select share_trip($1::jsonb, $2) as code', [JSON.stringify(bad), 'Adam']);
check('a dependency pointing outside the trip is rejected', !r.ok && r.err.includes('BAD_DEPENDENCY'), JSON.stringify(r));
r = await call(`select count(*)::int as n from trips where id = '33333333-3333-3333-3333-333333333333'`);
check('...and nothing from that failed share is left behind', r.rows[0].n === 0, JSON.stringify(r));

// --- non-participant
await as(B);
r = await call('select complete_task($1)', [t1]);
check('stranger cannot complete a task', !r.ok && r.err.includes('NOT_ALLOWED'), JSON.stringify(r));
r = await call('select get_trip($1)', [trip]);
check('stranger cannot read the trip', !r.ok && r.err.includes('NOT_ALLOWED'), JSON.stringify(r));

// --- join
r = await call('select join_trip($1, $2) as t', ['ZZZZZZ', 'Muhammad']);
check('wrong code rejected', !r.ok && r.err.includes('INVALID_OR_EXPIRED_CODE'), JSON.stringify(r));
r = await call('select join_trip($1, $2) as t', [code.toLowerCase(), 'Muhammad']);
check('join works with the code (case-insensitive) and returns the snapshot',
  r.ok && r.rows[0].t.tasks.length === 3 && r.rows[0].t.participants.length === 2, JSON.stringify(r));
const snap = r.rows?.[0]?.t;
check('snapshot carries dependsOn and original task fields',
  snap && snap.tasks.find(x => x.id === t2).dependsOn[0] === t1 && snap.tasks.find(x => x.id === t2).title === 'Bank', JSON.stringify(snap));

// --- the dependency rule
r = await call('select complete_task($1)', [t2]);
check('B is rejected before A is complete', !r.ok && r.err.includes('BLOCKED'), JSON.stringify(r));
r = await call('select complete_task($1)', [t3]);
check('C (needs A and B) is rejected too', !r.ok && r.err.includes('BLOCKED'), JSON.stringify(r));
r = await call('select complete_task($1) as t', [t1]);
check('A can be completed by a participant (not the owner)', r.ok && r.rows[0].t.completed === true && r.rows[0].t.completed_by === B, JSON.stringify(r));
await as(A);
r = await call('select complete_task($1) as t', [t1]);
check('completing A again is idempotent and keeps the first completer', r.ok && r.rows[0].t.completed_by === B, JSON.stringify(r));
r = await call('select complete_task($1) as t', [t3]);
check('C is still blocked while B is incomplete', !r.ok && r.err.includes('BLOCKED'), JSON.stringify(r));
r = await call('select complete_task($1) as t', [t2]);
check('B can now be completed', r.ok && r.rows[0].t.completed === true, JSON.stringify(r));
r = await call('select complete_task($1) as t', [t3]);
check('C can now be completed', r.ok && r.rows[0].t.completed === true, JSON.stringify(r));
r = await call('select get_trip($1) as t', [trip]);
check('snapshot shows all three complete', r.rows[0].t.tasks.every(x => x.completed), JSON.stringify(r));

// --- expiry + cap
await db.exec(`update trips set join_code_expires_at = now() - interval '1 minute'`);
await as(C);
r = await call('select join_trip($1, $2) as t', [code, 'Hammam']);
check('expired code rejected', !r.ok && r.err.includes('INVALID_OR_EXPIRED_CODE'), JSON.stringify(r));
await as(A);
r = await call('select refresh_join_code($1) as c', [trip]);
const code2 = r.rows?.[0]?.c;
check('owner can refresh the code', r.ok && /^[0-9A-F]{6}$/.test(code2), JSON.stringify(r));
await as(B);
r = await call('select refresh_join_code($1) as c', [trip]);
check('non-owner cannot refresh the code', !r.ok && r.err.includes('NOT_OWNER'), JSON.stringify(r));

for (let i = 0; i < 8; i++) {  // fill to 10 (A, B already in)
  await as(`00000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`);
  r = await call('select join_trip($1, $2) as t', [code2, 'P' + i]);
  if (!r.ok) check('filling the trip to 10 participants', false, JSON.stringify(r));
}
await as(C);
r = await call('select join_trip($1, $2) as t', [code2, 'Late']);
check('11th participant rejected (cap = 10)', !r.ok && r.err.includes('TRIP_FULL'), JSON.stringify(r));
await as(B);
r = await call('select join_trip($1, $2) as t', [code2, 'Muhammad2']);
check('an existing participant re-joining is still fine at the cap', r.ok, JSON.stringify(r));

// --- shared with progress already made (promote-mid-trip)
const mid = { id: '55555555-5555-5555-5555-555555555555', title: 'Mid',
  tasks: [{ id: '66666666-6666-6666-6666-666666666661', completed: true, dependsOn: [] },
          { id: '66666666-6666-6666-6666-666666666662', completed: false, dependsOn: ['66666666-6666-6666-6666-666666666661'] }] };
await as(A);
r = await call('select share_trip($1::jsonb, $2) as code', [JSON.stringify(mid), 'Adam']);
check('trip shared mid-way keeps completed flags', r.ok, JSON.stringify(r));
r = await call('select complete_task($1) as t', ['66666666-6666-6666-6666-666666666662']);
check('...and the next task is immediately completable', r.ok && r.rows[0].t.completed, JSON.stringify(r));

// --- stop sharing
await as(B);
await call('select stop_sharing($1)', [trip]);
r = await call(`select count(*)::int as n from trips where id = $1`, [trip]);
check('non-owner cannot stop sharing', r.rows[0].n === 1, JSON.stringify(r));
await as(A);
await call('select stop_sharing($1)', [trip]);
r = await call(`select (select count(*) from trips where id = $1)::int as a, (select count(*) from tasks where trip_id = $1)::int as b, (select count(*) from participants where trip_id = $1)::int as c`, [trip]);
check('owner stop_sharing removes trip, tasks, participants', r.rows[0].a === 0 && r.rows[0].b === 0 && r.rows[0].c === 0, JSON.stringify(r));

// --- found in review (fixed in 20261108000100_share_trip_checks.sql)
commitId = 'SP01-C03';
const tripLeft = async (id) => (await call('select count(*)::int as n from trips where id = $1', [id])).rows[0].n;
await as(A);

const selfDep = { id: '77777777-7777-7777-7777-777777777770', title: 'Self',
  tasks: [{ id: '77777777-7777-7777-7777-777777777771', dependsOn: ['77777777-7777-7777-7777-777777777771'] }] };
r = await call('select share_trip($1::jsonb, $2) as code', [JSON.stringify(selfDep), 'Adam']);
check('a task that depends on itself is rejected', !r.ok && r.err.includes('DEPENDENCY_CYCLE'), JSON.stringify(r));
check('...and nothing from the self-dependency share is left behind', await tripLeft(selfDep.id) === 0);

const direct = { id: '77777777-7777-7777-7777-777777777780', title: 'Direct cycle',
  tasks: [{ id: '77777777-7777-7777-7777-777777777781', dependsOn: ['77777777-7777-7777-7777-777777777782'] },
          { id: '77777777-7777-7777-7777-777777777782', dependsOn: ['77777777-7777-7777-7777-777777777781'] }] };
r = await call('select share_trip($1::jsonb, $2) as code', [JSON.stringify(direct), 'Adam']);
check('a direct cycle (1 <-> 2) is rejected', !r.ok && r.err.includes('DEPENDENCY_CYCLE'), JSON.stringify(r));

const indirect = { id: '77777777-7777-7777-7777-777777777790', title: 'Indirect cycle',
  tasks: [{ id: '77777777-7777-7777-7777-777777777791', dependsOn: ['77777777-7777-7777-7777-777777777793'] },
          { id: '77777777-7777-7777-7777-777777777792', dependsOn: ['77777777-7777-7777-7777-777777777791'] },
          { id: '77777777-7777-7777-7777-777777777793', dependsOn: ['77777777-7777-7777-7777-777777777792'] },
          { id: '77777777-7777-7777-7777-777777777794', dependsOn: [] }] };
r = await call('select share_trip($1::jsonb, $2) as code', [JSON.stringify(indirect), 'Adam']);
check('an indirect cycle (1 -> 3 -> 2 -> 1) is rejected', !r.ok && r.err.includes('DEPENDENCY_CYCLE'), JSON.stringify(r));
check('...and nothing from the indirect-cycle share is left behind', await tripLeft(indirect.id) === 0);

const diamond = { id: '88888888-8888-8888-8888-888888888880', title: 'Diamond',
  tasks: [{ id: '88888888-8888-8888-8888-888888888881', dependsOn: [] },
          { id: '88888888-8888-8888-8888-888888888882', dependsOn: ['88888888-8888-8888-8888-888888888881'] },
          { id: '88888888-8888-8888-8888-888888888883', dependsOn: ['88888888-8888-8888-8888-888888888881'] },
          { id: '88888888-8888-8888-8888-888888888884', dependsOn: ['88888888-8888-8888-8888-888888888882', '88888888-8888-8888-8888-888888888883'] }] };
r = await call('select share_trip($1::jsonb, $2) as code', [JSON.stringify(diamond), 'Adam']);
check('a diamond (shared prerequisite, no cycle) is still accepted', r.ok, JSON.stringify(r));

const doneEarly = { id: '99999999-9999-9999-9999-999999999990', title: 'Done early',
  tasks: [{ id: '99999999-9999-9999-9999-999999999991', completed: false, dependsOn: [] },
          { id: '99999999-9999-9999-9999-999999999992', completed: true, dependsOn: ['99999999-9999-9999-9999-999999999991'] }] };
r = await call('select share_trip($1::jsonb, $2) as code', [JSON.stringify(doneEarly), 'Adam']);
check('a task marked complete before its prerequisite is rejected', !r.ok && r.err.includes('BLOCKED'), JSON.stringify(r));
check('...and nothing from the early-completion share is left behind', await tripLeft(doneEarly.id) === 0);

for (const role of ['anon', 'authenticated']) {
  for (const table of ['trips', 'participants', 'tasks']) {
    r = await call(`select has_table_privilege($1, $2, 'SELECT') as s,
      has_table_privilege($1, $2, 'INSERT') or has_table_privilege($1, $2, 'UPDATE') or has_table_privilege($1, $2, 'DELETE')
      or has_table_privilege($1, $2, 'TRUNCATE') or has_table_privilege($1, $2, 'REFERENCES') or has_table_privilege($1, $2, 'TRIGGER') as w`,
      [role, `public.${table}`]);
    check(`${role} can only select from ${table} (no write, truncate, references or trigger)`, r.ok && r.rows[0].s && !r.rows[0].w, JSON.stringify(r));
  }
}

await db.close();
