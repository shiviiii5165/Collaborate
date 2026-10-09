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

  // 2. Establish the 3 distinct targets allowed by the free quota
  await fetch(`${BASE_URL}/api/profiles?id=usr_rahul`, { headers: { Cookie: userCookie } });
  await fetch(`${BASE_URL}/api/profiles?id=usr_priya`, { headers: { Cookie: userCookie } });
  await fetch(`${BASE_URL}/api/profiles?id=usr_neha`, { headers: { Cookie: userCookie } });

  // 3. Dispatch 10 simultaneous concurrent requests under load:
  // 5 requests re-reading permitted targets (must all return 200)
  // 5 requests attempting to access the 4th distinct target (must ALL return 402 QUOTA_EXCEEDED)
  console.log('Dispatching 10 concurrent requests simultaneously (5 permitted re-reads, 5 blocked 4th-target)...');
  const requests = [
    // Re-reads to permitted targets (must succeed without incrementing distinct count)
    fetch(`${BASE_URL}/api/profiles?id=usr_rahul`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_rahul`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_priya`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_neha`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_neha`, { headers: { Cookie: userCookie } }),
    // Simultaneous race against 4th distinct target (MUST ALL BE 402)
    fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: userCookie } }),
    fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: userCookie } }),
  ];

  const responses = await Promise.all(requests);
  const statuses = responses.map((r) => r.status);

  const okCount = statuses.filter((s) => s === 200).length;
  const quotaBlockedCount = statuses.filter((s) => s === 402).length;

  console.log(`Concurrency Results: ${okCount} allowed (200), ${quotaBlockedCount} quota-blocked (402).`);

  assert.strictEqual(okCount, 5, 'Expected exactly 5 successful re-read requests for permitted targets');
  assert.strictEqual(quotaBlockedCount, 5, 'Expected exactly 5 blocked requests for the 4th distinct target');

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
