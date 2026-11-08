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

Not verified: CI on GitHub. It cannot run locally. `ci.yml` does not run on push by itself:
`pipeline.yml` runs on a push to `adam`, `mohammad` or `hammam` and calls `ci.yml` (`check`,
then `build`). `ci.yml` also runs on pull requests into `test`, `review` and `main`. Confirm on
the first push that both jobs go green.

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

## In progress

Nothing. Waiting for "next".

## Next

- SP01-C05 (B2): `scripts/verify-remote.mjs` (two anonymous users plus a stranger, join,
  `BLOCKED`, RLS, Realtime, cleanup). Not run without credentials.
- SP01-C06 (B3): full README (Supabase setup, tests, verify-remote, free-tier limits).
