// Offline tests for scripts/verify-remote.mjs. They run the script against tests/fake-supabase.mjs,
// never against a real project: a correct fake must pass every check, and a fake with one rule
// broken must fail the check for that rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, readConfig, realtimeUrl, denied, EXIT } from '../scripts/verify-remote.mjs';
import { fakeSupabase, FAKE_URL, FAKE_KEY } from './fake-supabase.mjs';

const env = { SUPABASE_URL: FAKE_URL, SUPABASE_ANON_KEY: FAKE_KEY };

async function run(faults = {}, extraEnv = {}) {
  const fake = fakeSupabase(faults);
  const lines = [];
  const code = await main({
    env: { ...env, ...extraEnv }, log: (s) => lines.push(String(s)),
    fetch: fake.fetch, WebSocket: fake.WebSocket,
    realtimeMs: 200, settleMs: 50, subscribeMs: 200,
  });
  const out = lines.join('\n');
  const status = (name) => out.split('\n').find((l) => l.endsWith(`  ${name}`))?.slice(0, 4);
  return { code, out, lines, fake, status };
}

const checks = [
  'three anonymous users sign in',
  'owner shares a trip and gets a 6-character join code',
  'second user joins with the code and gets the snapshot',
  'stranger cannot read the trip (get_trip raises NOT_ALLOWED)',
  'stranger cannot complete a task (complete_task raises NOT_ALLOWED)',
  'participant can read the trip\'s tasks directly (RLS allows)',
  'stranger sees no rows in trips (RLS)',
  'stranger sees no rows in participants (RLS)',
  'stranger sees no rows in tasks (RLS)',
  'stranger cannot add itself to participants directly',
  'stranger cannot insert a task directly',
  'stranger cannot update a task directly',
  'stranger cannot delete a task directly',
  'stranger cannot delete the trip directly',
  'participant cannot skip complete_task by updating tasks directly',
  '...and the trip is unchanged after the refused writes',
  'a task whose prerequisite is incomplete is refused (BLOCKED)',
  'participant and stranger subscribe to the trip\'s task changes',
  'owner completes the prerequisite',
  'participant receives the change over Realtime',
  'stranger receives nothing over Realtime (RLS)',
  'the dependent task completes once its prerequisite is done',
  'cleanup: owner stops sharing the trip',
  'cleanup: the shared trip is gone (get_trip raises NOT_ALLOWED)',
];

test('[SP01-C05] a project that follows the rules passes every check and exits 0', async () => {
  const { code, out, status } = await run();
  assert.equal(code, EXIT.PASS, out);
  for (const name of checks) assert.equal(status(name), 'PASS', `${name}\n${out}`);
  assert.doesNotMatch(out, /^FAIL/m);
  assert.match(out, new RegExp(`all ${checks.length} checks passed`));
});

test('[SP01-C05] the run cleans up: trip deleted and every realtime connection closed', async () => {
  const { fake } = await run();
  assert.equal(fake.trips.size, 0);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fake.sockets.size, 0);
});

test('[SP01-C05] two runs on one project do not collide (fresh ids each run)', async () => {
  const fake = fakeSupabase();
  for (let i = 0; i < 2; i++) {
    const code = await main({ env, log: () => {}, fetch: fake.fetch, WebSocket: fake.WebSocket, realtimeMs: 200, settleMs: 50, subscribeMs: 200 });
    assert.equal(code, EXIT.PASS);
  }
});

test('[SP01-C05] missing SUPABASE_URL or SUPABASE_ANON_KEY exits 2 without any request', async () => {
  for (const missing of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
    const { code, out, fake } = await run({}, { [missing]: '' });
    assert.equal(code, EXIT.CONFIG);
    assert.match(out, new RegExp(`${missing} is not set`));
    assert.equal(fake.calls.length, 0);
  }
});

test('[SP01-C05] a URL with a path is rejected; a trailing slash is fine', () => {
  assert.match(readConfig({ SUPABASE_URL: 'https://x.supabase.co/rest/v1', SUPABASE_ANON_KEY: 'k' }).errors.join(), /no path/);
  assert.deepEqual(readConfig({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_ANON_KEY: 'k' }),
    { url: 'https://x.supabase.co', key: 'k', errors: [] });
});

test('[SP01-C05] the realtime URL uses wss for https and ws for a local http project', () => {
  assert.equal(realtimeUrl('https://x.supabase.co', 'k'), 'wss://x.supabase.co/realtime/v1/websocket?apikey=k&vsn=1.0.0');
  assert.equal(realtimeUrl('http://127.0.0.1:54321', 'k'), 'ws://127.0.0.1:54321/realtime/v1/websocket?apikey=k&vsn=1.0.0');
});

test('[SP01-C05] a write counts as refused on an error or when no row was touched', () => {
  assert.equal(denied({ ok: false, status: 403, data: { code: '42501' } }), true);
  assert.equal(denied({ ok: true, status: 200, data: [] }), true);
  assert.equal(denied({ ok: true, status: 200, data: [{ id: 1 }] }), false);
  assert.equal(denied({ ok: true, status: 201, data: [{ id: 1 }] }), false);
});

test('[SP01-C05] anonymous sign-ins disabled: fails with a hint and makes no further requests', async () => {
  const { code, out, status, fake } = await run({ anonDisabled: true });
  assert.equal(code, EXIT.FAIL);
  assert.equal(status('three anonymous users sign in'), 'FAIL');
  assert.match(out, /enable Anonymous sign-ins/);
  assert.ok(fake.calls.every((c) => c.path === '/auth/v1/signup'));
});

// One broken rule per case, and the checks that must catch it.
const faultCases = [
  ['noBlocked', 'complete_task ignores prerequisites',
    ['a task whose prerequisite is incomplete is refused (BLOCKED)']],
  ['rlsLeak', 'row-level security shows every row to everyone',
    ['stranger sees no rows in trips (RLS)', 'stranger sees no rows in participants (RLS)', 'stranger sees no rows in tasks (RLS)']],
  ['directWrites', 'table write privileges were never revoked',
    ['stranger cannot add itself to participants directly', 'stranger cannot insert a task directly',
     'participant cannot skip complete_task by updating tasks directly', '...and the trip is unchanged after the refused writes']],
  ['realtimeToStranger', 'Realtime ignores row-level security',
    ['stranger receives nothing over Realtime (RLS)']],
  ['realtimeNone', 'tasks are not in the realtime publication',
    ['participant receives the change over Realtime', 'stranger receives nothing over Realtime (RLS)']],
  ['joinRefused', 'Realtime refuses the channel join',
    ['participant and stranger subscribe to the trip\'s task changes']],
  ['stopSharingNoop', 'stop_sharing does not delete the trip',
    ['cleanup: the shared trip is gone (get_trip raises NOT_ALLOWED)']],
];

for (const [fault, what, failing] of faultCases) {
  test(`[SP01-C05] fails with exit 1 when ${what}`, async () => {
    const { code, out, status } = await run({ [fault]: true });
    assert.equal(code, EXIT.FAIL, out);
    for (const name of failing) assert.equal(status(name), 'FAIL', `${name}\n${out}`);
  });
}

test('[SP01-C05] a realtime leak passes the participant check but fails the stranger check', async () => {
  const { status } = await run({ realtimeToStranger: true });
  assert.equal(status('participant receives the change over Realtime'), 'PASS');
  assert.equal(status('stranger receives nothing over Realtime (RLS)'), 'FAIL');
});

test('[SP01-C05] a subscription confirmed only by the join reply still runs, with a note', async () => {
  const { code, out } = await run({ realtimeNoSystem: true });
  assert.equal(code, EXIT.PASS, out);
  assert.match(out, /note: joined, but Realtime sent no "Subscribed to PostgreSQL" message/);
});

test('[SP01-C05] a network error mid-run is a failed check, and cleanup still runs', async () => {
  const { code, out, status, fake } = await run({ crashOn: 'join_trip' });
  assert.equal(code, EXIT.FAIL);
  assert.equal(status('the check run finished without an unexpected error'), 'FAIL');
  assert.equal(status('cleanup: owner stops sharing the trip'), 'PASS', out);
  assert.equal(fake.trips.size, 0);
});

test('[SP01-C05] the anon key and user tokens never appear in the output', async () => {
  const { out, fake } = await run({ echoSecrets: true });
  assert.match(out, /<redacted>/, 'the fault should have echoed a secret into a failure detail');
  assert.ok(!out.includes(FAKE_KEY), 'anon key printed');
  for (const token of fake.users.keys()) assert.ok(!out.includes(token), 'user token printed');
});

test('[SP01-C05] the anonymous user ids are listed so they can be removed by hand', async () => {
  const { out, fake } = await run();
  assert.equal(fake.users.size, 3);
  for (const id of fake.users.values()) assert.ok(out.includes(id));
});
