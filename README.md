# GeoReminder backend

Backend for GeoReminder, a location-reminder app with trips and task dependencies (Birzeit
University graduation project, COMP4200, Spring 2025/2026, Project No. 005). The Flutter app lives
in [GeoReminder-flutter](https://github.com/methan6427/GeoReminder-flutter).

This repository is empty on purpose. The backend technology has not been chosen yet.

Its job, once chosen: store shared trips only (trips stay on the device unless shared), sync task
completion between participants, and refuse to complete a task whose dependency is not complete.

## Branches

```
adam | mohammad | hammam  --PR-->  test  --PR-->  review  --PR-->  main
```

Adam merges `review` into `main`.

## Rules

1. Never push to `test`, `review` or `main`. Only pull requests.
2. Merge the target branch into your personal branch before opening a PR.
3. One feature per PR. Merge commits only. Never delete `test`, `review` or `main`.
4. Never commit keys, service-account files, `.env` files or tokens.

## Setup after cloning

Enable the repo's git hooks once per clone:

```
git config core.hooksPath .githooks
```

They refuse direct pushes to `main`, `test` and `review`, and commit messages with a
`Co-authored-by` trailer or tool attribution. Coding agents follow `AGENTS.md`.
