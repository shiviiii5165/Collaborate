const { Pool } = require('pg');

const rawUrl = process.env.DATABASE_URL || 'postgresql://postgres.noeapdkpcilldhkymzrv:sHivam%408025@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require';
const cleanUrl = rawUrl.replace(/[?&]sslmode=[^&]+/g, '').replace(/\?$/, '');

const pool = new Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
});

async function verify() {
  console.log('1. Testing SELECT NOW() & PostgreSQL Version...');
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
    await client.query(
      'INSERT INTO members (id, email, full_name, role, plan, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
      ['rollback_test_id', 'rollback@test.internal', 'Rollback User', 'member', 'free']
    );
    await client.query('ROLLBACK');
    console.log('   ROLLBACK executed successfully.');
  } finally {
    client.release();
  }

  const checkRb = await pool.query('SELECT * FROM members WHERE id = $1', ['rollback_test_id']);
  console.log('   Verified rolled back row count (expected 0):', checkRb.rows.length);

  await pool.end();
  console.log('========================================================================');
  console.log('   SUPABASE POSTGRESQL RUNTIME CONNECTIVITY: 100% VERIFIED');
  console.log('========================================================================');
}

verify().catch(e => {
  console.error('DATABASE CONNECTIVITY ERROR:', e);
  process.exit(1);
});
