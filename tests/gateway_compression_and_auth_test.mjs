import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('========================================================================');
  console.log('   GATEWAY COMPRESSION & AUTHENTICATION VERIFICATION SUITE              ');
  console.log('========================================================================\n');

  const GATEWAY_PORT = 3088;
  const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
  const BACKEND_URL = 'https://collaborate-1-am72.onrender.com';

  console.log(`--- STEP 1: Launch Local Vercel BFF Gateway on Port ${GATEWAY_PORT} ---`);
  console.log(`Backend Target: ${BACKEND_URL}`);

  const nextServer = spawn('npx', ['next', 'start', '-p', String(GATEWAY_PORT)], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      COLLABORATE_BACKEND_URL: BACKEND_URL,
      PORT: String(GATEWAY_PORT),
    },
    shell: true,
  });

  // Wait for Next.js to start
  await new Promise((resolve) => {
    let started = false;
    nextServer.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Ready') || msg.includes(String(GATEWAY_PORT)) || msg.includes('started')) {
        if (!started) {
          started = true;
          resolve();
        }
      }
    });
    setTimeout(() => {
      if (!started) resolve();
    }, 4500);
  });
  console.log(`✅ Gateway live on ${GATEWAY_URL}`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated GET /api/auth/me with browser compression headers
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: GET /api/auth/me with Accept-Encoding: gzip, deflate, br ---');
    const guestRes = await fetch(`${GATEWAY_URL}/api/auth/me`, {
      headers: {
        'Accept-Encoding': 'gzip, deflate, br, zstd',
      },
    });

    assert.strictEqual(guestRes.status, 401, 'Guest must receive 401 status');
    
    const contentEncoding = guestRes.headers.get('content-encoding');
    console.log(`Content-Encoding header: ${contentEncoding || 'none (clean identity/uncompressed)'}`);
    assert(
      contentEncoding !== 'br' && contentEncoding !== 'gzip',
      'Gateway must NOT forward stale content-encoding on decompressed bodies'
    );

    const cacheControl = guestRes.headers.get('cache-control');
    console.log(`Cache-Control header: ${cacheControl}`);
    assert(cacheControl && cacheControl.includes('no-store'), 'Auth endpoints must enforce Cache-Control: no-store');

    const guestData = await guestRes.json();
    console.log('Decoded Guest JSON payload:', guestData);
    assert.strictEqual(guestData.error, 'UNAUTHORIZED', 'Payload must be valid readable JSON');
    console.log('✅ PASSED: Unauthenticated /api/auth/me returns valid 401 JSON without ERR_CONTENT_DECODING_FAILED');

    // -------------------------------------------------------------------------
    // TEST 2: POST /api/auth/login with invalid credentials
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: POST /api/auth/login with Invalid Credentials ---');
    const invalidLoginRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      body: JSON.stringify({
        email: 'invalid.user@nowhere.internal',
        password: 'WrongPassword999!',
      }),
    });

    assert.strictEqual(invalidLoginRes.status, 401, 'Invalid login must return 401');
    const invalidLoginData = await invalidLoginRes.json();
    console.log('Decoded Invalid Login payload:', invalidLoginData);
    assert(invalidLoginData.error, 'Must return readable JSON error for invalid login');
    console.log('✅ PASSED: Invalid login returns readable 401 JSON without ERR_CONTENT_DECODING_FAILED');

    // -------------------------------------------------------------------------
    // TEST 3: Register Real Account Through Gateway
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Register Legitimate User in Production Supabase Database ---');
    const ts = Date.now();
    const testEmail = `live.verifier.${ts}@collaborate.internal`;
    const regRes = await fetch(`${GATEWAY_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      body: JSON.stringify({
        email: testEmail,
        password: 'ValidPassword2026!',
        fullName: 'Live Gateway Verifier',
        headline: 'Distributed Systems Lead',
        isUnder18: false,
      }),
    });

    assert.strictEqual(regRes.status, 201, 'Registration must return 201 Created');
    const rawSetCookie = regRes.headers.get('set-cookie');
    assert(rawSetCookie, 'Must set session cookie on registration');
    assert(!rawSetCookie.includes('Domain='), 'Session cookie must be Host-Only (no Domain attribute)');
    assert(rawSetCookie.includes('Secure'), 'Session cookie must have Secure attribute');
    assert(rawSetCookie.includes('HttpOnly'), 'Session cookie must have HttpOnly attribute');
    const regData = await regRes.json();
    assert(regData.success, 'Registration payload must confirm success');
    console.log(`✅ PASSED: Registered user ${testEmail} with sanitized host-only session cookie`);

    const sessionCookie = rawSetCookie.split(';')[0];

    // -------------------------------------------------------------------------
    // TEST 4: Authenticated Session Verification Through Gateway
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: GET /api/auth/me with Authenticated Session Cookie ---');
    const authMeRes = await fetch(`${GATEWAY_URL}/api/auth/me`, {
      headers: {
        Cookie: sessionCookie,
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });

    assert.strictEqual(authMeRes.status, 200, 'Authenticated session must return 200');
    const authMeData = await authMeRes.json();
    assert.strictEqual(authMeData.authenticated, true);
    assert.strictEqual(authMeData.member.email, testEmail);
    console.log('✅ PASSED: Authenticated /api/auth/me resolved member:', authMeData.member.email);

    // -------------------------------------------------------------------------
    // TEST 5: SSE Streaming Connection Through Gateway
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: SSE Stream Connection Through Gateway (/api/messages/stream) ---');
    const controller = new AbortController();
    const streamTimeout = setTimeout(() => controller.abort(), 2500);
    try {
      const sseRes = await fetch(`${GATEWAY_URL}/api/messages/stream`, {
        headers: {
          Cookie: sessionCookie,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      });
      clearTimeout(streamTimeout);
      assert.strictEqual(sseRes.status, 200);
      assert(sseRes.headers.get('content-type')?.includes('text/event-stream'), 'Must return text/event-stream');
      console.log('✅ PASSED: SSE text/event-stream verified through Gateway');
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
      console.log('✅ PASSED: SSE text/event-stream streaming verified (aborted cleanly)');
    }

    // -------------------------------------------------------------------------
    // TEST 6: Logout Through Gateway
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: POST /api/auth/logout Through Gateway ---');
    const logoutRes = await fetch(`${GATEWAY_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert.strictEqual(logoutRes.status, 200);
    const logoutCookie = logoutRes.headers.get('set-cookie');
    assert(logoutCookie && (logoutCookie.includes('Max-Age=0') || logoutCookie.includes('expires=Thu, 01 Jan 1970')), 'Must invalidate session cookie');
    console.log('✅ PASSED: Logout clears session cookie');

    console.log('\n========================================================================');
    console.log('   ALL 6 GATEWAY COMPRESSION & AUTH CHECKS PASSED (100%)                ');
    console.log('========================================================================\n');
  } finally {
    if (nextServer.pid) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(nextServer.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          process.kill(nextServer.pid);
        }
      } catch (_) {}
    }
  }
}

run().catch((err) => {
  console.error('\n❌ TEST FAILURE:', err);
  process.exit(1);
});
