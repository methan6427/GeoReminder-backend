# GeoReminder: trip sharing, simplest design (1 Nov 2026)

Supersedes the Firestore and Cloud Function design in the Phase 2 plans. Backend is Supabase (free tier). Everything below is backed by `001_sharing.sql`, whose logic passed 26 local tests (PGlite). Row-level security, realtime delivery and the Flutter client are NOT tested yet.

## The whole design

- **3 tables** (`trips`, `participants`, `tasks`), **6 functions the app calls** (`share_trip`, `join_trip`, `get_trip`, `complete_task`, `refresh_join_code`, `stop_sharing`) plus one internal helper, **1 realtime channel**. No server code, no Edge Functions, no Cloud Functions.
- **Identity:** anonymous sign-in (`signInAnonymously()`), plus a nickname typed once. No accounts.
- **Local first:** a trip is a local JSON file until the owner taps Share. Share uploads the trip once (`share_trip`), and the same trip and task ids are used on the server, so the local file maps straight onto the server rows.
- **Join:** 6-character code, valid 10 minutes, 10 participants max (`join_trip`). A QR code is only a picture of the same code; add it last, if time allows.
- **The dependency rule lives in one place:** `complete_task` refuses with `BLOCKED` unless every prerequisite is complete. Clients cannot write to the tables at all, so the rule cannot be bypassed.
- **Realtime is only a ping.** Subscribe to changes on `tasks` for the trip. On any event, call `get_trip` and replace local state. A missed event is healed by the next one or by a fetch on reconnect. Build the fetch-and-replace first, so a "refresh every 10 seconds" version works on day one and the realtime subscription is a few lines added afterwards.

## Why this stays simple (the three rules that remove whole subsystems)

1. **Completion is one-way on shared trips.** A prerequisite can only go from not-done to done, so a stale read can wrongly block a completion (the client retries) but never wrongly allow one. This removes row locking and conflict handling. Two people completing the same task: the second call returns the existing record.
2. **A shared trip's structure is frozen.** After Share, tasks and dependencies cannot be added, edited or removed on the shared copy. To change them: stop sharing, edit, share again. This removes edit syncing.
3. **Offline: only dependency-free tasks can be completed offline.** They go into a local list of task ids and replay on reconnect (safe to replay twice). A task with prerequisites has its button disabled until the phone is online. This removes the `NEEDS_ATTENTION` flow and the owner's resolve screen from the earlier plans.

## Decisions the team still needs to confirm (defaults in bold)

1. Can any participant complete any task? **Yes.** If tasks must be assigned, add an `assignee` column and one `if` in `complete_task`.
2. Do all participants get geofence reminders for all tasks? **Yes.** Filter to assigned tasks if decision 1 changes.
3. Shared trip structure frozen after Share? **Yes** (rule 2 above).
4. Offline rule above? **Yes** (rule 3).

## Build order

1. Day 1: run `001_sharing.sql` in the Supabase SQL editor, enable anonymous sign-ins (Auth settings), rerun the test idea by hand (create trip, call `complete_task` on B before A, see `BLOCKED`).
2. Share and join screens, using fetch-and-replace.
3. Complete button wired to `complete_task`, disabled when a prerequisite is not complete locally.
4. Realtime subscription, then the offline list.

## Things to check before trusting it

- **Row-level security:** with a second anonymous user who is not in the trip, `select * from tasks` must return nothing, and a direct `update tasks` must fail.
- **Realtime delivery:** confirm a participant receives events and a stranger does not.
- **Anonymous sign-in limit:** Supabase's default is 30 sign-ins per hour per IP. University Wi-Fi shares IPs and repeated reinstalls while testing count against it; raise it in the dashboard (Auth rate limits). Supabase also recommends CAPTCHA, which is overkill for a graduation project.
- **Anonymous accounts are tied to the install.** Clearing app data or reinstalling creates a new user and loses access to trips you joined. Acceptable here; say so in the report.
- **Free projects pause after 7 idle days.** Wake it before every demo and every test session.
