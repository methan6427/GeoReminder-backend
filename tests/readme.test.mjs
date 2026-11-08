// Keeps README.md in step with the repo: commands, Node version, paths, error codes, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const migrationsDir = path.join(root, 'supabase', 'migrations');
const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');

test('[SP01-C06] every npm run command in the README exists in package.json', () => {
  const used = [...readme.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const name of used) assert.ok(pkg.scripts[name], `README uses "npm run ${name}", which package.json does not define`);
});

test('[SP01-C06] every package.json script is documented in the README', () => {
  for (const name of Object.keys(pkg.scripts)) {
    const cmd = name === 'test' ? /npm test\b/ : new RegExp(`npm run ${name}\\b`);
    assert.match(readme, cmd, `package.json script "${name}" is not in the README`);
  }
});

test('[SP01-C06] the README states the Node.js version package.json requires', () => {
  const major = pkg.engines.node.match(/(\d+)/)[1];
  assert.match(readme, new RegExp(`Node\\.js ${major} or newer`));
  for (const m of readme.matchAll(/Node\.js (\d+) or newer/g)) assert.equal(m[1], major, `README says Node.js ${m[1]}`);
});

test('[SP01-C06] the README contains no keys, tokens or real project URLs', () => {
  assert.doesNotMatch(readme, /eyJ[\w-]{10,}\.[\w-]{10,}/, 'looks like a JWT (anon or service_role key)');
  assert.doesNotMatch(readme, /sb_(publishable|secret)_[\w-]{8,}/, 'looks like a Supabase API key');
  for (const m of readme.matchAll(/https?:\/\/([\w<>-]+)\.supabase\.co/g)) {
    assert.equal(m[1], '<project-ref>', `real project URL in README: ${m[0]}`);
  }
});

test('[SP01-C06] every error code the migrations raise is listed in the README', () => {
  const codes = new Set([...migrations.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]));
  assert.ok(codes.size >= 9, `found only ${[...codes]}`);
  for (const code of codes) assert.match(readme, new RegExp(`\\| \`${code}\` \\|`), `${code} missing from the error table`);
});

test('[SP01-C06] every function the migrations create for the app is in the README API table', () => {
  const fns = [...migrations.matchAll(/create (?:or replace )?function (\w+)\(/g)].map((m) => m[1])
    .filter((f) => f !== 'is_participant'); // internal helper for the policies
  for (const fn of new Set(fns)) assert.match(readme, new RegExp(`\\| \`${fn}\\(`), `${fn} missing from the API table`);
});

test('[SP01-C06] repo paths and links in the README exist', () => {
  const paths = new Set([
    ...[...readme.matchAll(/\]\(((?!https?:)[^)#]+)\)/g)].map((m) => m[1]),
    ...[...readme.matchAll(/`((?:supabase|tests|scripts|docs|\.github|\.githooks)\/[\w./-]*)`/g)].map((m) => m[1]),
    ...[...readme.matchAll(/`([\w-]+\.(?:md|mjs))`/g)].map((m) => m[1]),
  ]);
  const where = (p) => [path.join(root, p), path.join(root, 'scripts', p)];
  for (const p of paths) assert.ok(where(p).some((f) => fs.existsSync(f)), `README mentions ${p}, which does not exist`);
});
