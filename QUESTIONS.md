# Questions for Adam

Each question has the default that was used, so work did not stop. Answer by editing this file
or in the session.

1. **Spring Boot scaffold removed.** You said the backend can be any language and that Supabase
   and Flutter are required. The prompt says no server, so the empty Spring app, Maven wrapper and
   Java CI steps were removed in one commit (`SP01-C02`). Default: removed. Undo by
   reverting that commit.
2. **`AGENTS.md` updated.** Sections on the stack and backend scope now describe Supabase (it
   said Spring Boot, database undecided). The rules on `main`, attribution and branch flow are
   unchanged. Default: keep the update.
3. **Join code hardening.** Use `gen_random_bytes` (pgcrypto) instead of `random()`, and/or
   limit wrong `join_trip` attempts per user? Default: unchanged for now. The risk is low at this
   scale.
4. **Input limits.** Add limits (for example title and nickname of 1 to 60 characters, at most
   100 tasks per trip, a size cap on task data) with clear error codes? Default: none yet.
5. **Task order on shared trips.** `get_trip` returns tasks in no fixed order. Should the app
   send a `position` field inside each task's data, with `get_trip` sorting by it? Default: the
   app sorts locally, no server change.
6. **Leaving a shared trip.** No `leave_trip` and no way for the owner to remove a participant.
   Needed for the first release? Default: not built (out of scope).
7. **`stop_sharing` errors.** Should it raise `NOT_OWNER` for a non-owner instead of doing
   nothing? Default: unchanged.
8. **Enforce commit IDs in the hook?** `.githooks/commit-msg` could reject a subject that does
   not start with `SPnn-Cnn`. That would also apply to Muhammad's and Hammam's commits.
   Default: not enforced. `npm test` already rejects an ID that is not in `sprints.json`.
9. **Sprint plan.** `docs/sprints/SPRINTS.md` lists 14 sprints. Change the order, merge sprints
   or move screens by editing `sprints.json`. Two items in it are still open: the free source for
   road distances (SP11) and iOS (SP14), which needs a Mac to test and a paid Apple account to
   distribute. Default: plan as written, iOS last.
10. **Where the plan lives.** `sprints.json` is in this repo because it is public, so the portal
    can read it without a key. App commits are marked done here too. Default: keep it here.
