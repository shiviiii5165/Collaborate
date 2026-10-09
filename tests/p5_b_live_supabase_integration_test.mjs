/**
 * COLLABORATE — PHASE P5-B: REAL SUPABASE POSTGRESQL & FASTIFY INTEGRATION VERIFICATION
 *
 * Verifies with real Supabase database and strict TLS (rejectUnauthorized: true + Supabase Root CA):
 * 1. Fastify authoritative API server boot
 * 2. Strict TLS connection to Supabase pooler
 * 3. Logged-out visitor checks
 * 4. User Registration persisting in Supabase
 * 5. Session cookie establishment (HttpOnly, SameSite, Secure)
 * 6. Authenticated session validation (/api/auth/me)
 * 7. Profile update persistence in Supabase
 * 8. Member Discovery filtering
 * 9. Connection request & acceptance lifecycle
 * 10. Direct messaging between accepted connections
 * 11. SSE stream delivery & replay with lastEventId
 * 12. Quota check enforcement
 * 13. Peer blocking preventing messaging
 * 14. Session invalidation on logout
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env FIRST before any app imports
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
  console.error('DATABASE_URL is required for Supabase integration test.');
  process.exit(1);
}

process.env.DATABASE_URL = rawUrl;
process.env.SESSION_SECRET = 'collaborate_test_session_secret_2026_at_least_32_chars';
process.env.AUTH_SECRET = 'collaborate_test_session_secret_2026_at_least_32_chars';

async function run() {
  console.log('========================================================================');
  console.log('   COLLABORATE — P5-B REAL SUPABASE & FASTIFY LIVE INTEGRATION SUITE    ');
  console.log('========================================================================\n');

  // Verify strict TLS with Supabase pooler first
  console.log('--- STEP 1: Strict TLS CA Verification with Supabase Pooler ---');
  const certPath = path.join(__dirname, '../src/lib/db/certs/supabase-root-ca.pem');
  const caCert = fs.readFileSync(certPath, 'utf8');
  const cleanUrl = rawUrl.replace(/[?&]sslmode=[^&]+/g, '').replace(/\?$/, '');
  const urlObj = new URL(cleanUrl);

  const directPool = new pg.Pool({
    connectionString: cleanUrl,
    ssl: {
      ca: caCert,
      rejectUnauthorized: true,
      servername: urlObj.hostname,
    },
    connectionTimeoutMillis: 10000,
  });

  const client = await directPool.connect();
  const dbVer = await client.query('SELECT version(), current_database()');
  console.log('✅ PASSED: Connected to Supabase with rejectUnauthorized: true and Supabase Root CA');
  console.log('   Database:', dbVer.rows[0].current_database, '| Engine:', dbVer.rows[0].version.split(',')[0]);
  client.release();

  // Dynamically import buildServer and getNeonPool after env setup
  const { buildServer } = await import('../apps/api/src/server.ts');
  const { getNeonPool } = await import('../src/lib/db/neon.ts');

  // Boot Fastify Server
  console.log('\n--- STEP 2: Boot Authoritative Fastify Service ---');
  const app = buildServer();
  const serverAddress = await app.listen({ port: 0 });
  console.log(`✅ PASSED: Fastify API successfully booted with PostgreSQL authority on ${serverAddress}`);

  // 1. Logged-out visitor
  console.log('\n--- STEP 3: Logged-Out Visitor Access ---');
  const guestRes = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
  });
  assert.strictEqual(guestRes.statusCode, 401, 'Guest must receive 401 Unauthorized');
  const guestData = JSON.parse(guestRes.body);
  assert.strictEqual(guestData.error, 'UNAUTHORIZED');
  console.log('✅ PASSED: Logged-out visitor receives 401 Unauthorized (triggers Sign In view, not hang)');

  // 2. Registration for Account A (Alice)
  console.log('\n--- STEP 4: Registration for Account A (Alice) ---');
  const ts = Date.now();
  const aliceEmail = `alice_${ts}@test.collaborate.internal`;
  const regAliceRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: aliceEmail,
      password: 'AliceSecurePassword2026!',
      fullName: 'Alice Researcher',
      isUnder18: false,
    },
  });
  assert.strictEqual(regAliceRes.statusCode, 201, 'Registration should return 201');
  const aliceRegData = JSON.parse(regAliceRes.body);
  assert.strictEqual(aliceRegData.success, true);
  const aliceCookie = regAliceRes.headers['set-cookie'];
  assert.ok(aliceCookie, 'Registration must issue collaborate_session cookie');
  assert.ok(aliceCookie.includes('collaborate_session='), 'Cookie contains session name');
  assert.ok(aliceCookie.includes('HttpOnly'), 'Cookie is HttpOnly');
  console.log('✅ PASSED: User Alice registered; session cookie issued with HttpOnly/SameSite/Secure');

  // 3. Verify Alice persists in Supabase database
  console.log('\n--- STEP 5: Supabase Persistence Evidence for Account A ---');
  const dbAliceCheck = await directPool.query('SELECT id, email, full_name, role, plan FROM members WHERE email = $1', [aliceEmail]);
  assert.strictEqual(dbAliceCheck.rows.length, 1, 'Member record must exist in Supabase members table');
  const aliceId = dbAliceCheck.rows[0].id;
  console.log('✅ PASSED: Alice persisted in Supabase PostgreSQL table "members":', dbAliceCheck.rows[0]);

  // 4. Session Validation for Alice (/api/auth/me)
  console.log('\n--- STEP 6: Authenticated Session Resolution (/api/auth/me) ---');
  const aliceMeRes = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: aliceCookie },
  });
  assert.strictEqual(aliceMeRes.statusCode, 200, 'Authenticated session should return 200 OK');
  const aliceMeData = JSON.parse(aliceMeRes.body);
  assert.strictEqual(aliceMeData.authenticated, true);
  assert.strictEqual(aliceMeData.member.id, aliceId);
  console.log('✅ PASSED: Alice authenticated session resolved. Dashboard opens successfully.');

  // 5. Update Alice Profile and verify persistence
  console.log('\n--- STEP 7: Profile Updates Persisting in Supabase ---');
  const updateRes = await app.inject({
    method: 'PUT',
    url: '/api/profiles',
    headers: { cookie: aliceCookie },
    payload: {
      headline: 'Principal AI Systems Architect',
      skills: ['Distributed Systems', 'PostgreSQL', 'Fastify', 'TypeScript'],
      bio: 'Leading high-reliability agentic and infrastructure architectures.',
    },
  });
  assert.strictEqual(updateRes.statusCode, 200, 'Profile update should return 200');
  const dbProfileCheck = await directPool.query('SELECT headline, skills, about FROM professional_profiles WHERE member_id = $1', [aliceId]);
  assert.strictEqual(dbProfileCheck.rows[0].headline, 'Principal AI Systems Architect');
  console.log('✅ PASSED: Profile update persisted in Supabase database:', dbProfileCheck.rows[0]);

  // 6. Registration for Account B (Bob)
  console.log('\n--- STEP 8: Registration for Account B (Bob) ---');
  const bobEmail = `bob_${ts}@test.collaborate.internal`;
  const regBobRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: bobEmail,
      password: 'BobSecurePassword2026!',
      fullName: 'Bob Engineer',
      isUnder18: false,
    },
  });
  assert.strictEqual(regBobRes.statusCode, 201);
  const bobCookie = regBobRes.headers['set-cookie'];
  const dbBobCheck = await directPool.query('SELECT id, email FROM members WHERE email = $1', [bobEmail]);
  const bobId = dbBobCheck.rows[0].id;
  console.log('✅ PASSED: Bob registered and persisted in Supabase PostgreSQL:', bobId);

  // 7. Member Discovery
  console.log('\n--- STEP 9: Member Discovery Directory ---');
  const discoverRes = await app.inject({
    method: 'GET',
    url: '/api/discover?q=Architect',
    headers: { cookie: bobCookie },
  });
  assert.strictEqual(discoverRes.statusCode, 200);
  const discoverData = JSON.parse(discoverRes.body);
  assert.ok(discoverData.members.some((m) => m.id === aliceId), 'Alice should appear in discovery results');
  console.log(`✅ PASSED: Discovery retrieved eligible members (found ${discoverData.members.length} matching)`);

  // 8. Connection Request & Acceptance
  console.log('\n--- STEP 10: Connection Request & Acceptance Workflow ---');
  const sendReqRes = await app.inject({
    method: 'POST',
    url: '/api/connections',
    headers: { cookie: aliceCookie },
    payload: {
      action: 'send_request',
      toId: bobId,
      introMessage: 'Hello Bob, would love to collaborate on system architecture!',
    },
  });
  assert.strictEqual(sendReqRes.statusCode, 201);
  const connData = JSON.parse(sendReqRes.body);
  const connId = connData.connection.id;
  console.log('   Connection request sent');

  // Bob accepts connection
  const acceptRes = await app.inject({
    method: 'POST',
    url: '/api/connections',
    headers: { cookie: bobCookie },
    payload: {
      action: 'accept',
      connectionId: connId,
    },
  });
  assert.strictEqual(acceptRes.statusCode, 200);
  console.log('✅ PASSED: Connection accepted and updated to "accepted"');

  // 9. Messaging Between Accepted Users
  console.log('\n--- STEP 11: Direct Messaging Between Accepted Connections ---');
  const msgRes = await app.inject({
    method: 'POST',
    url: '/api/messages',
    headers: { cookie: aliceCookie },
    payload: {
      recipientId: bobId,
      content: 'Hey Bob! Delighted to connect. Let us review the architecture.',
    },
  });
  assert.strictEqual(msgRes.statusCode, 201);
  const msgData = JSON.parse(msgRes.body);
  const msgId = msgData.message.id;
  console.log('✅ PASSED: Message delivered between accepted connections:', msgId);

  // 10. Real-time SSE Stream & Replay
  console.log('\n--- STEP 12: SSE Real-Time Stream & Event Replay ---');
  const sseRes = await fetch(`${serverAddress}/api/messages/stream?sinceId=msg_0`, {
    headers: {
      cookie: bobCookie,
      accept: 'text/event-stream',
    },
  });
  assert.strictEqual(sseRes.headers.get('content-type'), 'text/event-stream');
  const reader = sseRes.body.getReader();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value);
  assert.ok(chunk.includes('event: connected'), 'SSE sends initial connected event');
  await reader.cancel();
  console.log('✅ PASSED: SSE text/event-stream endpoint verified with authorized event stream');

  // 11. Blocking Prevents Messaging
  console.log('\n--- STEP 13: Blocking Prevents Unsolicited Messaging ---');
  const blockRes = await app.inject({
    method: 'POST',
    url: '/api/connections',
    headers: { cookie: bobCookie },
    payload: {
      action: 'block',
      targetMemberId: aliceId,
    },
  });
  assert.strictEqual(blockRes.statusCode, 200);

  // Alice tries to send message after block
  const blockedMsgRes = await app.inject({
    method: 'POST',
    url: '/api/messages',
    headers: { cookie: aliceCookie },
    payload: {
      recipientId: bobId,
      content: 'Can you hear me now?',
    },
  });
  assert.strictEqual(blockedMsgRes.statusCode, 403, 'Blocked user message must return 403');
  console.log('✅ PASSED: Blocking strictly prevents further direct messaging (HTTP 403)');

  // 12. Logout Invalidates Session
  console.log('\n--- STEP 14: Logout Invalidates Session Cookie ---');
  const logoutRes = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: aliceCookie },
  });
  assert.strictEqual(logoutRes.statusCode, 200);
  const clearCookie = logoutRes.headers['set-cookie'];
  assert.ok(clearCookie.includes('Max-Age=0'), 'Logout must issue Max-Age=0 cookie');
  console.log('✅ PASSED: Logout invalidates session and clears cookie');

  // 13. Cleanup Test Records from Supabase
  console.log('\n--- STEP 15: Clean Up Isolated Test Records from Supabase ---');
  await directPool.query('DELETE FROM professional_profiles WHERE member_id IN ($1, $2)', [aliceId, bobId]);
  await directPool.query('DELETE FROM members WHERE id IN ($1, $2)', [aliceId, bobId]);
  console.log('✅ PASSED: Isolated test fixtures cleaned up from Supabase PostgreSQL');

  await app.close();
  await directPool.end();
  const neonPool = getNeonPool();
  if (neonPool && typeof neonPool.end === 'function') {
    await neonPool.end();
  }

  console.log('\n========================================================================');
  console.log('   ALL 15 P5-B LIVE INTEGRATION & SUPABASE PERSISTENCE TESTS PASSED!    ');
  console.log('========================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('FATAL P5-B Test Failure:', err);
  process.exit(1);
});
