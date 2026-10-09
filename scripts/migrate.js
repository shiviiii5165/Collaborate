const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connStr = process.env.DATABASE_URL;
if (!connStr) {
  console.error('FATAL: DATABASE_URL environment variable is required to run migrations.');
  process.exit(1);
}

const certPath = path.join(__dirname, '..', 'src', 'lib', 'db', 'certs', 'supabase-root-ca.pem');
let sslConfig = { rejectUnauthorized: true };

if (fs.existsSync(certPath)) {
  const ca = fs.readFileSync(certPath, 'utf8');
  const urlObj = new URL(connStr.replace(/[?&]sslmode=[^&]+/g, '').replace(/\?$/, ''));
  sslConfig = {
    ca,
    rejectUnauthorized: true,
    servername: urlObj.hostname,
  };
}

const cleanUrl = connStr.replace(/[?&]sslmode=[^&]+/g, '').replace(/\?$/, '');
const pool = new Pool({
  connectionString: cleanUrl,
  ssl: sslConfig,
});

async function run() {
  const schemaPath = path.join(__dirname, '..', 'src', 'lib', 'db', 'migrations', '001_initial_schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Connecting to database with strict TLS and applying schema...');
  await pool.query(sql);
  console.log('Schema migration applied successfully!');

  const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log('All tables created:');
  res.rows.forEach(r => console.log('  - ' + r.table_name));

  await pool.end();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
