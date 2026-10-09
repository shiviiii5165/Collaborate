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

async function testFailClosed() {
  console.log('Testing fail-closed behavior when bad CA is provided...');
  const pool = new pg.Pool({
    connectionString: cleanUrl,
    ssl: {
      ca: '-----BEGIN CERTIFICATE-----\nINVALID\n-----END CERTIFICATE-----',
      rejectUnauthorized: true,
      servername: urlObj.hostname
    },
    connectionTimeoutMillis: 5000
  });

  try {
    await pool.connect();
    console.error('ERROR: Should NOT have connected with invalid CA!');
    await pool.end();
    process.exit(1);
  } catch (err) {
    console.log('Expected failure occurred as designed (fail closed):', err.message);
    await pool.end();
  }
}

testFailClosed();
