// Writes every migration in supabase/migrations, in filename order, into dist/schema.sql.
// Paste that one file into the Supabase SQL editor to set up a fresh project.
//
//   node scripts/bundle-migrations.mjs [migrations-dir] [output-file]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Returns { files, sql }. Throws if the folder holds no .sql file.
export function bundleMigrations(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${dir}`);
  const parts = files.map((f) => `-- ===== ${f} =====\n${fs.readFileSync(path.join(dir, f), 'utf8').trimEnd()}\n`);
  return { files, sql: parts.join('\n') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? path.join(root, 'supabase', 'migrations'));
  const out = path.resolve(process.argv[3] ?? path.join(root, 'dist', 'schema.sql'));
  try {
    const { files, sql } = bundleMigrations(dir);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, sql);
    console.log(`${path.relative(root, out).split(path.sep).join('/')}: ${files.length} migration(s): ${files.join(', ')}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
