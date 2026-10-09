import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
    if (match) rawUrl = match[1];
  }
}

if (!rawUrl) {
  console.error('FATAL: DATABASE_URL not found');
  process.exit(1);
}

const cleanUrl = rawUrl.replace(/[?&]sslmode=[^&]+/g, '').replace(/\?$/, '');
const urlObj = new URL(cleanUrl);
const caCert = fs.readFileSync(path.join(__dirname, '../src/lib/db/certs/supabase-root-ca.pem'), 'utf-8');

async function testTls() {
  console.log('Testing pg connection with rejectUnauthorized: true and Supabase Root CA...');
  const pool = new pg.Pool({
    connectionString: cleanUrl,
    ssl: {
      ca: caCert,
      rejectUnauthorized: true,
      servername: urlObj.hostname
    },
    connectionTimeoutMillis: 10000
  });

  try {
    const client = await pool.connect();
    console.log('Connected successfully!');
    const res = await client.query('SELECT current_database(), current_user, version()');
    console.log('Query result:', res.rows[0]);
    client.release();
    await pool.end();
    console.log('TLS verification test PASSED!');
  } catch (err) {
    console.error('TLS verification test FAILED:', err);
    await pool.end();
    process.exit(1);
  }
}

testTls();
