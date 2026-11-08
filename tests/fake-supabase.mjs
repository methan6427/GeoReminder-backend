// An in-memory stand-in for a Supabase project, used by verify-remote.test.mjs to test the
// script's checks offline. It answers the same Auth, REST (PostgREST) and Realtime (Phoenix
// websocket) requests the script sends. By default it follows the rules of the migrations; each
// fault flag breaks one rule, so a test can prove the matching check reports FAIL.
//
// Faults: anonDisabled, noBlocked, rlsLeak, directWrites, realtimeNone, realtimeToStranger,
//         realtimeNoSystem, joinRefused, stopSharingNoop, crashOn (an rpc name), echoSecrets.
import { randomUUID } from 'node:crypto';

export const FAKE_URL = 'https://fakeproject.supabase.co';
export const FAKE_KEY = 'fake-anon-key-0123456789';

export function fakeSupabase(faults = {}) {
  const users = new Map(); // token -> user id
  const trips = new Map(); // trip id -> { id, owner, title, code, participants: Map, tasks: Map }
  const sockets = new Set();
  const calls = [];
  let n = 0;

  const json = (status, body) => (status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  // echoSecrets: every error echoes the request's key and token instead of the expected code, so
  // the checks fail and print details that contain secrets (the script must redact them).
  let current = {};
  const echo = () => `ERROR (apikey ${current.apikey}, ${current.Authorization})`;
  const raise = (message) => json(400, { code: 'P0001', message: faults.echoSecrets ? echo() : message, details: null, hint: null });
  const forbid = (table) => json(403, { code: '42501', message: faults.echoSecrets ? echo() : `permission denied for table ${table}` });

  const taskRow = (trip, t) => ({ id: t.id, trip_id: trip.id, data: t.data, depends_on: t.dependsOn,
    completed: t.completed, completed_by: t.completedBy, completed_at: t.completedAt });
  const snapshot = (trip) => ({
    id: trip.id, title: trip.title, owner: trip.owner,
    participants: [...trip.participants].map(([userId, nickname]) => ({ userId, nickname })),
    tasks: [...trip.tasks.values()].map((t) => ({ ...t.data, id: t.id, dependsOn: t.dependsOn,
      completed: t.completed, completedBy: t.completedBy, completedAt: t.completedAt })),
  });
  const tripOfTask = (taskId) => [...trips.values()].find((tr) => tr.tasks.has(taskId));
  const member = (trip, uid) => Boolean(trip && uid && trip.participants.has(uid));

  function emit(trip, type, record) {
    if (faults.realtimeNone) return;
    for (const s of sockets) {
      if (s.filter !== `trip_id=eq.${trip.id}`) continue;
      if (!member(trip, users.get(s.token)) && !faults.realtimeToStranger) continue;
      s.deliver({ topic: s.topic, event: 'postgres_changes', ref: null,
        payload: { data: { type, schema: 'public', table: 'tasks', record, old_record: { id: record.id } }, ids: [1] } });
    }
  }

  const rpcs = {
    share_trip(uid, { p_trip, p_nickname }) {
      if (!uid) return raise('NOT_SIGNED_IN');
      if (trips.has(p_trip.id)) return raise('ALREADY_SHARED');
      const code = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
      const trip = { id: p_trip.id, owner: uid, title: p_trip.title, code, participants: new Map([[uid, p_nickname]]), tasks: new Map() };
      for (const { id, dependsOn = [], completed = false, ...data } of p_trip.tasks ?? []) {
        trip.tasks.set(id, { id, data, dependsOn, completed, completedBy: completed ? uid : null, completedAt: null });
      }
      trips.set(trip.id, trip);
      return json(200, code);
    },
    join_trip(uid, { p_code, p_nickname }) {
      const trip = [...trips.values()].find((t) => t.code === p_code.trim().toUpperCase());
      if (!trip) return raise('INVALID_OR_EXPIRED_CODE');
      trip.participants.set(uid, p_nickname);
      return json(200, snapshot(trip));
    },
    get_trip(uid, { p_trip }) {
      const trip = trips.get(p_trip);
      return member(trip, uid) ? json(200, snapshot(trip)) : raise('NOT_ALLOWED');
    },
    complete_task(uid, { p_task }) {
      const trip = tripOfTask(p_task);
      if (!member(trip, uid)) return raise('NOT_ALLOWED');
      const t = trip.tasks.get(p_task);
      if (!t.completed) {
        if (!faults.noBlocked && t.dependsOn.some((d) => !trip.tasks.get(d).completed)) return raise('BLOCKED');
        Object.assign(t, { completed: true, completedBy: uid, completedAt: new Date().toISOString() });
        emit(trip, 'UPDATE', taskRow(trip, t));
      }
      return json(200, taskRow(trip, t));
    },
    stop_sharing(uid, { p_trip }) {
      if (!faults.stopSharingNoop && trips.get(p_trip)?.owner === uid) trips.delete(p_trip);
      return json(204);
    },
  };

  // The rows a user may see in a table, as row-level security would filter them.
  function rows(table, uid) {
    const visible = [...trips.values()].filter((tr) => faults.rlsLeak || member(tr, uid));
    if (table === 'trips') return visible.map((tr) => ({ id: tr.id, owner: tr.owner, title: tr.title, join_code: tr.code }));
    if (table === 'participants') return visible.flatMap((tr) => [...tr.participants].map(([user_id, nickname]) => ({ trip_id: tr.id, user_id, nickname })));
    if (table === 'tasks') return visible.flatMap((tr) => [...tr.tasks.values()].map((t) => taskRow(tr, t)));
    return null;
  }
  const matches = (params) => (row) => [...params].every(([col, v]) => col === 'select' || String(row[col]) === v.replace(/^eq\./, ''));

  function table(method, name, params, uid, body) {
    const all = rows(name, uid);
    if (!all) return json(404, { message: `relation ${name} does not exist` });
    if (method === 'GET') return json(200, all.filter(matches(params)));
    if (!faults.directWrites) return forbid(name);
    // directWrites: the table accepts writes as if the privileges had never been revoked.
    if (method === 'POST') return json(201, [body]);
    const hit = all.filter(matches(params));
    for (const row of hit) {
      const trip = trips.get(row.trip_id ?? row.id);
      if (name === 'tasks' && method === 'PATCH') Object.assign(trip.tasks.get(row.id), body);
      if (name === 'tasks' && method === 'DELETE') trip.tasks.delete(row.id);
      if (name === 'trips' && method === 'DELETE') trips.delete(row.id);
    }
    return json(200, hit);
  }

  async function fetch(input, init = {}) {
    const u = new URL(input);
    const headers = init.headers ?? {};
    current = headers;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: u.pathname, search: u.search });
    if (headers.apikey !== FAKE_KEY) return json(401, { message: 'Invalid API key' });
    const uid = users.get(headers.Authorization?.replace(/^Bearer /, ''));

    if (u.pathname === '/auth/v1/signup') {
      if (faults.anonDisabled) return json(422, { code: 422, error_code: 'anonymous_provider_disabled', msg: 'Anonymous sign-ins are disabled' });
      const id = randomUUID();
      const token = `user-token-${++n}-${id}`;
      users.set(token, id);
      return json(200, { access_token: token, token_type: 'bearer', user: { id, is_anonymous: true } });
    }
    const fn = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    if (fn) {
      if (faults.crashOn === fn) throw new TypeError('fetch failed');
      return rpcs[fn] ? rpcs[fn](uid, body ?? {}) : json(404, { message: `function ${fn} not found` });
    }
    const name = u.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (name) return table(init.method, name, u.searchParams, uid, body);
    return json(404, { message: 'not found' });
  }

  class FakeWebSocket {
    constructor(url) {
      this.url = new URL(url);
      sockets.add(this);
      setTimeout(() => {
        if (this.url.searchParams.get('apikey') !== FAKE_KEY) { this.onerror?.({}); this.close(); return; }
        this.onopen?.({});
      });
    }
    send(raw) {
      const m = JSON.parse(raw);
      if (m.event === 'phx_join') {
        this.topic = m.topic;
        this.token = m.payload.access_token;
        this.filter = m.payload.config.postgres_changes[0].filter;
        if (faults.joinRefused) { this.deliver({ topic: m.topic, event: 'phx_reply', ref: m.ref, payload: { status: 'error', response: { reason: 'refused' } } }); return; }
        this.deliver({ topic: m.topic, event: 'phx_reply', ref: m.ref,
          payload: { status: 'ok', response: { postgres_changes: [{ id: 1, ...m.payload.config.postgres_changes[0] }] } } });
        if (!faults.realtimeNoSystem) {
          this.deliver({ topic: m.topic, event: 'system', ref: null,
            payload: { channel: m.topic.slice('realtime:'.length), extension: 'postgres_changes', message: 'Subscribed to PostgreSQL', status: 'ok' } });
        }
      }
    }
    deliver(msg) { setTimeout(() => { if (sockets.has(this)) this.onmessage?.({ data: JSON.stringify(msg) }); }); }
    close() { if (!sockets.delete(this)) return; setTimeout(() => this.onclose?.({})); }
  }

  return { fetch, WebSocket: FakeWebSocket, trips, sockets, users, calls };
}
