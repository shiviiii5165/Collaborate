const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connStr = process.env.DATABASE_URL || 'postgresql://postgres.noeapdkpcilldhkymzrv:sHivam%408025@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: connStr,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const schemaPath = path.join(__dirname, '..', 'src', 'lib', 'db', 'migrations', '001_initial_schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Connecting to database and applying schema...');
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
