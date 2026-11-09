// The pipeline's merge step (.github/actions/merge-into/merge.mjs), run against throwaway
// git repositories: test and review must land on the sprint commit itself when they can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeInto, main, MergeConflict } from '../.github/actions/merge-into/merge.mjs';

const script = fileURLToPath(new URL('../.github/actions/merge-into/merge.mjs', import.meta.url));
const MESSAGE = 'Merge adam into test';

// A repo with its own identity and no global hooks, so the tests do not depend on the
// machine's git config.
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-into-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(dir, '.no-global-config'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.com',
    GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.com',
  };
  let clock = 1_700_000_000;
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (subject, files) => {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    git('add', '-A');
    const date = `${clock++} +0000`;
    const r = spawnSync('git', ['commit', '--quiet', '-m', subject], {
      cwd: dir, encoding: 'utf8', env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    assert.equal(r.status, 0, r.stderr);
    return git('rev-parse', 'HEAD');
  };
  git('init', '--quiet', '-b', 'test');
  const root = commit('Bootstrap', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
  const run = (base, head) => mergeInto({ base, head, message: MESSAGE, cwd: dir, env });
  return { dir, env, git, commit, root, run };
}

test('[SP01-C07] a push on top of test fast-forwards: test lands on the sprint commit', (t) => {
  const r = repo(t);
  const c1 = r.commit('SP01-C07 first', { 'a.txt': 'a1\n' });
  const c2 = r.commit('SP01-C08 second', { 'b.txt': 'b1\n' });
  assert.deepEqual(r.run(r.root, c2), { mode: 'fast-forward', sha: c2 });
  assert.equal(r.git('rev-parse', 'HEAD'), c2);
  assert.equal(r.git('log', '-1', '--format=%s'), 'SP01-C08 second');
  assert.equal(r.git('rev-list', '--count', `${r.root}..HEAD`), '2', 'no merge commit is added');
  assert.ok(c1);
});

test('[SP01-C07] diverged branches get a merge commit named after the latest sprint commit', (t) => {
  const r = repo(t);
  const other = r.commit('SP03-C01 someone else', { 'b.txt': 'b2\n' });
  r.git('checkout', '--quiet', '-b', 'adam', r.root);
  const mine = r.commit('SP01-C07 mine', { 'a.txt': 'a1\n' });
  const result = r.run(other, mine);
  assert.equal(result.mode, 'merge');
  assert.equal(result.subject, 'SP01-C07 mine');
  assert.equal(r.git('log', '-1', '--format=%s'), 'SP01-C07 mine');
  assert.equal(r.git('log', '-1', '--format=%b'), MESSAGE);
  assert.equal(r.git('log', '-1', '--format=%P'), `${other} ${mine}`);
  assert.equal(r.git('log', '-1', '--format=%an'), 'github-actions[bot]');
  assert.equal(fs.readFileSync(path.join(r.dir, 'a.txt'), 'utf8'), 'a1\n');
  assert.equal(fs.readFileSync(path.join(r.dir, 'b.txt'), 'utf8'), 'b2\n');
});

test('[SP01-C07] the merge is reproducible: every pipeline job gets the same SHA', (t) => {
  const r = repo(t);
  const other = r.commit('SP03-C01 someone else', { 'b.txt': 'b2\n' });
  r.git('checkout', '--quiet', '-b', 'adam', r.root);
  const mine = r.commit('SP01-C07 mine', { 'a.txt': 'a1\n' });
  const first = r.run(other, mine).sha;
  const second = r.run(other, mine).sha;
  assert.equal(first, second);
});

test('[SP01-C07] a branch that merged test in is named after its sprint commit, not the sync merge', (t) => {
  const r = repo(t);
  const other = r.commit('SP03-C01 someone else', { 'b.txt': 'b2\n' });
  r.git('checkout', '--quiet', '-b', 'adam', r.root);
  r.commit('SP01-C07 mine', { 'a.txt': 'a1\n' });
  r.git('merge', '--quiet', '--no-edit', 'test');
  const newer = r.commit('SP03-C02 newer', { 'c.txt': 'c\n' });
  r.git('checkout', '--quiet', 'test');
  const more = r.commit('SP03-C03 more', { 'd.txt': 'd\n' });
  const result = r.run(more, newer);
  assert.equal(result.mode, 'merge');
  assert.equal(result.subject, 'SP03-C02 newer');
  r.git('checkout', '--quiet', '--detach', other);
  r.git('merge', '--quiet', '--no-ff', '--no-edit', 'adam');
  const head = r.git('rev-parse', 'HEAD');
  assert.equal(r.run(r.git('rev-parse', 'test'), head).subject, 'SP03-C02 newer',
    'a push whose newest commit is a merge still names the newest sprint commit');
});

test('[SP01-C07] a push that test already contains changes nothing', (t) => {
  const r = repo(t);
  const c1 = r.commit('SP01-C07 first', { 'a.txt': 'a1\n' });
  assert.deepEqual(r.run(c1, r.root), { mode: 'up-to-date', sha: c1 });
  assert.deepEqual(r.run(c1, c1), { mode: 'up-to-date', sha: c1 });
});

test('[SP01-C07] a conflict fails with the conflicting files', (t) => {
  const r = repo(t);
  const other = r.commit('SP03-C01 someone else', { 'a.txt': 'theirs\n' });
  r.git('checkout', '--quiet', '-b', 'adam', r.root);
  const mine = r.commit('SP01-C07 mine', { 'a.txt': 'mine\n' });
  assert.throws(() => r.run(other, mine), (e) => e instanceof MergeConflict && e.files.join() === 'a.txt');
});

test('[SP01-C07] run as the action does: writes sha and mode, exit 0; a conflict writes the summary, exit 1', (t) => {
  const r = repo(t);
  const out = path.join(r.dir, '..', `${path.basename(r.dir)}-out`);
  const summary = `${out}-summary`;
  t.after(() => { fs.rmSync(out, { force: true }); fs.rmSync(summary, { force: true }); });

  const c1 = r.commit('SP01-C07 first', { 'a.txt': 'a1\n' });
  const ok = spawnSync(process.execPath, [script], {
    cwd: r.dir, encoding: 'utf8',
    env: { ...r.env, BASE_SHA: r.root, HEAD_SHA: c1, MESSAGE, GITHUB_OUTPUT: out },
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), `sha=${c1}\nmode=fast-forward\n`);

  r.git('checkout', '--quiet', '-b', 'adam', r.root);
  const mine = r.commit('SP01-C08 mine', { 'a.txt': 'mine\n' });
  const code = main({ ...r.env, BASE_SHA: c1, HEAD_SHA: mine, MESSAGE, GITHUB_STEP_SUMMARY: summary }, r.dir);
  assert.equal(code, 1);
  assert.match(fs.readFileSync(summary, 'utf8'), /## Merge conflict[\s\S]*- `a\.txt`/);
});
