# Sprints dashboard for the project portal

Note for Adam: how to add a sprints dashboard to the portal (`georeminder-site`). Nothing in the
portal has been changed.

## Data source

The plan is `docs/sprints/sprints.json` in this repo. The repo is public, so the portal can read
it in the browser with no key and no build step:

```
https://raw.githubusercontent.com/methan6427/GeoReminder-backend/review/docs/sprints/sprints.json
```

- Use the `review` branch: it only ever holds commits that passed CI. Switch to `main` once the
  first `review` -> `main` merge exists. `adam` would show unreviewed work.
- raw.githubusercontent.com sends `Access-Control-Allow-Origin: *`, so `fetch` works from the
  Vercel page. GitHub caches raw files for a few minutes, so an update can take that long to show.
- If the fetch fails (offline, rate limit), show a short message instead of an empty board, or keep
  a copy of the file next to `index.html` as a fallback.

## Format (`schemaVersion: 1`)

```
{
  "schemaVersion": 1,
  "project": "GeoReminder",
  "repos":   { "backend": "<url>", "flutter": "<url>" },
  "sprints": [
    {
      "id":      "SP01",              // SP01, SP02, ... no gaps
      "version": "0.1.0",             // the version Adam releases when the sprint is done
      "title":   "Backend foundation",
      "goal":    "one sentence",
      "status":  "planned | in-progress | done",
      "screens": ["S05", "S20b"],     // design screen IDs already used in the portal
      "commits": [
        {
          "id":     "SP01-C01",       // sprint ID + C01, C02, ...
          "repo":   "backend | flutter",
          "status": "planned | in-progress | done",
          "title":  "what the commit does",
          "tests":  "what its unit tests cover"
        }
      ]
    }
  ]
}
```

`npm test` in this repo rejects a file that breaks these rules, so the portal can trust the
shape. A sprint's `status` always agrees with its commits (all done = done, none started =
planned, otherwise in-progress).

## Suggested dashboard

- One card per sprint: ID, `v` + version, title, status, a progress bar of done commits out of
  all commits, and the screens as chips that jump to the matching screen in the design showcase.
- Expanding a card lists its commits: ID, repo, status, title and the tests line.
- Link a commit ID to a GitHub search of that repo's history, for example
  `https://github.com/methan6427/GeoReminder-backend/commits/review?search=SP01-C03`
  (the app repo is private, so those links only work for the team).

Minimal loader:

```js
const URL = 'https://raw.githubusercontent.com/methan6427/GeoReminder-backend/review/docs/sprints/sprints.json';
const plan = await fetch(URL, { cache: 'no-store' }).then((r) => r.json());
for (const s of plan.sprints) {
  const done = s.commits.filter((c) => c.status === 'done').length;
  console.log(`${s.id} v${s.version} ${s.title}: ${done}/${s.commits.length} (${s.status})`);
}
```

## Keeping it current

Whoever finishes a commit sets its `status` to `done` in `sprints.json` in that same commit, then
runs `npm run sprints` to refresh `SPRINTS.md`. App-repo commits are marked here too, in a
backend commit, because this file is the single plan for both repos.
