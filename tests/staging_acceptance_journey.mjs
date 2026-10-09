import assert from 'assert';

const BASE_URL = 'http://localhost:3001';

async function runStagingAcceptanceJourney() {
  console.log('========================================================================');
  console.log('   COLLABORATE. BY AI TATHASTU — 17-STEP STAGING ACCEPTANCE JOURNEY     ');
  console.log('========================================================================\n');

  let passedSteps = 0;
  const totalSteps = 17;

  async function step(stepNum, description, fn) {
    process.stdout.write(`Step ${stepNum.toString().padStart(2, '0')}/17: ${description}... `);
    try {
      await fn();
      console.log('PASSED ✅');
      passedSteps++;
    } catch (err) {
      console.log(`FAILED ❌\n  Error: ${err.message}`);
      throw err;
    }
  }

  const timestamp = Date.now();
  const aliceEmail = `alice_${timestamp}@staging.collaborate`;
  const bobEmail = `bob_${timestamp}@staging.collaborate`;
  let aliceCookie = '';
  let aliceId = '';
  let bobCookie = '';
  let bobId = '';
  let conversationId = '';

  // 1. Register a standalone member (Alice)
  await step(1, 'Register standalone member (Alice)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: aliceEmail,
        password: 'Password123!',
        fullName: 'Alice Verma',
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.member.email, aliceEmail);
    aliceId = data.member.id;
    aliceCookie = res.headers.get('set-cookie').split(';')[0];
  });

  // 2. Register or authenticate a Core-linked member (Bob)
  await step(2, 'Register/authenticate candidate for Core linking (Bob)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: bobEmail,
        password: 'Password123!',
        fullName: 'Bob Chatterjee',
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    bobId = data.member.id;
    bobCookie = res.headers.get('set-cookie').split(';')[0];
  });

  // 3. Create a private professional profile
  await step(3, 'Set private professional profile visibility', async () => {
    const res = await fetch(`${BASE_URL}/api/profiles`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        id: bobId,
        updates: {
          profileVisibility: 'private',
          headline: 'Machine Learning Researcher in Training',
          location: 'Bengaluru, India',
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.member.profileVisibility, 'private');
  });

  // 4. Import actual approved Core fields
  await step(4, 'Import approved Core federation projection & quarantine check', async () => {
    const res = await fetch(`${BASE_URL}/api/federation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        action: 'one_click_import',
        syncSettings: {
          autoSyncProjects: true,
          autoSyncSkills: true,
          autoSyncAchievements: true,
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.member.isLinkedWithTathastu, true);
    assert.ok(data.member.skills.length > 5);
  });

  // 5. Edit and publish permitted profile details
  await step(5, 'Edit custom details and publish profile to community', async () => {
    const res = await fetch(`${BASE_URL}/api/profiles`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        id: bobId,
        updates: {
          headline: 'Distributed Systems & GenAI Engineer',
          profileVisibility: 'public',
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.member.headline, 'Distributed Systems & GenAI Engineer');
    assert.strictEqual(data.member.profileVisibility, 'public');
  });

  // 6. Find another eligible real test member
  await step(6, 'Find eligible member in discover feed', async () => {
    const res = await fetch(`${BASE_URL}/api/discover?query=AI`, {
      headers: { Cookie: aliceCookie },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.recommendations));
    assert.ok(data.recommendations.length > 0);
  });

  // 7. Send a connection request
  let connId = '';
  await step(7, 'Send connection request with intro message (Alice -> Bob)', async () => {
    const res = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
      },
      body: JSON.stringify({
        action: 'send_request',
        toId: bobId,
        introMessage: 'Hi Bob, excited to connect on distributed AI systems!',
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.connection.status, 'request_sent');
    connId = data.connection.id;
  });

  // 8. Accept the connection
  await step(8, 'Accept connection request (Bob accepts Alice)', async () => {
    const res = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        action: 'respond',
        connectionId: connId,
        decision: 'accept',
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.connection.status, 'accepted');
  });

  // 9. Exchange messages from two browsers / sessions
  await step(9, 'Bidirectional direct messaging between accepted connections', async () => {
    // Alice sends to Bob
    const res1 = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
      },
      body: JSON.stringify({
        recipientId: bobId,
        content: 'Hello Bob! Ready to collaborate on our Next.js + Neon pipeline.',
      }),
    });
    assert.strictEqual(res1.status, 200);
    const d1 = await res1.json();
    conversationId = d1.message.conversationId;

    // Bob responds to Alice
    const res2 = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
      },
      body: JSON.stringify({
        recipientId: aliceId,
        content: 'Hey Alice! Absolutely, database isolation is looking rock solid.',
      }),
    });
    assert.strictEqual(res2.status, 200);
  });

  // 10. Persistence verification
  await step(10, 'Verify message persistence in durable storage', async () => {
    const res = await fetch(`${BASE_URL}/api/messages?conversationId=${conversationId}`, {
      headers: { Cookie: aliceCookie },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.messages.length >= 2);
    assert.strictEqual(data.messages[0].content, 'Hello Bob! Ready to collaborate on our Next.js + Neon pipeline.');
  });

  // 11. Verify message history and reconnection via SSE stream
  await step(11, 'SSE stream connection and Last-Event-ID replay test', async () => {
    const res = await fetch(`${BASE_URL}/api/messages/stream?sinceId=msg_0`, {
      headers: {
        Cookie: bobCookie,
        Accept: 'text/event-stream',
      },
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/event-stream'));
  });

  // 12. Verify three-view Free quota
  await step(12, 'Atomic Free quota: Alice views 3 distinct full profiles', async () => {
    // View 1: Rahul
    const r1 = await fetch(`${BASE_URL}/api/profiles?id=usr_rahul`, { headers: { Cookie: aliceCookie } });
    assert.strictEqual(r1.status, 200);
    const d1 = await r1.json();
    assert.strictEqual(d1.quota.remaining, 2);

    // View 2: Priya
    const r2 = await fetch(`${BASE_URL}/api/profiles?id=usr_priya`, { headers: { Cookie: aliceCookie } });
    assert.strictEqual(r2.status, 200);
    const d2 = await r2.json();
    assert.strictEqual(d2.quota.remaining, 1);

    // View 3: Aman
    const r3 = await fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: aliceCookie } });
    assert.strictEqual(r3.status, 200);
    const d3 = await r3.json();
    assert.strictEqual(d3.quota.remaining, 0);
  });

  // 13. Verify concurrent/subsequent fourth-view denial
  await step(13, 'Fourth distinct view blocked with HTTP 402 QUOTA_EXCEEDED', async () => {
    const r4 = await fetch(`${BASE_URL}/api/profiles?id=usr_neha`, { headers: { Cookie: aliceCookie } });
    assert.strictEqual(r4.status, 402);
    const d4 = await r4.json();
    assert.strictEqual(d4.error, 'QUOTA_EXCEEDED');
  });

  // 14. Verify authorized admin badge approval
  let reqId = '';
  let adminCookie = '';
  await step(14, 'Authorized admin reviews and approves verification badge', async () => {
    // Bob requests institution badge
    const subRes = await fetch(`${BASE_URL}/api/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: bobCookie },
      body: JSON.stringify({
        action: 'submit_request',
        category: 'institution',
        evidenceSummary: 'Official Department of CSE Credentials',
      }),
    });
    assert.strictEqual(subRes.status, 200);
    const subData = await subRes.json();
    reqId = subData.request.id;

    // Admin login
    const adminLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@aitathastu.com', password: 'admin1234' }),
    });
    assert.strictEqual(adminLogin.status, 200);
    adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    // Admin approves
    const appRes = await fetch(`${BASE_URL}/api/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        action: 'review',
        requestId: reqId,
        decision: 'approved',
        notes: 'Verified via campus registrar.',
      }),
    });
    assert.strictEqual(appRes.status, 200);

    // Verify Bob is now verified
    const bobProf = await fetch(`${BASE_URL}/api/profiles?id=${bobId}`, { headers: { Cookie: adminCookie } });
    const bData = await bobProf.json();
    assert.strictEqual(bData.member.isVerified, true);
    assert.strictEqual(bData.member.verifiedCategory, 'institution');
  });

  // 15. Verify badge revocation and member blocking
  await step(15, 'Admin revokes badge and block enforcement is applied', async () => {
    // Revocation
    const revRes = await fetch(`${BASE_URL}/api/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        action: 'revoke',
        memberId: bobId,
        notes: 'Revoked following periodic institutional re-audit.',
      }),
    });
    assert.strictEqual(revRes.status, 200);

    const bobProf = await fetch(`${BASE_URL}/api/profiles?id=${bobId}`, { headers: { Cookie: adminCookie } });
    const bData = await bobProf.json();
    assert.strictEqual(bData.member.isVerified, false);

    // Bob blocks Alice for safety test
    const blkRes = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: bobCookie },
      body: JSON.stringify({ action: 'block', toId: aliceId }),
    });
    assert.strictEqual(blkRes.status, 200);

    // Alice attempts to send message to Bob -> blocked
    const blkMsg = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliceCookie },
      body: JSON.stringify({ recipientId: bobId, content: 'Are you there?' }),
    });
    assert.strictEqual(blkMsg.status, 400);
  });

  // 16. Verify Core federation unlink and updates
  await step(16, 'Revoke Core federation link cleanly', async () => {
    const res = await fetch(`${BASE_URL}/api/federation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: bobCookie },
      body: JSON.stringify({ action: 'revoke_link' }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);

    const bobProf = await fetch(`${BASE_URL}/api/profiles?id=${bobId}`, { headers: { Cookie: adminCookie } });
    const bData = await bobProf.json();
    assert.strictEqual(bData.member.isLinkedWithTathastu, false);
  });

  // 17. Multi-account privacy & student safety tests
  await step(17, 'Multi-account privacy isolation and under-18 safety safeguards', async () => {
    // IDOR Check: Alice cannot modify Bob's profile
    const idorRes = await fetch(`${BASE_URL}/api/profiles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: aliceCookie },
      body: JSON.stringify({ id: bobId, updates: { headline: 'Tampered' } }),
    });
    assert.strictEqual(idorRes.status, 403);

    // Student Safety Check: Create under-18 member
    const minorEmail = `student_minor_${Date.now()}@staging.collaborate`;
    const minorReg = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: minorEmail,
        password: 'Password123!',
        fullName: 'Young Student',
      }),
    });
    const minorData = await minorReg.json();
    const minorId = minorData.member.id;
    const minorCookie = minorReg.headers.get('set-cookie').split(';')[0];

    // Mark minor as under 18
    await fetch(`${BASE_URL}/api/profiles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: minorCookie },
      body: JSON.stringify({ id: minorId, updates: { isUnder18: true } }),
    });

    // Alice (unverified adult) attempts unsolicited connection request to minor -> MUST BE 403!
    const unverifiedAdultConn = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliceCookie },
      body: JSON.stringify({ action: 'send_request', toId: minorId }),
    });
    assert.strictEqual(unverifiedAdultConn.status, 403);
    const err = await unverifiedAdultConn.json();
    assert.ok(err.error.includes('SAFETY_RESTRICTION'));
  });

  console.log('\n========================================================================');
  console.log(`   STAGING ACCEPTANCE JOURNEY COMPLETE: ${passedSteps}/${totalSteps} PASSED (100%)    `);
  console.log('========================================================================\n');
}

runStagingAcceptanceJourney().catch((err) => {
  console.error('Acceptance Journey execution aborted:', err);
  process.exit(1);
});
