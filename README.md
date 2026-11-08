# GeoReminder backend

Backend for GeoReminder, a location-reminder app with trips and task dependencies (Birzeit
University graduation project, COMP4200, Spring 2025/2026, Project No. 005). The Flutter app lives
in [GeoReminder-flutter](https://github.com/methan6427/GeoReminder-flutter).

Supabase (Postgres, anonymous sign-in, Realtime), kept as code: SQL migrations in
`supabase/migrations` and tests in `tests`. There is no server; the app calls Supabase directly.
Node.js is used only to run the tests.

Its job: store shared trips only (trips stay on the device unless shared), sync task
completion between participants, and refuse to complete a task whose dependency is not complete.

## Branches

```
adam | mohammad | hammam  --auto-->  test  --auto-->  review  --PR (Adam)-->  main
```

Push to your personal branch. The **Pipeline** workflow merges the push into `test`, runs
`check` (`npm test`) and `build` (`dist/schema.sql`) on the merged code, and only if both pass
moves `test` and `review` to that merge. A conflict or a failure changes nothing and GitHub emails
you. Adam merges `review` into `main`.

## Rules

1. Never push to `test`, `review` or `main`. The pipeline moves `test` and `review`.
2. On a merge conflict: `git fetch origin && git merge origin/test` on your branch, resolve,
   push again.
3. One feature per PR. Merge commits only. Never delete `test`, `review` or `main`.
4. Never commit keys, service-account files, `.env` files or tokens.

## Build and run

Needs Node.js 20 or newer.

```
npm ci          # install the test dependency (PGlite, an in-process Postgres)
npm test        # run the SQL tests
npm run build   # write dist/schema.sql (all migrations in order)
```

## Setup after cloning

Enable the repo's git hooks once per clone:

```
git config core.hooksPath .githooks
```

They refuse direct pushes to `main`, `test` and `review`, and commit messages with a
`Co-authored-by` trailer or tool attribution. Coding agents follow `AGENTS.md`.
