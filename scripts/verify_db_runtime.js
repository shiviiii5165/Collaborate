const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Read .env if DATABASE_URL not in process.env
let rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
    if (match) {
      rawUrl = match[1];
    }
  }
}

if (!rawUrl) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const cleanUrl = rawUrl.replace(/[?&]sslmode=[^&]+/g, '').replace(/\?$/, '');
const certPath = path.join(__dirname, '..', 'src', 'lib', 'db', 'certs', 'supabase-root-ca.pem');

let sslConfig = { rejectUnauthorized: true };
if (fs.existsSync(certPath)) {
  const ca = fs.readFileSync(certPath, 'utf8');
  const urlObj = new URL(cleanUrl);
  sslConfig = {
    ca,
    rejectUnauthorized: true,
    servername: urlObj.hostname,
  };
}

const pool = new Pool({
  connectionString: cleanUrl,
  ssl: sslConfig,
  connectionTimeoutMillis: 10000,
});

async function verify() {
  console.log('1. Testing SELECT NOW() & PostgreSQL Version with strict TLS...');
  const t = await pool.query('SELECT NOW() AS now, version() AS ver');
  console.log('   PostgreSQL Time:', t.rows[0].now);
  console.log('   PostgreSQL Version:', t.rows[0].ver.split(',')[0]);

  console.log('2. Testing SELECT count(*) FROM members...');
  const mc = await pool.query('SELECT count(*) AS total FROM members');
  console.log('   Total Members:', mc.rows[0].total);

  console.log('3. Testing Parameterized INSERT Transaction...');
  const testId = 'test_conn_' + Date.now();
  await pool.query(
    'INSERT INTO members (id, email, full_name, role, plan, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
    [testId, testId + '@test.internal', 'Runtime Test User', 'member', 'free']
  );
  console.log('   INSERT successful for record ID:', testId);

  console.log('4. Testing SELECT of inserted record...');
  const r = await pool.query('SELECT id, email, full_name, role, plan FROM members WHERE id = $1', [testId]);
  console.log('   Retrieved row:', r.rows[0]);

  console.log('5. Testing CLEANUP DELETE...');
  await pool.query('DELETE FROM members WHERE id = $1', [testId]);
  console.log('   DELETE successful!');

  console.log('6. Testing Transaction Rollback Integrity...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rbId = 'test_rb_' + Date.now();
    await client.query(
      'INSERT INTO members (id, email, full_name, role, plan, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
      [rbId, rbId + '@test.internal', 'Rollback User', 'member', 'free']
    );
    await client.query('ROLLBACK');
    const check = await pool.query('SELECT id FROM members WHERE id = $1', [rbId]);
    if (check.rows.length === 0) {
      console.log('   Rollback verified successfully! Uncommitted row was not persisted.');
    } else {
      throw new Error('Rollback failed: row exists!');
    }
  } finally {
    client.release();
  }

  console.log('\nAll Supabase database runtime integration tests PASSED with strict TLS!');
  await pool.end();
}

verify().catch((err) => {
  console.error('FATAL Verification Failure:', err);
  process.exit(1);
});
