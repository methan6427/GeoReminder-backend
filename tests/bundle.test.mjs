// Tests for scripts/bundle-migrations.mjs (the build job's output, dist/schema.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundleMigrations } from '../scripts/bundle-migrations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'bundle-migrations.mjs');
const migrations = path.join(root, 'supabase', 'migrations');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));

test('[SP01-C02] migrations are bundled in filename order, each under a header', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '20260102_b.sql'), 'select 2;\n');
  fs.writeFileSync(path.join(dir, '20260101_a.sql'), 'select 1;\n\n\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not sql');
  const { files, sql } = bundleMigrations(dir);
  assert.deepEqual(files, ['20260101_a.sql', '20260102_b.sql']);
  assert.equal(sql, '-- ===== 20260101_a.sql =====\nselect 1;\n\n-- ===== 20260102_b.sql =====\nselect 2;\n');
});

test('[SP01-C02] a folder with no migrations is an error', () => {
  assert.throws(() => bundleMigrations(tmp()), /no migrations found/);
});

test('[SP01-C02] the bundle holds every migration in the repo, unchanged', () => {
  const { files, sql } = bundleMigrations(migrations);
  assert.ok(files.length >= 1);
  let at = -1;
  for (const f of files) {
    const next = sql.indexOf(`-- ===== ${f} =====`);
    assert.ok(next > at, `${f} is missing or out of order`);
    assert.ok(sql.includes(fs.readFileSync(path.join(migrations, f), 'utf8').trimEnd()), `${f} body changed`);
    at = next;
  }
});

test('[SP01-C02] the command writes the output file and exits 0', () => {
  const out = path.join(tmp(), 'nested', 'schema.sql');
  execFileSync(process.execPath, [script, migrations, out]);
  assert.equal(fs.readFileSync(out, 'utf8'), bundleMigrations(migrations).sql);
});

test('[SP01-C02] the command exits 1 when there is nothing to bundle', () => {
  const r = spawnSync(process.execPath, [script, tmp(), path.join(tmp(), 'schema.sql')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr.toString(), /no migrations found/);
});
