// Checks a real Supabase project against the rules in supabase/migrations: the things the local
// tests cannot see because they run as a Postgres superuser without Supabase around them
// (row-level security as seen by real users, table privileges through the REST API, Realtime).
//
//   SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_ANON_KEY=<publishable key> npm run verify-remote
//
// It signs in three anonymous users (owner, joiner, stranger), shares a small trip, runs the
// checks, prints PASS or FAIL for each, and always stops sharing the trip at the end.
// Exit code: 0 all checks passed, 1 a check failed, 2 missing or bad configuration.
// No dependencies: Node 22's fetch and WebSocket talk to the Auth, REST and Realtime endpoints.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const EXIT = { PASS: 0, FAIL: 1, CONFIG: 2 };

export function readConfig(env) {
  const url = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = (env.SUPABASE_ANON_KEY ?? '').trim();
  const errors = [];
  if (!url) errors.push('SUPABASE_URL is not set');
  else if (!/^https?:\/\/[^\s/?#]+$/.test(url)) errors.push('SUPABASE_URL must look like https://<project-ref>.supabase.co (no path)');
  if (!key) errors.push('SUPABASE_ANON_KEY is not set');
  return { url, key, errors };
}

// PostgREST puts the text of `raise exception '...'` in `message`; Auth uses `msg`.
export const errorText = (r) =>
  r.ok ? '' : r.data?.message ?? r.data?.msg ?? r.data?.error_description ?? (typeof r.data === 'string' ? r.data : JSON.stringify(r.data));

// A direct table request counts as denied when it errors, or when it succeeds but touches no row.
export const denied = (r) => !r.ok || (Array.isArray(r.data) && r.data.length === 0);

export function supabaseApi({ url, key, fetch = globalThis.fetch }) {
  async function request(method, path, { token, body, prefer } = {}) {
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  }
  const rep = 'return=representation';
  return {
    async signInAnonymously() {
      const r = await request('POST', '/auth/v1/signup', { body: {} });
      if (!r.ok || !r.data?.access_token || !r.data?.user?.id) {
        const hint = /anonymous/i.test(errorText(r)) ? ' (enable Anonymous sign-ins under Authentication > Sign In / Providers)' : '';
        throw new Error(`anonymous sign-in failed, HTTP ${r.status}: ${errorText(r)}${hint}`);
      }
      return { id: r.data.user.id, token: r.data.access_token };
    },
    rpc: (user, fn, args) => request('POST', `/rest/v1/rpc/${fn}`, { token: user.token, body: args }),
    select: (user, table, query) => request('GET', `/rest/v1/${table}?${query}`, { token: user.token }),
    insert: (user, table, row) => request('POST', `/rest/v1/${table}`, { token: user.token, body: row, prefer: rep }),
    update: (user, table, query, patch) => request('PATCH', `/rest/v1/${table}?${query}`, { token: user.token, body: patch, prefer: rep }),
    remove: (user, table, query) => request('DELETE', `/rest/v1/${table}?${query}`, { token: user.token, prefer: rep }),
  };
}

export function realtimeUrl(url, key) {
  const u = new URL('/realtime/v1/websocket', url);
  u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
  u.search = new URLSearchParams({ apikey: key, vsn: '1.0.0' }).toString();
  return u.toString();
}

// The same subscription the app makes (docs/sharing_service.dart.sketch): every change on tasks
// of one trip, sent with the user's own token so Realtime applies row-level security to it.
export const joinPayload = (tripId, token) => ({
  config: {
    broadcast: { ack: false, self: false },
    presence: { key: '' },
    postgres_changes: [{ event: '*', schema: 'public', table: 'tasks', filter: `trip_id=eq.${tripId}` }],
    private: false,
  },
  access_token: token,
});

// Opens one Realtime connection for one user. Resolves once Realtime reports the Postgres
// subscription ready, so a change made after that point must reach an allowed subscriber.
export function openTaskWatch({ url, key, user, tripId, WebSocket = globalThis.WebSocket, subscribeMs = 10000, heartbeatMs = 25000 }) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') return reject(new Error('this Node.js has no global WebSocket; use Node 22 or newer'));
    const topic = `realtime:verify-${tripId}`;
    const events = [];
    const waiters = new Set();
    let ws, heartbeat, ref = 1, joined = false, settled = false;
    const send = (msg) => { try { ws.send(JSON.stringify(msg)); } catch { /* closed */ } };
    const watch = {
      events,
      warning: null,
      waitFor(pred, ms) {
        const hit = events.find(pred);
        if (hit || ms <= 0) return Promise.resolve(hit ?? null);
        return new Promise((res) => {
          const w = { pred, res, timer: setTimeout(() => { waiters.delete(w); res(null); }, ms) };
          waiters.add(w);
        });
      },
      close() {
        clearInterval(heartbeat);
        for (const w of waiters) { clearTimeout(w.timer); w.res(null); }
        waiters.clear();
        try { ws?.close(); } catch { /* already closed */ }
      },
    };
    const fail = (msg) => { if (settled) return; settled = true; clearTimeout(timer); watch.close(); reject(new Error(msg)); };
    const ready = (warning) => { if (settled) return; settled = true; clearTimeout(timer); watch.warning = warning ?? null; resolve(watch); };
    const timer = setTimeout(() => (joined
      ? ready(`joined, but Realtime sent no "Subscribed to PostgreSQL" message within ${subscribeMs} ms`)
      : fail(`no reply to the channel join within ${subscribeMs} ms`)), subscribeMs);

    try { ws = new WebSocket(realtimeUrl(url, key)); } catch (e) { return fail(`cannot open the realtime connection: ${e.message}`); }
    ws.onopen = () => {
      send({ topic, event: 'phx_join', ref: '1', join_ref: '1', payload: joinPayload(tripId, user.token) });
      heartbeat = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }), heartbeatMs);
      heartbeat.unref?.();
    };
    ws.onerror = () => fail('the realtime connection failed');
    ws.onclose = () => fail('the realtime connection closed before the subscription was ready');
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.topic !== topic) return;
      if (m.event === 'phx_reply' && m.ref === '1') {
        if (m.payload?.status === 'ok') joined = true;
        else fail(`channel join refused: ${JSON.stringify(m.payload?.response ?? m.payload)}`);
      } else if (m.event === 'system' && m.payload?.extension === 'postgres_changes') {
        if (m.payload.status === 'ok') ready();
        else fail(`postgres_changes subscription failed: ${m.payload.message}`);
      } else if (m.event === 'phx_error') {
        fail('the channel reported an error');
      } else if (m.event === 'postgres_changes' && m.payload?.data) {
        const d = m.payload.data;
        events.push(d);
        for (const w of [...waiters]) if (w.pred(d)) { clearTimeout(w.timer); waiters.delete(w); w.res(d); }
      }
    };
  });
}

class Abort extends Error {}

// Runs every check in order. Returns [{ name, pass, detail }]. Never throws: an unexpected error
// is reported as a failed check, and cleanup (stop_sharing) runs whenever the trip was shared.
export async function verifyRemote({ api, openWatch, log = console.log, uuid = randomUUID, realtimeMs = 10000, settleMs = 3000 }) {
  const results = [];
  const secrets = [];
  const redact = (s) => secrets.reduce((acc, x) => acc.replaceAll(x, '<redacted>'), String(s));
  const record = (name, pass, detail = '') => {
    pass = Boolean(pass);
    detail = redact(detail);
    results.push({ name, pass, detail });
    log(`${pass ? 'PASS' : 'FAIL'}  ${name}${!pass && detail ? `\n      ${detail}` : ''}`);
    return pass;
  };
  const show = (r) => `HTTP ${r.status}: ${JSON.stringify(r.data)}`;
  const raised = (r, code) => !r.ok && errorText(r).includes(code);

  const tripId = uuid();
  const t1 = uuid();
  const t2 = uuid();
  const trip = {
    id: tripId,
    title: 'verify-remote check (safe to delete)',
    tasks: [
      { id: t1, title: 'First', dependsOn: [] },
      { id: t2, title: 'Second', dependsOn: [t1] },
    ],
  };
  const users = [];
  const watches = [];
  let owner, joiner, stranger, shared = false;

  try {
    try {
      for (let i = 0; i < 3; i++) users.push(await api.signInAnonymously());
    } catch (e) {
      record('three anonymous users sign in', false, e.message);
      throw new Abort();
    }
    [owner, joiner, stranger] = users;
    secrets.push(...users.map((u) => u.token));
    record('three anonymous users sign in', new Set(users.map((u) => u.id)).size === 3, 'user ids are not distinct');

    let r = await api.rpc(owner, 'share_trip', { p_trip: trip, p_nickname: 'verify-owner' });
    shared = r.ok;
    if (!record('owner shares a trip and gets a 6-character join code', r.ok && /^[0-9A-F]{6}$/.test(r.data), show(r))) throw new Abort();
    const code = r.data;

    r = await api.rpc(joiner, 'join_trip', { p_code: code, p_nickname: 'verify-joiner' });
    if (!record('second user joins with the code and gets the snapshot',
      r.ok && r.data?.tasks?.length === 2 && r.data?.participants?.length === 2, show(r))) throw new Abort();

    // --- the stranger: functions refuse it
    r = await api.rpc(stranger, 'get_trip', { p_trip: tripId });
    record('stranger cannot read the trip (get_trip raises NOT_ALLOWED)', raised(r, 'NOT_ALLOWED'), show(r));
    r = await api.rpc(stranger, 'complete_task', { p_task: t1 });
    record('stranger cannot complete a task (complete_task raises NOT_ALLOWED)', raised(r, 'NOT_ALLOWED'), show(r));

    // --- row-level security on direct reads. The participant read is the control: it shows the
    // rows exist, so the stranger's empty result means "hidden", not "missing".
    r = await api.select(joiner, 'tasks', `trip_id=eq.${tripId}&select=id`);
    record('participant can read the trip\'s tasks directly (RLS allows)', r.ok && r.data?.length === 2, show(r));
    for (const [table, column] of [['trips', 'id'], ['participants', 'trip_id'], ['tasks', 'trip_id']]) {
      r = await api.select(stranger, table, `${column}=eq.${tripId}`);
      record(`stranger sees no rows in ${table} (RLS)`, denied(r), show(r));
    }

    // --- direct writes: nobody may write to the tables, only the functions can
    r = await api.insert(stranger, 'participants', { trip_id: tripId, user_id: stranger.id, nickname: 'intruder' });
    record('stranger cannot add itself to participants directly', denied(r), show(r));
    r = await api.insert(stranger, 'tasks', { id: uuid(), trip_id: tripId, data: {}, depends_on: [], completed: true });
    record('stranger cannot insert a task directly', denied(r), show(r));
    r = await api.update(stranger, 'tasks', `id=eq.${t2}`, { completed: true });
    record('stranger cannot update a task directly', denied(r), show(r));
    r = await api.remove(stranger, 'tasks', `id=eq.${t1}`);
    record('stranger cannot delete a task directly', denied(r), show(r));
    r = await api.remove(stranger, 'trips', `id=eq.${tripId}`);
    record('stranger cannot delete the trip directly', denied(r), show(r));
    r = await api.update(joiner, 'tasks', `id=eq.${t2}`, { completed: true });
    record('participant cannot skip complete_task by updating tasks directly', denied(r), show(r));

    r = await api.rpc(owner, 'get_trip', { p_trip: tripId });
    const snap = r.data;
    record('...and the trip is unchanged after the refused writes',
      r.ok && snap?.tasks?.length === 2 && snap.tasks.every((t) => !t.completed) && snap?.participants?.length === 2, show(r));

    // --- the dependency rule
    r = await api.rpc(joiner, 'complete_task', { p_task: t2 });
    record('a task whose prerequisite is incomplete is refused (BLOCKED)', raised(r, 'BLOCKED'), show(r));

    // --- Realtime: participant gets the change, stranger does not
    let jw = null, sw = null;
    const [jr, sr] = await Promise.allSettled([openWatch(joiner, tripId), openWatch(stranger, tripId)]);
    if (jr.status === 'fulfilled') watches.push(jw = jr.value);
    if (sr.status === 'fulfilled') watches.push(sw = sr.value);
    record('participant and stranger subscribe to the trip\'s task changes', jw && sw,
      [jr.reason?.message && `participant: ${jr.reason.message}`, sr.reason?.message && `stranger: ${sr.reason.message}`].filter(Boolean).join('; '));
    for (const w of watches) if (w.warning) log(`      note: ${w.warning}`);

    r = await api.rpc(owner, 'complete_task', { p_task: t1 });
    record('owner completes the prerequisite', r.ok && r.data?.completed === true, show(r));

    let got = null;
    if (jw) {
      got = await jw.waitFor((d) => d.type === 'UPDATE' && d.record?.id === t1, realtimeMs);
      record('participant receives the change over Realtime', got, `nothing within ${realtimeMs} ms`);
    }
    if (sw) {
      // Give the stranger the same chance the participant had, plus a margin.
      await sw.waitFor(() => true, got ? settleMs : 0);
      const leaked = sw.events.length > 0;
      record('stranger receives nothing over Realtime (RLS)', got && !leaked,
        leaked ? `stranger got ${sw.events.length} event(s): ${JSON.stringify(sw.events[0])}`
               : 'inconclusive: the participant received nothing either');
    }

    r = await api.rpc(joiner, 'complete_task', { p_task: t2 });
    record('the dependent task completes once its prerequisite is done', r.ok && r.data?.completed === true, show(r));
  } catch (e) {
    if (!(e instanceof Abort)) record('the check run finished without an unexpected error', false, e?.stack ?? String(e));
  } finally {
    // Close Realtime first: delete events are not filtered by RLS, and are not checked here.
    for (const w of watches) w.close();
    if (shared) {
      try {
        let r = await api.rpc(owner, 'stop_sharing', { p_trip: tripId });
        record('cleanup: owner stops sharing the trip', r.ok, show(r));
        r = await api.rpc(joiner, 'get_trip', { p_trip: tripId });
        record('cleanup: the shared trip is gone (get_trip raises NOT_ALLOWED)', raised(r, 'NOT_ALLOWED'), show(r));
      } catch (e) {
        record('cleanup: owner stops sharing the trip', false, `${e.message}; delete trip ${tripId} by hand`);
      }
    }
    if (users.length) log(`note: ${users.length} anonymous user(s) were created and stay in Authentication > Users: ${users.map((u) => u.id).join(', ')}`);
  }
  return results;
}

export async function main({ env = process.env, log = console.log, fetch = globalThis.fetch, WebSocket = globalThis.WebSocket, ...options } = {}) {
  const cfg = readConfig(env);
  if (cfg.errors.length) {
    for (const e of cfg.errors) log(`verify-remote: ${e}`);
    log('usage: SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_ANON_KEY=<publishable key> npm run verify-remote');
    return EXIT.CONFIG;
  }
  const safeLog = (s) => log(String(s).replaceAll(cfg.key, '<redacted>'));
  const api = supabaseApi({ url: cfg.url, key: cfg.key, fetch });
  const openWatch = (user, tripId) => openTaskWatch({ url: cfg.url, key: cfg.key, user, tripId, WebSocket, subscribeMs: options.subscribeMs });
  safeLog(`verify-remote: checking ${cfg.url}`);
  const results = await verifyRemote({ api, openWatch, log: safeLog, ...options });
  const failed = results.filter((r) => !r.pass).length;
  safeLog(failed ? `verify-remote: ${failed} of ${results.length} checks FAILED` : `verify-remote: all ${results.length} checks passed`);
  return failed ? EXIT.FAIL : EXIT.PASS;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
