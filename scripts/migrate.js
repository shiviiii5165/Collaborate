/**
 * Applies src/lib/db/migrations/NNN_*.sql in numeric order, each in its own transaction.
 * Every file is idempotent (IF NOT EXISTS), so re-running is safe; a failing file rolls back
 * completely and stops the run (earlier files stay applied).
 *
 *   DATABASE_URL=<target> node scripts/migrate.js
 *
 * TLS (same rules as src/lib/db/ssl.ts): always verified. The bundled Supabase root CA is
 * used ONLY for Supabase hosts; Neon and other providers use the system trust store.
 * DATABASE_SSL_CA overrides. localhost without sslmode=require connects without TLS.
 * Never prints the connection string or credentials.
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'lib', 'db', 'migrations');
const SUPABASE_CA_PATH = path.join(__dirname, '..', 'src', 'lib', 'db', 'certs', 'supabase-root-ca.pem');

function cleanUrl(connStr) {
  return connStr.replace(/[?&]sslmode=[^&]+/g, '').replace(/\?$/, '');
}

function sslFor(connStr) {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connStr) || /\/\/(localhost|127\.0\.0\.1)[:/]/.test(connStr);
  if (local && !connStr.includes('sslmode=require')) return false;
  const hostname = new URL(cleanUrl(connStr)).hostname;
  const customCa = (process.env.DATABASE_SSL_CA || '').trim();
  if (customCa) return { ca: customCa, rejectUnauthorized: true, servername: hostname };
  if (/supabase\.(co|com)$/.test(hostname) || hostname.includes('.supabase.')) {
    return { ca: fs.readFileSync(SUPABASE_CA_PATH, 'utf8'), rejectUnauthorized: true, servername: hostname };
  }
  return { rejectUnauthorized: true, servername: hostname };
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
}

/** pool: pg-compatible ({ connect() -> client{ query, release } }). */
async function applyMigrations(pool, log = console.log) {
  const applied = [];
  for (const file of migrationFiles()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      applied.push(file);
      log(`  applied ${file}`);
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* connection lost */ }
      throw new Error(`Migration ${file} failed and was rolled back: ${err && err.message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

module.exports = { sslFor, migrationFiles, applyMigrations };

if (require.main === module) {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('FATAL: DATABASE_URL environment variable is required to run migrations.');
    process.exit(1);
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: cleanUrl(connStr), ssl: sslFor(connStr) });
  (async () => {
    console.log(`Applying ${migrationFiles().length} migrations with verified TLS...`);
    await applyMigrations(pool);
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    console.log('Tables present:');
    res.rows.forEach((r) => console.log('  - ' + r.table_name));
    await pool.end();
  })().catch(async (err) => {
    console.error('Migration failed:', err && err.message ? err.message : String(err));
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(1);
  });
}
