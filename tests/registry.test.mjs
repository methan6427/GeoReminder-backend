// Ties the sprint plan (docs/sprints/sprints.json) to the tests and the git history:
// every commit marked done in this repo needs at least one test named with its ID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPlan, validatePlan, renderMarkdown, allCommits, markdownFile } from '../scripts/sprints.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'tests');
const plan = loadPlan();
const byId = new Map(allCommits(plan).map((c) => [c.id, c]));

// IDs used as test-name tags: "[SPnn-Cnn] ..." in a test name, or commitId = 'SPnn-Cnn' in
// sharing.test.mjs, which runs its checks in sequence and tags them through that variable.
const tagged = new Map();
for (const f of fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.mjs'))) {
  const src = fs.readFileSync(path.join(testsDir, f), 'utf8');
  for (const m of src.matchAll(/\[(SP\d{2}-C\d{2})\]|commitId = '(SP\d{2}-C\d{2})'/g)) {
    const id = m[1] ?? m[2];
    tagged.set(id, [...(tagged.get(id) ?? []), f]);
  }
}

// A small valid plan; each test below breaks one thing in a copy of it.
const sample = () => ({
  schemaVersion: 1,
  sprints: [
    { id: 'SP01', version: '0.1.0', title: 'One', goal: 'g', status: 'in-progress', screens: ['S05', 'S03a'],
      commits: [{ id: 'SP01-C01', repo: 'backend', status: 'done', title: 't', tests: 'x' },
                { id: 'SP01-C02', repo: 'flutter', status: 'planned', title: 't', tests: 'x' }] },
    { id: 'SP02', version: '0.2.0', title: 'Two', goal: 'g', status: 'planned', screens: [],
      commits: [{ id: 'SP02-C01', repo: 'flutter', status: 'planned', title: 't', tests: 'x' }] },
  ],
});
const errorsAfter = (change) => { const p = sample(); change(p); return validatePlan(p).join('\n'); };

test('[SP01-C04] the sprint plan is valid', () => {
  assert.deepEqual(validatePlan(plan), []);
});

test('[SP01-C04] every done backend commit has a test named with its ID', () => {
  const missing = allCommits(plan).filter((c) => c.repo === 'backend' && c.status === 'done' && !tagged.has(c.id));
  assert.deepEqual(missing.map((c) => c.id), []);
});

test('[SP01-C04] every ID used in a test name is a backend commit in the plan', () => {
  for (const [id, files] of tagged) {
    assert.ok(byId.has(id), `${id} (in ${files.join(', ')}) is not in sprints.json`);
    assert.equal(byId.get(id).repo, 'backend', `${id} is planned for the app repo, not this one`);
  }
});

test('[SP01-C04] a commit tagged in tests is marked done or in progress', () => {
  for (const id of tagged.keys()) assert.notEqual(byId.get(id)?.status, 'planned', `${id} has tests but is marked planned`);
});

test('[SP01-C04] SPRINTS.md is up to date with sprints.json (run npm run sprints)', () => {
  assert.equal(fs.readFileSync(markdownFile, 'utf8').replaceAll('\r\n', '\n'), renderMarkdown(plan));
});

test('[SP01-C04] commit subjects that start with an ID name a backend commit in the plan', (t) => {
  const r = spawnSync('git', ['log', '--format=%s'], { cwd: root });
  if (r.status !== 0) return t.skip('not a git checkout');
  for (const subject of r.stdout.toString().split('\n')) {
    const id = subject.match(/^(SP\d{2}-C\d{2}) /)?.[1];
    if (!id) continue;
    assert.ok(byId.has(id), `commit "${subject}" uses an ID that is not in sprints.json`);
    assert.equal(byId.get(id).repo, 'backend', `commit "${subject}" uses an app-repo ID`);
  }
});

test('[SP01-C04] the validator accepts the sample plan', () => {
  assert.deepEqual(validatePlan(sample()), []);
});

test('[SP01-C04] sprint IDs must run SP01, SP02, ... with no gaps', () => {
  assert.match(errorsAfter((p) => { p.sprints[1].id = 'SP03'; }), /expected SP02/);
});

test('[SP01-C04] commit IDs must run C01, C02, ... inside their sprint', () => {
  assert.match(errorsAfter((p) => { p.sprints[0].commits[1].id = 'SP01-C03'; }), /expected SP01-C02/);
  assert.match(errorsAfter((p) => { p.sprints[1].commits[0].id = 'SP01-C01'; }), /expected SP02-C01/);
});

test('[SP01-C04] versions must be x.y.z and go up from sprint to sprint', () => {
  assert.match(errorsAfter((p) => { p.sprints[0].version = 'v0.1'; }), /not x\.y\.z/);
  assert.match(errorsAfter((p) => { p.sprints[1].version = '0.1.0'; }), /not higher/);
  assert.match(errorsAfter((p) => { p.sprints[1].version = '0.0.9'; }), /not higher/);
  assert.equal(errorsAfter((p) => { p.sprints[1].version = '0.10.0'; }), '');
});

test('[SP01-C04] repo, status and screen values are checked', () => {
  assert.match(errorsAfter((p) => { p.sprints[0].commits[0].repo = 'web'; }), /repo "web"/);
  assert.match(errorsAfter((p) => { p.sprints[0].commits[0].status = 'finished'; }), /status "finished"/);
  assert.match(errorsAfter((p) => { p.sprints[0].screens.push('Home'); }), /screen "Home"/);
});

test('[SP01-C04] every commit says what its unit tests cover', () => {
  assert.match(errorsAfter((p) => { delete p.sprints[0].commits[0].tests; }), /missing tests/);
});

test('[SP01-C04] sprint status must agree with its commits', () => {
  assert.match(errorsAfter((p) => { p.sprints[0].status = 'planned'; }), /commits say in-progress/);
  assert.match(errorsAfter((p) => { p.sprints[0].commits[1].status = 'done'; }), /commits say done/);
  assert.match(errorsAfter((p) => { p.sprints[1].status = 'done'; }), /commits say planned/);
});

test('[SP01-C04] SPRINTS.md lists every sprint and commit', () => {
  const md = renderMarkdown(plan);
  for (const s of plan.sprints) assert.ok(md.includes(`## ${s.id} v${s.version}: ${s.title}`), s.id);
  for (const c of allCommits(plan)) assert.ok(md.includes(`| ${c.id} |`), c.id);
});
