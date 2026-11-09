# GeoReminder backend

Backend for GeoReminder, a location-reminder app with trips and task dependencies (Birzeit
University graduation project, COMP4200, Spring 2025/2026, Project No. 005). The Flutter app lives
in [GeoReminder-flutter](https://github.com/methan6427/GeoReminder-flutter).

The backend is a Supabase project (Postgres, anonymous sign-in, Realtime) kept as code: SQL
migrations in `supabase/migrations` and tests in `tests`. There is no server. The app calls
Supabase directly. Node.js is used only for tests and tooling.

Its job is small:

- store a trip only when its owner shares it (trips stay on the phone otherwise);
- let up to 10 people join a shared trip with a short code;
- sync task completion between participants;
- refuse to complete a task while one of its prerequisites is incomplete.

Design and reasoning: [docs/GeoReminder_Sharing_Design.md](docs/GeoReminder_Sharing_Design.md).
Sprint plan: [docs/sprints/SPRINTS.md](docs/sprints/SPRINTS.md). Progress and verification
notes: [PROGRESS.md](PROGRESS.md). Open questions: [QUESTIONS.md](QUESTIONS.md).

## Contents

```
supabase/migrations/   SQL migrations, applied in filename order (never edit an applied one)
tests/                 npm test: SQL tests (PGlite), bundler, sprint registry, verify-remote
scripts/               bundle-migrations.mjs, sprints.mjs, verify-remote.mjs
docs/                  sharing design, diagrams, Dart client sketch, sprint plan
.github/workflows/     ci.yml (check, build) and pipeline.yml (adam/mohammad/hammam -> test -> review)
.githooks/             pre-push and commit-msg hooks
```

## Requirements

Node.js 22 or newer (the tests use Node's test runner, and verify-remote uses the built-in
`fetch` and `WebSocket`). Nothing else is needed for the tests: Postgres runs in the test process
through PGlite.

## Commands

```
npm ci                 # install the one dev dependency (@electric-sql/pglite)
npm test               # every test: SQL rules, bundler, sprint plan registry, verify-remote (offline)
npm run build          # write dist/schema.sql: all migrations in order, one file
npm run sprints        # rewrite docs/sprints/SPRINTS.md after editing docs/sprints/sprints.json
npm run verify-remote  # check a real Supabase project (needs SUPABASE_URL and SUPABASE_ANON_KEY)
```

`npm test` runs as a Postgres superuser with no Supabase around it, so it does not exercise
row-level security as real users meet it, table privileges through the API, or Realtime.
`npm run verify-remote` covers those against a real project.

## Setting up the Supabase project

Done once, by hand, in the Supabase dashboard (free plan). Only the project owner can do this.

1. Create a project at [supabase.com](https://supabase.com) on the free plan.
2. **Authentication > Sign In / Providers**: turn on **Allow anonymous sign-ins**. The app signs
   every user in anonymously and asks only for a nickname.
3. **SQL Editor**: run `npm run build` and paste `dist/schema.sql` (or download it from the
   `georeminder-schema-sql` artifact of a CI run), then run it. It contains every migration in
   order. On a project that already has the earlier migrations, run only the new files from
   `supabase/migrations`, in filename order.
4. **Authentication > Rate Limits**: raise the limit for anonymous sign-ins. The default is low
   (30 per hour per IP address when this was written), and a class demo where everyone joins from
   the same Wi-Fi shares one IP address.
5. **Project Settings > API Keys**: copy the **publishable** key (`sb_publishable_...`, it
   replaced the legacy `anon` key; a legacy `anon` key also works). The project URL is
   `https://<project-ref>.supabase.co`, with the project ref (Project ID) from
   **Settings > General**. The app and verify-remote need both. Never use a secret key
   (`sb_secret_...`, or the legacy `service_role` key) in the app, a script in this repo or a
   commit.

Realtime needs no dashboard step: the first migration adds `tasks` to the `supabase_realtime`
publication.

## Checking a real project

Put both values in `.env` (ignored by git) and run the script with Node's `--env-file`:

```
# .env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable key>

# bash or PowerShell
node --env-file=.env scripts/verify-remote.mjs
```

Or set them in the shell for one run:

```
# bash
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_ANON_KEY=<publishable key> npm run verify-remote

# PowerShell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"; $env:SUPABASE_ANON_KEY = "<publishable key>"; npm run verify-remote
```

The variable keeps its old name, `SUPABASE_ANON_KEY`; it takes the publishable key. The key is
sent only in the `apikey` header, so the new non-JWT keys work.

It signs in three anonymous users (owner, joiner, stranger), shares a two-task trip and prints
PASS or FAIL for each check:

- the joiner joins with the code; the stranger gets `NOT_ALLOWED` from `get_trip` and
  `complete_task`;
- row-level security: the participant can read the tasks, the stranger sees no rows in `trips`,
  `participants` or `tasks`;
- direct table writes are refused for the stranger, and for the participant too (writing
  `completed` directly would skip the dependency rule);
- `complete_task` raises `BLOCKED` while a prerequisite is incomplete;
- Realtime: the participant receives the change, the stranger receives nothing;
- cleanup: the trip is unshared at the end, also after a failure.

Exit code 0 means every check passed, 1 means at least one failed, and 2 means a variable is
missing. The key and the users' tokens are never printed. Each run leaves three anonymous users
in **Authentication > Users**. Their ids are printed so you can delete them.

The publishable key is meant to be public (it ships inside the app), but keep it out of the repo anyway:
set it in the shell, or in a `.env` file, which `.gitignore` already excludes.

## The API the app calls

Clients cannot write to the tables. Every change goes through these functions (called as RPCs).
Participants can read their own trips' rows directly. Everyone else sees nothing.

| Function | Who | What |
|---|---|---|
| `share_trip(p_trip jsonb, p_nickname text)` | signed-in user | Uploads a local trip once and returns a 6-character join code (valid 10 minutes). |
| `refresh_join_code(p_trip uuid)` | owner | Returns a fresh 10-minute code. |
| `join_trip(p_code text, p_nickname text)` | signed-in user | Joins (at most 10 people per trip) and returns the trip snapshot. |
| `get_trip(p_trip uuid)` | participant | Full snapshot: title, owner, participants, tasks. |
| `complete_task(p_task uuid)` | participant | Completes a task if every prerequisite is complete. Completing it again returns it unchanged. |
| `stop_sharing(p_trip uuid)` | owner | Deletes the shared copy. Each phone keeps its local trip. |

Error codes the app should handle (the exception message):

| Code | Raised by | Meaning |
|---|---|---|
| `NOT_SIGNED_IN` | `share_trip`, `join_trip` | No session. |
| `ALREADY_SHARED` | `share_trip` | This trip id is already shared. |
| `BAD_DEPENDENCY` | `share_trip` | A prerequisite is not a task of this trip. |
| `DEPENDENCY_CYCLE` | `share_trip` | Prerequisites form a cycle (including a task that needs itself). |
| `BLOCKED` | `share_trip`, `complete_task` | A prerequisite is incomplete. |
| `NOT_OWNER` | `refresh_join_code` | Only the owner may do this. |
| `NOT_ALLOWED` | `get_trip`, `complete_task` | Not a participant, or the trip or task does not exist (also after `stop_sharing`). |
| `INVALID_OR_EXPIRED_CODE` | `join_trip` | Wrong or expired code. |
| `TRIP_FULL` | `join_trip` | The trip already has 10 participants. |

Realtime: subscribe to `postgres_changes` on `public.tasks` with the filter `trip_id=eq.<trip
id>`, and on any event call `get_trip` and replace the local copy. Known gaps (task order,
the two key styles `completed_by` / `completedBy`, delete events) are listed in
[PROGRESS.md](PROGRESS.md).

## Free plan limits

These are the free-plan limits that matter here, as listed on
[supabase.com/pricing](https://supabase.com/pricing) when this was written. Check there before
relying on them.

- 500 MB database. Trips, tasks and nicknames have no size limit yet (see `QUESTIONS.md`).
- The project is **paused after a week without activity**. Resume it in the dashboard before a
  demo.
- 50,000 monthly active users, 200 concurrent Realtime connections, 2 million Realtime messages
  per month.
- 2 active free projects per account.

## Branches

```
adam | mohammad | hammam  --auto-->  test  --auto-->  review  --PR (Adam)-->  main
```

Push to your personal branch. The **Pipeline** workflow brings the push onto `test`, runs
`check` (`npm test`) and `build` (`dist/schema.sql`) on the result, and only if both pass moves
`test` and `review` to it. A conflict or a failure changes nothing and GitHub emails you. Adam
merges `review` into `main` by hand. That merge releases a sprint's version.

When `test` has nothing your branch lacks, `test` and `review` fast-forward to your commit, so
they show it (`SP01-C07 ...`) with no merge commit. When someone else's work landed first, the
pipeline makes a merge commit named after your latest commit, with "Merge adam into test" in its
body. To keep fast-forwards, start each piece of work from the latest `test`:

```
git fetch origin && git merge --ff-only origin/test
```

(The logic is in `.github/actions/merge-into/merge.mjs`, tested by `tests/merge-into.test.mjs`.)

## Rules

1. Never push to `test`, `review` or `main`. The pipeline moves `test` and `review`.
2. On a merge conflict: `git fetch origin && git merge origin/test` on your branch, resolve,
   push again.
3. One feature per PR. Merge commits only. Never delete `test`, `review` or `main`.
4. Never commit keys, service-account files, `.env` files or tokens.
5. Never edit a migration that has been applied. Fix it in a new migration, with a failing test
   first.
6. Commit subjects start with the commit's ID from `docs/sprints/sprints.json`
   (`SP01-C03 reject dependency cycles ...`), and each test the commit adds starts its name with
   the ID in brackets (`[SP01-C03] ...`). `npm test` fails if a commit marked done has no tagged
   test.

## Setup after cloning

Enable the repo's git hooks once per clone:

```
git config core.hooksPath .githooks
```

They refuse direct pushes to `main`, `test` and `review`, and commit messages with a
`Co-authored-by` trailer or tool attribution. Coding agents follow `AGENTS.md`.
