# Sprints

<!-- Generated from sprints.json by `npm run sprints`. Edit sprints.json, not this file. -->

Each sprint is one version. When a sprint is done and has passed `test` and `review`, Adam
merges `review` into `main` and releases that version by hand.

Each commit has an ID, `SPnn-Cnn`. The commit subject starts with it
(`SP01-C03 reject dependency cycles ...`) and every unit test added by that commit starts its
name with it in brackets (`[SP01-C03] a direct cycle is rejected`). `npm test` fails if a commit
marked done in this repo has no test with its ID. Screen IDs (`S05`, `S20b`) are the design
screens in the project portal.

| Sprint | Version | Title | Status | Commits |
| --- | --- | --- | --- | --- |
| SP01 | v0.1.0 | Backend foundation | in-progress | 5/6 |
| SP02 | v0.2.0 | App domain and local storage | planned | 0/6 |
| SP03 | v0.3.0 | App shell, trips and suggested order | planned | 0/6 |
| SP04 | v0.4.0 | Map and places | planned | 0/5 |
| SP05 | v0.5.0 | Geofencing and reminders | planned | 0/5 |
| SP06 | v0.6.0 | Trip Mode | planned | 0/4 |
| SP07 | v0.7.0 | Identity and sharing | planned | 0/6 |
| SP08 | v0.8.0 | Shared completion and offline queue | planned | 0/4 |
| SP09 | v0.9.0 | Calendar and repeating trips | planned | 0/4 |
| SP10 | v0.10.0 | History and export or import | planned | 0/3 |
| SP11 | v0.11.0 | Road distance | planned | 0/3 |
| SP12 | v0.12.0 | Settings, legal and data deletion | planned | 0/5 |
| SP13 | v1.0.0 | First run and release | planned | 0/5 |
| SP14 | v1.1.0 | iOS | planned | 0/3 |

## SP01 v0.1.0: Backend foundation

Sharing schema on Supabase, tested in CI, with a script to check a real project.

Status: in-progress.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP01-C01 | backend | done | Add Supabase sharing migration, SQL tests and design docs | Share, join, cap of 10, code expiry, dependency rule in complete_task, stop_sharing. |
| SP01-C02 | backend | done | Replace the Spring Boot scaffold with Supabase-as-code | Migration bundler: order, headers, unchanged bodies, exit codes. |
| SP01-C03 | backend | done | Reject dependency cycles and early completions in share_trip | Self, direct and indirect cycles, diamond accepted, early completion rejected, table privileges. |
| SP01-C04 | backend | done | Add sprint plan and per-commit test registry | Plan is valid; every done commit has tests tagged with its ID; SPRINTS.md matches the plan. |
| SP01-C05 | backend | done | Add verify-remote script for a real Supabase project | Offline unit tests of the script's checks; the live run needs Adam's project URL and anon key. |
| SP01-C06 | backend | planned | Write the backend README | README lists the commands that exist in package.json and contains no keys. |

## SP02 v0.2.0: App domain and local storage

Trips and tasks with prerequisites, saved on the phone, no UI yet.

Status: planned.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP02-C01 | flutter | planned | Add commit-ID test registry to the app repo | Every done app commit in the plan has a test whose name starts with its ID. |
| SP02-C02 | flutter | planned | Add Trip, Task and Place models with JSON round-trip | Round-trip, unknown fields kept, bad input rejected. |
| SP02-C03 | flutter | planned | Add DependencyGraph with cycle detection | Ready and blocked tasks, self, direct and indirect cycles, diamond. |
| SP02-C04 | flutter | planned | Add TripRepository with atomic writes and corrupt-file recovery | Save and load, interrupted write keeps the old file, corrupt file recovered from backup. |
| SP02-C05 | flutter | planned | Add TaskCompletionService for solo trips | Blocked task cannot be completed; completion is one-way and idempotent. |
| SP02-C06 | flutter | planned | Add versioned trip export and import format | Export then import gives the same trips; older format versions upgrade; bad files rejected. |

## SP03 v0.3.0: App shell, trips and suggested order

Create trips and tasks in the app and see a suggested visiting order.

Status: planned. Screens: S05, S05s, S06, S07, S07s, S08, S11.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP03-C01 | flutter | planned | Add app shell: state management, theme and bottom navigation | Widget test of navigation between tabs; theme tokens match the design system. |
| SP03-C02 | flutter | planned | Add home trip list with empty, loading and error states | Widget tests for each state. |
| SP03-C03 | flutter | planned | Add create and edit trip form | Validation, save, cancel. |
| SP03-C04 | flutter | planned | Add trip details with locked-task state | A locked task shows 'Complete <name> first' and cannot be ticked. |
| SP03-C05 | flutter | planned | Add task form with a prerequisite picker that rejects cycles | Picker hides choices that would make a cycle. |
| SP03-C06 | flutter | planned | Add straight-line route provider and suggested order | Haversine distances, order respects prerequisites, distance only. |

## SP04 v0.4.0: Map and places

Pick places on a free map and search addresses.

Status: planned. Screens: S09, S10, S15, S15s.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP04-C01 | flutter | planned | Add OpenStreetMap map widget with attribution | Widget test that attribution is always shown. |
| SP04-C02 | flutter | planned | Add place picker | Tap and drag set the place; radius is clamped. |
| SP04-C03 | flutter | planned | Add address search within the Nominatim usage policy | At most one request per second, identifying User-Agent, results cached (fake HTTP client). |
| SP04-C04 | flutter | planned | Add frequent places | Save, rename, delete, reuse in a task. |
| SP04-C05 | flutter | planned | Add trip map with task pins and states | Pin state follows task state (ready, locked, done). |

## SP05 v0.5.0: Geofencing and reminders

The phone reminds you when you arrive near a task.

Status: planned. Screens: S03a, S03b, S03d, S16a, S16b, S17.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP05-C01 | flutter | planned | Add permission screens for location, notifications and battery | Each permission state (granted, denied, permanently denied) leads to the right screen. |
| SP05-C02 | flutter | planned | Add geofence service with region-limit handling | Nearest ready tasks are registered first when over the platform limit (fake geofence API). |
| SP05-C03 | flutter | planned | Add arrival notification and full-screen alert | Entering a region of a ready task notifies once. |
| SP05-C04 | flutter | planned | Add blocked dialog for arriving at a locked task | Arriving at a locked task names the prerequisite. |
| SP05-C05 | flutter | planned | Re-register geofences after reboot and app update | Restore from storage registers the same regions. |

## SP06 v0.6.0: Trip Mode

A focused driving screen with spoken prompts. No ETA or trip duration.

Status: planned. Screens: S03c, S18, S19.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP06-C01 | flutter | planned | Add trip status state machine | Allowed and rejected transitions between planned, active, paused and finished. |
| SP06-C02 | flutter | planned | Add Trip Mode screen with next task and distance | Shows next ready task and straight-line distance; never shows a time estimate. |
| SP06-C03 | flutter | planned | Add spoken prompts | Prompt text per event (fake text-to-speech). |
| SP06-C04 | flutter | planned | Offer Trip Mode when the phone connects to the car | Car connect event shows the prompt once per trip (fake Bluetooth). |

## SP07 v0.7.0: Identity and sharing

Share a trip with a code and join someone else's trip.

Status: planned. Screens: S04, S20a, S20b, S20c, S20s, S21, S21s, S23.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP07-C01 | flutter | planned | Configure the Supabase client from build-time defines | Missing URL or key gives a clear error; nothing is read from files in git. |
| SP07-C02 | flutter | planned | Add anonymous sign-in and nickname | Nickname validation; session reused on restart (fake client). |
| SP07-C03 | flutter | planned | Add share trip flow and join code screen | share_trip payload matches the local trip; server errors map to messages. |
| SP07-C04 | flutter | planned | Add join by code | Code normalised; INVALID_OR_EXPIRED_CODE and TRIP_FULL shown as messages. |
| SP07-C05 | flutter | planned | Add stop sharing and the share error screen | Stop sharing keeps the local trip; NOT_ALLOWED after stop is handled. |
| SP07-C06 | backend | planned | Apply the answers in QUESTIONS.md in a new migration | SQL tests for whatever is decided (input limits, task order, leave_trip). |

## SP08 v0.8.0: Shared completion and offline queue

Everyone on a shared trip sees completions live, also after being offline.

Status: planned. Screens: S22.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP08-C01 | flutter | planned | Add shared trip details from get_trip | Snapshot mapped to the local model, both key styles accepted. |
| SP08-C02 | flutter | planned | Complete shared tasks through complete_task | BLOCKED shown as the locked-task message; repeat completion is harmless. |
| SP08-C03 | flutter | planned | Add live task updates | Incoming change updates one task; unknown task triggers a refetch (fake channel). |
| SP08-C04 | flutter | planned | Add offline completion queue with retry | Queued while offline, sent once online, kept across restart, dropped on NOT_ALLOWED. |

## SP09 v0.9.0: Calendar and repeating trips

Plan trips on dates and repeat them.

Status: planned. Screens: S12, S13.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP09-C01 | flutter | planned | Add repeat rules with next-occurrence calculation | Daily, weekly, monthly, end of month, time zone changes. |
| SP09-C02 | flutter | planned | Add calendar screen | Trips appear on the right days, including repeats. |
| SP09-C03 | flutter | planned | Add schedule sheet | Pick date, time and repeat; validation. |
| SP09-C04 | flutter | planned | Add date reminders for scheduled trips | Reminder scheduled and cancelled with the trip (fake notifications). |

## SP10 v0.10.0: History and export or import

See finished trips and move data between phones.

Status: planned. Screens: S14, S14b, S24.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP10-C01 | flutter | planned | Add history list | Finished trips listed newest first; filters. |
| SP10-C02 | flutter | planned | Add history details | Shows completed tasks with who and when completed them. |
| SP10-C03 | flutter | planned | Add export and import screen | Import preview, duplicate trips handled, bad file message. |

## SP11 v0.11.0: Road distance

Suggested order by road distance from a free source, straight line as fallback.

Status: planned. Screens: S11.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP11-C01 | flutter | planned | Add road-distance route provider | Distance matrix parsed; order respects prerequisites (fake HTTP client). Source still to be decided. |
| SP11-C02 | flutter | planned | Fall back to straight-line distance on error or offline | Timeout, error and offline all fall back without blocking the UI. |
| SP11-C03 | flutter | planned | Cache road distances and limit requests | Same places reuse the cache; request rate stays within the source's limits. |

## SP12 v0.12.0: Settings, legal and data deletion

Settings, terms, privacy, delete all data, about.

Status: planned. Screens: S25, S26, S27, S28, S29, S30.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP12-C01 | flutter | planned | Add settings screen | Each setting saved and applied. |
| SP12-C02 | flutter | planned | Add terms, privacy and accounts-later screens | Screens open from settings and first run. |
| SP12-C03 | backend | planned | Add delete_my_data function | Owner trips removed, participation removed, other users' data untouched. |
| SP12-C04 | flutter | planned | Add delete all data | Local files, geofences, notifications and the cloud record are removed. |
| SP12-C05 | flutter | planned | Add about screen with licences and map attribution | Version shown; OpenStreetMap attribution present. |

## SP13 v1.0.0: First run and release

Splash and welcome, final design pass, release build for Android.

Status: planned. Screens: S01, S02.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP13-C01 | flutter | planned | Add splash and welcome screens | First run shows welcome once; later runs go to home. |
| SP13-C02 | flutter | planned | Accessibility pass | Semantics labels on all actions; layouts hold at large text sizes. |
| SP13-C03 | flutter | planned | Match every screen state to the design | Golden tests for the main screens. |
| SP13-C04 | flutter | planned | Set release app ID, icon and version | Version in the app matches the sprint version. |
| SP13-C05 | flutter | planned | Add end-to-end smoke test | Create trip, add dependent tasks, complete in order, history. |

## SP14 v1.1.0: iOS

Run on iPhone. Testing on devices needs a Mac; App Store or TestFlight needs a paid Apple account.

Status: planned.

| Commit | Repo | Status | Change | Unit tests |
| --- | --- | --- | --- | --- |
| SP14-C01 | flutter | planned | Add iOS permission texts and background modes | Info.plist keys present (checked in a test). |
| SP14-C02 | flutter | planned | Adapt geofencing and notifications for iOS | Platform-specific limits handled (fake platform). |
| SP14-C03 | flutter | planned | Add iOS build to CI | Debug build without signing passes on a macOS runner. |
