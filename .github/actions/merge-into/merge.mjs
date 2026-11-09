// Brings HEAD_SHA (a pushed personal branch) onto BASE_SHA (test) and leaves the result
// checked out. Used by every job of the pipeline, so the same inputs must give the same SHA.
//
//   up-to-date    head is already in base: base, unchanged.
//   fast-forward  base is an ancestor of head: head itself, so test and review show the
//                 sprint commit (e.g. "SP01-C07 ...") and no merge commit is made.
//   merge         the branches diverged (someone else's work landed on test first): a merge
//                 commit whose subject is the latest non-merge commit of the push, with
//                 MESSAGE ("Merge adam into test") as its body. Author and dates are pinned.
//
// On a conflict it lists the files and exits 1.
//
// Env: BASE_SHA, HEAD_SHA, MESSAGE; GITHUB_OUTPUT and GITHUB_STEP_SUMMARY when set.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

export class MergeConflict extends Error {
  constructor(files, log) {
    super(`merge conflict in: ${files.join(', ')}`);
    this.files = files;
    this.log = log;
  }
}

function makeGit(cwd, env = process.env) {
  const run = (args, extraEnv = {}) =>
    spawnSync('git', args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8' });
  const git = (args, extraEnv) => {
    const r = run(args, extraEnv);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${r.stderr}${r.stdout}`);
    return r.stdout.trim();
  };
  git.ok = (args) => run(args).status === 0;
  git.raw = run;
  return git;
}

export function mergeInto({ base, head, message, cwd = process.cwd(), env = process.env }) {
  const git = makeGit(cwd, env);
  base = git(['rev-parse', '--verify', `${base}^{commit}`]);
  head = git(['rev-parse', '--verify', `${head}^{commit}`]);

  if (git.ok(['merge-base', '--is-ancestor', head, base])) {
    git(['checkout', '--quiet', '--detach', base]);
    return { mode: 'up-to-date', sha: base };
  }
  if (git.ok(['merge-base', '--is-ancestor', base, head])) {
    git(['checkout', '--quiet', '--detach', head]);
    return { mode: 'fast-forward', sha: head };
  }

  const subject = git(['log', '-1', '--no-merges', '--format=%s', `${base}..${head}`]) || message;
  const date = git(['show', '-s', '--format=%cI', head]);
  const pinned = {
    GIT_AUTHOR_NAME: BOT_NAME,
    GIT_AUTHOR_EMAIL: BOT_EMAIL,
    GIT_COMMITTER_NAME: BOT_NAME,
    GIT_COMMITTER_EMAIL: BOT_EMAIL,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
  git(['checkout', '--quiet', '--detach', base]);
  const r = git.raw(['merge', '--no-ff', '--no-edit', '-m', subject, '-m', message, head], pinned);
  if (r.status !== 0) {
    const files = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
    throw new MergeConflict(files, r.stdout + r.stderr);
  }
  return { mode: 'merge', sha: git(['rev-parse', 'HEAD']), subject };
}

export function main(env = process.env, cwd = process.cwd()) {
  const append = (file, text) => { if (file) fs.appendFileSync(file, text); };
  try {
    const result = mergeInto({ base: env.BASE_SHA, head: env.HEAD_SHA, message: env.MESSAGE, cwd, env });
    console.log(`${result.mode}: ${result.sha}`);
    append(env.GITHUB_OUTPUT, `sha=${result.sha}\nmode=${result.mode}\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof MergeConflict)) throw e;
    console.log(e.log);
    append(env.GITHUB_STEP_SUMMARY, [
      '## Merge conflict', '',
      'Your branch cannot be merged automatically. Conflicting files:', '',
      ...e.files.map((f) => `- \`${f}\``), '',
      'Fix: `git fetch origin && git merge origin/test` on your branch,',
      'resolve these files, commit, and push again.', '',
    ].join('\n'));
    for (const f of e.files) {
      console.log(`::error file=${f}::Merge conflict in ${f}. Merge origin/test into your branch, resolve, push again.`);
    }
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  process.exitCode = main();
}
