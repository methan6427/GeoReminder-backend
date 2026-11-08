// The sprint plan lives in docs/sprints/sprints.json. This file checks it and renders
// docs/sprints/SPRINTS.md from it, so the two never disagree.
//
//   npm run sprints     rewrite SPRINTS.md after editing sprints.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const planFile = path.join(root, 'docs', 'sprints', 'sprints.json');
export const markdownFile = path.join(root, 'docs', 'sprints', 'SPRINTS.md');

export const STATUSES = ['planned', 'in-progress', 'done'];
export const REPOS = ['backend', 'flutter'];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SCREEN = /^S\d{2}[a-z]?$/;

export const loadPlan = (file = planFile) => JSON.parse(fs.readFileSync(file, 'utf8'));
const pad = (n) => String(n).padStart(2, '0');
const cmpVersion = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

// Returns a list of problems. An empty list means the plan is valid.
export function validatePlan(plan) {
  const errors = [];
  if (plan.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Array.isArray(plan.sprints) || plan.sprints.length === 0) return [...errors, 'no sprints'];

  plan.sprints.forEach((s, i) => {
    const want = `SP${pad(i + 1)}`;
    if (s.id !== want) errors.push(`sprint ${i + 1} has id ${s.id}, expected ${want}`);
    if (!SEMVER.test(s.version ?? '')) errors.push(`${s.id}: version "${s.version}" is not x.y.z`);
    else if (i > 0 && SEMVER.test(plan.sprints[i - 1].version ?? '') && cmpVersion(s.version, plan.sprints[i - 1].version) <= 0)
      errors.push(`${s.id}: version ${s.version} is not higher than the previous sprint's`);
    if (!s.title) errors.push(`${s.id}: missing title`);
    if (!STATUSES.includes(s.status)) errors.push(`${s.id}: status "${s.status}" is not one of ${STATUSES.join(', ')}`);
    for (const sc of s.screens ?? []) if (!SCREEN.test(sc)) errors.push(`${s.id}: screen "${sc}" is not like S05 or S03a`);
    if (!Array.isArray(s.commits) || s.commits.length === 0) { errors.push(`${s.id}: no commits`); return; }

    s.commits.forEach((c, j) => {
      const cid = `${s.id}-C${pad(j + 1)}`;
      if (c.id !== cid) errors.push(`${s.id} commit ${j + 1} has id ${c.id}, expected ${cid}`);
      if (!REPOS.includes(c.repo)) errors.push(`${c.id}: repo "${c.repo}" is not one of ${REPOS.join(', ')}`);
      if (!STATUSES.includes(c.status)) errors.push(`${c.id}: status "${c.status}" is not one of ${STATUSES.join(', ')}`);
      if (!c.title) errors.push(`${c.id}: missing title`);
      if (!c.tests) errors.push(`${c.id}: missing tests (what the unit tests for this commit cover)`);
    });

    const done = s.commits.every((c) => c.status === 'done');
    const started = s.commits.some((c) => c.status !== 'planned');
    const expected = done ? 'done' : started ? 'in-progress' : 'planned';
    if (STATUSES.includes(s.status) && s.status !== expected)
      errors.push(`${s.id}: status is ${s.status} but its commits say ${expected}`);
  });
  return errors;
}

export const allCommits = (plan) => plan.sprints.flatMap((s) => s.commits);

const cell = (t) => String(t).replaceAll('|', '\\|');

export function renderMarkdown(plan) {
  const out = [
    '# Sprints',
    '',
    '<!-- Generated from sprints.json by `npm run sprints`. Edit sprints.json, not this file. -->',
    '',
    'Each sprint is one version. When a sprint is done and has passed `test` and `review`, Adam',
    'merges `review` into `main` and releases that version by hand.',
    '',
    'Each commit has an ID, `SPnn-Cnn`. The commit subject starts with it',
    '(`SP01-C03 reject dependency cycles ...`) and every unit test added by that commit starts its',
    'name with it in brackets (`[SP01-C03] a direct cycle is rejected`). `npm test` fails if a commit',
    'marked done in this repo has no test with its ID. Screen IDs (`S05`, `S20b`) are the design',
    'screens in the project portal.',
    '',
    '| Sprint | Version | Title | Status | Commits |',
    '| --- | --- | --- | --- | --- |',
    ...plan.sprints.map((s) => {
      const n = s.commits.filter((c) => c.status === 'done').length;
      return `| ${s.id} | v${s.version} | ${cell(s.title)} | ${s.status} | ${n}/${s.commits.length} |`;
    }),
  ];
  for (const s of plan.sprints) {
    out.push('', `## ${s.id} v${s.version}: ${s.title}`, '', `${s.goal}`, '');
    out.push(`Status: ${s.status}.${s.screens?.length ? ` Screens: ${s.screens.join(', ')}.` : ''}`, '');
    out.push('| Commit | Repo | Status | Change | Unit tests |', '| --- | --- | --- | --- | --- |');
    for (const c of s.commits) out.push(`| ${c.id} | ${c.repo} | ${c.status} | ${cell(c.title)} | ${cell(c.tests)} |`);
  }
  return out.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = loadPlan();
  const errors = validatePlan(plan);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  fs.writeFileSync(markdownFile, renderMarkdown(plan));
  console.log(`docs/sprints/SPRINTS.md: ${plan.sprints.length} sprints, ${allCommits(plan).length} commits`);
}
