// End-to-End Security & Workflow Validation Test Suite
import assert from 'assert';

const BASE_URL = 'http://localhost:3001';

async function runTests() {
  console.log('=== STARTING COLLABORATE E2E SECURITY & WORKFLOW VERIFICATION ===\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`TEST: ${name}... `);
      await fn();
      console.log('PASSED ✅');
      passed++;
    } catch (err) {
      console.log(`FAILED ❌ -> ${err.message}`);
      failed++;
    }
  }

  // 1. Standalone Registration (Mode B)
  const testEmail = `builder_${Date.now()}@aitathastu.test`;
  let testUserCookie = '';
  let testUserId = '';

  await test('1. Standalone Registration with Password Hashing', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'Password123!',
        fullName: 'Arjun Sen',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.member.email, testEmail);
    testUserId = data.member.id;

    const cookie = res.headers.get('set-cookie');
    assert.ok(cookie && cookie.includes('collaborate_session'));
    testUserCookie = cookie.split(';')[0];
  });

  // 2. Login Verification
  await test('2. Standalone Login with Valid Credentials', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'Password123!',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.member.id, testUserId);
  });

  await test('3. Login Rejects Invalid Password', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'WrongPassword!',
      }),
    });
    assert.strictEqual(res.status, 401);
  });

  // 4. Session Identification & IDOR Protection
  await test('4. Profile Update Enforces Ownership (IDOR Prevention)', async () => {
    // Attempt to update another user's profile with testUserCookie
    const res = await fetch(`${BASE_URL}/api/profiles`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: testUserCookie,
      },
      body: JSON.stringify({
        id: 'usr_rahul', // target is different user
        updates: { headline: 'HACKED HEADLINE' },
      }),
    });
    assert.strictEqual(res.status, 403);
  });

  // 5. Free Quota Enforcement (3 Distinct Profiles Daily Limit)
  await test('5. Free Quota Allows 3 Distinct Profile Views and Blocks 4th', async () => {
    // Viewer is testUserId (Free tier). Target profiles: usr_priya, usr_aman, usr_neha
    // View 1: Priya
    const r1 = await fetch(`${BASE_URL}/api/profiles?id=usr_priya`, {
      headers: { Cookie: testUserCookie },
    });
    assert.strictEqual(r1.status, 200);
    const d1 = await r1.json();
    assert.strictEqual(d1.quota.remaining, 2);

    // Re-view Priya (Same target today must NOT consume extra quota)
    const r1_re = await fetch(`${BASE_URL}/api/profiles?id=usr_priya`, {
      headers: { Cookie: testUserCookie },
    });
    assert.strictEqual(r1_re.status, 200);
    const d1_re = await r1_re.json();
    assert.strictEqual(d1_re.quota.remaining, 2);

    // View 2: Aman
    const r2 = await fetch(`${BASE_URL}/api/profiles?id=usr_aman`, {
      headers: { Cookie: testUserCookie },
    });
    assert.strictEqual(r2.status, 200);
    const d2 = await r2.json();
    assert.strictEqual(d2.quota.remaining, 1);

    // View 3: Neha
    const r3 = await fetch(`${BASE_URL}/api/profiles?id=usr_neha`, {
      headers: { Cookie: testUserCookie },
    });
    assert.strictEqual(r3.status, 200);
    const d3 = await r3.json();
    assert.strictEqual(d3.quota.remaining, 0);

    // View 4: Attempt 4th distinct user (usr_rahul) -> MUST BE BLOCKED!
    const r4 = await fetch(`${BASE_URL}/api/profiles?id=usr_rahul`, {
      headers: { Cookie: testUserCookie },
    });
    assert.strictEqual(r4.status, 402);
    const d4 = await r4.json();
    assert.strictEqual(d4.error, 'QUOTA_EXCEEDED');
  });

  // 6. Messaging Security Boundary
  await test('6. Unconnected Member Cannot Send Direct Message', async () => {
    // testUserId is NOT connected with usr_aman
    const res = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: testUserCookie,
      },
      body: JSON.stringify({
        recipientId: 'usr_aman',
        content: 'Unsolicited message attempt',
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  // 7. Admin Verification Security Boundary
  await test('7. Ordinary Member Cannot Approve Verification Requests', async () => {
    const res = await fetch(`${BASE_URL}/api/verification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: testUserCookie,
      },
      body: JSON.stringify({
        action: 'review',
        requestId: 'vreq_neha',
        decision: 'approved',
        notes: 'Unauthorized approval attempt',
      }),
    });
    assert.strictEqual(res.status, 403);
  });

  // 8. OIDC Central Authorization & Profile Federation
  await test('8. OIDC Callback Exchanges Token and Creates Projection Draft', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'valid_oidc_authorization_code',
        codeVerifier: 'valid_pkce_code_verifier_123',
        state: 'valid_state_param',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.member.email, 'rahulsharma@gmail.com');
  });

  // 9. Sandbox Premium Entitlement Upgrade
  await test('9. Premium Upgrade Bypasses Daily Quota', async () => {
    const res = await fetch(`${BASE_URL}/api/billing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: testUserCookie,
      },
      body: JSON.stringify({
        action: 'upgrade_premium',
        isSandboxTest: true,
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.plan, 'premium');

    // Retrying the 4th distinct user view now succeeds with unlimited access!
    const r4_retry = await fetch(`${BASE_URL}/api/profiles?id=usr_rahul`, {
      headers: { Cookie: testUserCookie },
    });
    assert.strictEqual(r4_retry.status, 200);
    const d4_retry = await r4_retry.json();
    assert.ok(d4_retry.quota.remaining > 100);
  });

  console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
