# Progress

Branch: `adam`. Commit IDs (`SP01-C01` ...) are listed in `docs/sprints/SPRINTS.md`.

## Done

### B1. Verify the starter pack (8 Nov 2026)

- Starter pack copied in: `supabase/migrations`, `tests`, `docs`, `package.json`, `package-lock.json`.
- The empty Spring Boot scaffold (`pom.xml`, `mvnw*`, `.mvn`, `src`) is removed: the backend is
  Supabase with no server. One commit (`SP01-C02`), so reverting it brings the scaffold back.
  `./mvnw -B verify` passed on the scaffold just before removal.
- CI (`.github/workflows/ci.yml`): job names `check` and `build` are kept, because branch
  protection and `pipeline.yml` depend on them. `check` runs `npm ci && npm test`. `build` runs
  `npm run build`, which writes `dist/schema.sql` (all migrations in order) and uploads it as an
  artifact.
- `AGENTS.md` and `README.md`: the stack lines now say Supabase instead of Spring Boot. The full
  README is B3.
- SQL review: two defects and one hardening gap found. Each has failing tests and is fixed in
  the new migration `supabase/migrations/20261108000100_share_trip_checks.sql`. The first
  migration is not edited.
- Commit IDs and the sprint plan (`SP01-C04`): `docs/sprints/sprints.json` is the plan for both
  repos (14 sprints, one version each). `npm run sprints` renders `SPRINTS.md` from it.
  `tests/registry.test.mjs` fails if a done commit has no test named with its ID. `npm test` now
  runs every `tests/*.test.mjs` with Node's test runner (Node 22 or newer).
- Portal note: `docs/sprints/PORTAL.md`.

Verify:

```
npm ci
npm test          # expect: tests 59, pass 59, fail 0
                  #   SP01-C01: 26, SP01-C02: 5, SP01-C03: 14, SP01-C04: 14
npm run build     # expect: dist/schema.sql: 2 migration(s)
npm run sprints   # expect: 14 sprints, 65 commits; SPRINTS.md unchanged
```

Verified by running: `npm ci`, `npm test` after each commit (26, then 31, then 45, then 59, all
passing; at SP01-C03, 13 of its tests fail without the fix migration), `npm run build`. The
registry test fails as expected when a commit is marked done with no tagged test.

CI on GitHub: verified at SP01-C04. The Pipeline run on `adam` passed (merge, check, build,
promote) and `test` and `review` moved to the merge.

### B2. `scripts/verify-remote.mjs` (SP01-C05, 8 Nov 2026)

Checks a real Supabase project for what `npm test` cannot see: row-level security and table
privileges as real users meet them through the REST API, and Realtime. No new dependency: it
uses Node 22's built-in `fetch` and `WebSocket`.

```
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_ANON_KEY=<anon key> npm run verify-remote
```

It signs in three anonymous users (owner, joiner, stranger), shares a two-task trip (task 2
needs task 1), then checks, each with its own PASS or FAIL line:

- join with the code; stranger gets `NOT_ALLOWED` from `get_trip` and `complete_task`;
- RLS reads: the participant sees the tasks (control), the stranger sees no rows in `trips`,
  `participants` or `tasks`;
- direct writes refused: stranger insert into `participants` and `tasks`, update and delete of a
  task, delete of the trip; the participant cannot set `completed` directly either (that would
  skip `complete_task`); then the trip is checked unchanged;
- `BLOCKED` for a task whose prerequisite is incomplete;
- Realtime: participant and stranger both subscribe to `tasks` filtered by the trip, as the app
  does; the owner completes task 1; the participant must get the `UPDATE`, the stranger must get
  nothing (it waits 3 s more after the participant's event);
- the dependent task then completes;
- cleanup, always (also after a failure): Realtime closed first, `stop_sharing`, then `get_trip`
  must say `NOT_ALLOWED`.

Exit 0 when every check passes, 1 when any fails, 2 when `SUPABASE_URL` or `SUPABASE_ANON_KEY`
is missing (no request is made). The anon key and user tokens are replaced with `<redacted>` in
the output. Each run leaves 3 anonymous users in Authentication > Users; their ids are printed.

Verified by running: `npm test` (79 tests, all passing; 20 are SP01-C05). The script's tests run
it against an in-memory fake Supabase (`tests/fake-supabase.mjs`): the fake that follows the
rules passes all 24 checks, and each broken rule (no `BLOCKED`, RLS leak, write privileges not
revoked, Realtime leak to the stranger, no Realtime events, refused channel join, `stop_sharing`
doing nothing, anonymous sign-ins off, network error mid-run) fails its check with exit 1. Two
deliberate defects in the script (refusals always passing, no redaction) each made tests fail.
`npm run verify-remote` with no variables exits 2.

Not verified: a run against a real Supabase project. Not run, because there are no credentials
yet. The REST and Auth request shapes follow PostgREST and Supabase Auth. The Realtime messages
(Phoenix protocol `vsn=1.0.0`, `phx_join` with `postgres_changes` and `access_token`, readiness
from the `system` message "Subscribed to PostgreSQL") follow the protocol the Supabase client
libraries use; they have not been tested against the live server. If the live run fails on the subscribe check alone, the
protocol details are the first suspect, not RLS.

## SQL review of `20261108000000_trip_sharing.sql`

### Fixed (new migration, tests first)

1. **Dependency cycles accepted.** `share_trip` checked that every prerequisite belongs to the
   trip, but not for cycles. A self-dependency, `1 <-> 2` or `1 -> 3 -> 2 -> 1` was stored, and
   every task on the cycle stayed `BLOCKED` forever. Now rejected with `DEPENDENCY_CYCLE`.
2. **Completion uploaded ahead of a prerequisite.** `share_trip` stored `completed: true` for a
   task whose prerequisite was `completed: false`. That skips the rule `complete_task` enforces.
   Now rejected with `BLOCKED`.
3. **Table privileges.** Supabase grants all privileges on new public tables to `anon` and
   `authenticated`. The migration revoked insert, update and delete only. `TRUNCATE` (which
   row-level security does not apply to), `REFERENCES` and `TRIGGER` stayed granted. The API
   does not expose them today; revoked anyway. The test setup now mimics Supabase's default grant.

### Checked, no change needed

- **Lock-free `complete_task`.** Prerequisites are read without locks. This is safe only because
  no code path sets `completed` back to false; a stale read can wrongly block, never wrongly
  allow. Any future "undo completion" function would break this and needs `for share` locks on
  the prerequisites.
- **Join cap.** `join_trip` locks the trip row with `for update` before counting, so concurrent
  joins cannot exceed 10. The owner counts toward the 10.
- **Calls without a session.** Functions are executable by `anon` (Postgres default). Each
  checks `auth.uid()`, ownership or participation, so they all fail without a session.
- **`security definer` with `search_path = public`.** Acceptable. The Supabase linter may
  suggest `search_path = ''` with qualified names.

### Weaknesses noted, not changed (see `QUESTIONS.md`)

- **Join code strength.** 6 hex characters (16.7 million codes) from `random()`, which is not a
  cryptographic generator, and no limit on wrong `join_trip` attempts. With a 10-minute expiry
  and few live codes, guessing is unlikely at this scale.
- **No size limits.** Title, nickname, task `data` and task count are unbounded. The free tier
  database is 500 MB. A null id, title or nickname gives a generic not-null error, not a code.
- **Task order.** `get_trip` builds `tasks` with `jsonb_agg` and no `order by`, so a joiner can
  see tasks in a different order than the owner.
- **Two key styles.** `complete_task` returns the raw row (`completed_by`, `completed_at`);
  `get_trip` returns camelCase (`completedBy`, `completedAt`). The Flutter client must handle
  both, or refetch with `get_trip` after completing.
- **`stop_sharing` is silent.** A non-owner or unknown trip id does nothing and raises nothing.
- **No leave or remove.** A participant cannot leave; the owner cannot remove anyone.
- **Join code visible to participants.** Row-level security lets participants read every
  column of `trips`, including `join_code`, so any participant can invite others.
- **Realtime deletes** (Supabase documentation, not verified). Delete events are not filtered by
  row-level security and cannot be filtered by column, so `stop_sharing` cascades may reach
  unfiltered subscribers as bare task ids, while filtered subscribers get nothing. Participants
  learn that sharing stopped only when `get_trip` raises `NOT_ALLOWED`.
- **Local tests run as a superuser.** Row-level security, grants as seen by real roles, and
  Realtime are not exercised by `npm test`. `scripts/verify-remote.mjs` (B2) covers them against
  the real project.
- `docs/GeoReminder_Sharing_Design.md` calls the migration `001_sharing.sql`; the file is
  `supabase/migrations/20261108000000_trip_sharing.sql`.

### B3. README (SP01-C06, 8 Nov 2026)

`README.md` now covers: contents of the repo, Node.js 22 (it said 20; `package.json` and CI need
22), every npm command, the Supabase dashboard setup (anonymous sign-ins, running
`dist/schema.sql`, the anonymous sign-in rate limit, which key to use and which never to use),
verify-remote in bash and PowerShell, the API table with every function and error code, free plan
limits, branches and rules.

`tests/readme.test.mjs` keeps it in step: every `npm run` command exists and every script is
documented, the Node version matches `engines`, no JWT, Supabase key or real project URL, every
error code raised in the migrations and every app function is in the tables, and every repo path
it mentions exists.

Verified by running: `npm test` (86 tests, all passing; 7 are SP01-C06). Against the previous
README, 4 of the 7 fail (missing scripts, Node 20, error codes, functions).

Not verified: the free plan limits and the default anonymous sign-in rate limit were not checked
on supabase.com on 8 Nov 2026; the README says to check the pricing page. The
dashboard menu names (Authentication > Sign In / Providers, Rate Limits, Project Settings > API
Keys) may have moved.

CI on GitHub: verified at SP01-C06 (9 Nov 2026). The Pipeline run on `adam` passed all four
jobs with 86 tests, and `test` and `review` moved to the merge `4e7daa6`.

### B4. Pipeline fast-forwards to the sprint commit (SP01-C07, 9 Nov 2026)

Adam's request: after a successful run, `test` and `review` should show the sprint commit, not
"Merge adam into test". The merge step always made a `--no-ff` merge commit. It is now
`.github/actions/merge-into/merge.mjs` (Node, no dependency; the runner's Node runs it):

- `test` is an ancestor of the push: fast-forward, so `test` and `review` are the pushed commit.
- the branches diverged (someone else's push landed first): a merge commit whose subject is the
  push's latest non-merge commit (`SP01-C07 ...`) and whose body is "Merge adam into test".
  Author and dates stay pinned, so the merge, check, build and promote jobs get the same SHA.
- conflicts: the same file list, step summary and annotations as before.

`adam` was fast-forwarded to `origin/test` first (`git merge --ff-only`, no new commit), so this
commit sits on top of `test` and its own pipeline run should fast-forward.

Verified by running: `npm test` (93 tests, all passing; 7 are SP01-C07), with `tests/merge-into.test.mjs` against throwaway
git repos (7 tests). Turning off the fast-forward failed 2 of them; going back to the old merge
name failed 2 others.

Verified on GitHub afterwards: pipeline run 42541702869 passed and `adam`, `test` and `review`
all point at 40b865f, the SP01-C07 commit itself (fast-forward, no merge commit).

SP01 is marked done: every commit in it is done. The live verify-remote run is still open (below).

## SP02 (app domain and local storage, Flutter repo)

This repo only holds the plan for it. The app's registry test reads `docs/sprints/sprints.json`
from `review` here, so push this repo before pushing the app.

All seven commits are done in the app repo, locally (not pushed yet):

- SP02-C01 registry: the app checks its tagged tests and commit subjects against this plan.
- SP02-C02 Trip, Task and Place models; JSON keys match what share_trip and get_trip use.
- SP02-C03 DependencyGraph: ready/blocked, next up, loop check for the picker, and the same
  consistency rules as share_trip.
- SP02-C04 TripRepository: one trips.json, temp file plus backup, recovery from the backup.
- SP02-C05 completion of solo tasks: blocked tasks refused, one-way, repeat is a no-op.
- SP02-C06 trip export/import file, versioned, with an upgrade chain.
- SP02-C07 the app pipeline uses the same merge script as this repo.

Verified by running in the app repo: `dart format`, `flutter analyze` and `flutter test`
(109 tests), and two injected defects per commit that each failed the tests. Verified on
GitHub: both pipelines ran merge, check, build and promote to review (this repo at 9180f8d, the
app at 7e600dd). No older trip file version exists yet, so the upgrade chain is tested with
made-up older versions.

## SP03 (0.3.0 app shell, trips and suggested order, Flutter repo)

Screens S05, S05s, S06, S07, S07s, S08, S11. All six commits are done in the app repo, locally
(not pushed yet):

- SP03-C01 app shell: light and dark Material 3 themes made from the design tokens (a test
  checks every token against the design sheet), app state on ChangeNotifier with no package,
  bottom navigation Trips / Map / Calendar / Settings; back on another tab returns to Trips.
- SP03-C02 home trip list: Active / Upcoming / History, trip cards with progress, History
  cards, and the loading, empty and error states. Trips get an optional `finishedAt`
  (History). New app dependency: path_provider, for the app's private documents folder.
- SP03-C03 trip form (New trip / Edit trip): title required and up to 40 characters, date from
  the Material date picker (new trips start on today), optional notes. Close leaves without
  saving; editing keeps the tasks and unknown fields; a failed save keeps the form open. Home
  gets the New trip button. The repeat part of "Date and repeat" waits for S13 (SP09).
- SP03-C04 trip details: progress, task cards (done, Next up, locked, open) and a task sheet
  with Complete. A locked task shows "Complete <name> first", cannot be completed (screen and
  controller both refuse, nothing is saved) and offers Go to. Finish trip when all tasks are
  done moves the trip to History, which is read-only. Menu: Edit and Delete (asks first).
- SP03-C05 task form (Add task / Edit task): title, place, radius 50 to 500 m, Arrive / Leave /
  Both, Depends on, notes. The Depends on chips hide every task that already waits for this
  one, and the controller refuses to save a loop. The task sheet gets Edit task and Delete
  task; deleting a task frees the tasks that waited for it. Until the map picker (SP04-C02)
  the place is typed in as a name, latitude and longitude.
- SP03-C06 suggested order (S11): a distance-only route provider (straight-line haversine
  distance; nothing estimates time). The order walks to the nearest task that can be done
  next, tries each possible first stop and keeps the shortest walk, so a task never comes
  before a task it waits for. Use this order saves it with the done tasks first; Keep my
  order changes nothing. Offered from trip details when two or more tasks are left. The map
  strip above the list comes with the map (SP04).

Verified by running in the app repo: `dart format`, `flutter analyze`, `flutter test`
(221 tests), and injected defects per commit that each failed the tests. Not run yet: the app
on a phone or emulator, and the pipelines on GitHub for these commits.

## Next

- Live run of `npm run verify-remote` against the real project (needs the project URL and anon
  key from Adam).
