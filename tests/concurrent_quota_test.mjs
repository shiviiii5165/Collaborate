import assert from 'assert';

const BASE_URL = 'http://localhost:3001';

async function runConcurrentQuotaTest() {
  console.log('=== STARTING COLLABORATE CONCURRENT QUOTA TRANSACTION RACE TEST ===\n');

  const timestamp = Date.now();
  const testEmail = `racer_${timestamp}@quota.test`;

  // 1. Register test user
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'Password123!', fullName: 'Concurrency Tester' }),
  });
  assert.strictEqual(regRes.status, 200);
  const regData = await regRes.json();
  const userCookie = regRes.headers.get('set-cookie').split(';')[0];

  console.log(`Registered user ${testEmail} for concurrency test.`);

  // Targets to view
  const targetIds = ['usr_rahul', 'usr_priya', 'usr_neha', 'usr_aman'];

  // 2. Fire 10 simultaneous concurrent view requests across the 4 distinct targets
  // 3 targets are eligible, 1 is the 4th distinct target which MUST be denied
  console.log('Dispatching 10 concurrent requests simultaneously...');
  const requests = [
    // Multiple requests to target 1 (same target today should NOT consume extra)
    fetch(`${BASE_URL}/api/profiles?id=usr_rahul`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_rahul`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_rahul`, { headers: { Cookie: userCookie } }),
    // Target 2
    fetch(`${BASE_URL}/api/profiles?id=usr_priya`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_priya`, { headers: { Cookie: userCookie } }),
    // Target 3
    fetch(`${BASE_URL}/api/profiles?id=usr_neha`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_neha`, { headers: { Cookie: userCookie } }),
    // Target 4 (4th distinct target - MUST BE DENIED)
    fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: userCookie } }),
  ];

  const responses = await Promise.all(requests);
  const statuses = responses.map((r) => r.status);

  const okCount = statuses.filter((s) => s === 200).length;
  const quotaBlockedCount = statuses.filter((s) => s === 402).length;

  console.log(`Concurrency Results: ${okCount} allowed (200), ${quotaBlockedCount} quota-blocked (402).`);

  // Target 1, 2, 3 requests should all succeed (7 requests total across the 3 permitted targets)
  // All 3 requests to Target 4 (usr_aman) MUST return 402 QUOTA_EXCEEDED!
  assert.strictEqual(okCount, 7, 'Expected exactly 7 successful requests for the 3 distinct targets');
  assert.strictEqual(quotaBlockedCount, 3, 'Expected exactly 3 blocked requests for the 4th distinct target');

  // Verify that subsequent requests to the 4th distinct target continue to be blocked
  const retry4th = await fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: userCookie } });
  assert.strictEqual(retry4th.status, 402);
  const retryData = await retry4th.json();
  assert.strictEqual(retryData.error, 'QUOTA_EXCEEDED');

  console.log('Atomic concurrency & quota boundary validated under simultaneous request load! ✅\n');
}

runConcurrentQuotaTest().catch((err) => {
  console.error('Concurrent quota test failed:', err);
  process.exit(1);
});
