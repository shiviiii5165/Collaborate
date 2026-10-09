// Phase P3 Master Product & Engineering Acceptance Test Suite
// Demonstrates all 10 Acceptance Journeys (A through J) with real persistence and mock Core integration boundary.
import assert from 'assert';
import crypto from 'crypto';

const BASE_URL = 'http://localhost:3001';

async function runMasterProductAcceptance() {
  console.log('========================================================================');
  console.log('   COLLABORATE. BY AI TATHASTU — PHASE P3 MASTER PRODUCT ACCEPTANCE     ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  async function journey(name, fn) {
    process.stdout.write(`JOURNEY: ${name}... `);
    try {
      await fn();
      console.log('PASSED ✅');
      passed++;
    } catch (err) {
      console.log(`FAILED ❌ -> ${err.message}`);
      failed++;
    }
  }

  const runId = Date.now();

  // JOURNEY A — Independent account
  let independentUserId = '';
  let independentCookie = '';
  const indepEmail = `builder_${runId}@collaborate.local`;

  await journey('A — Independent Account Creation & Persistence', async () => {
    // 1. Register standalone account
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: indepEmail,
        password: 'Password123!',
        fullName: 'Independent Builder',
      }),
    });
    assert.strictEqual(regRes.status, 200);
    const regData = await regRes.json();
    assert.strictEqual(regData.success, true);
    independentUserId = regData.member.id;
    independentCookie = regRes.headers.get('set-cookie').split(';')[0];

    // 2. Edit profile with custom skills, headline, location, and visibility
    const editRes = await fetch(`${BASE_URL}/api/profiles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: independentCookie },
      body: JSON.stringify({
        id: independentUserId,
        updates: {
          headline: 'Full-Stack Distributed Systems Architect',
          about: 'Building resilient cloud-native networking infrastructure with Next.js and Postgres.',
          location: 'Pune, Maharashtra, India',
          skills: ['TypeScript', 'Distributed Systems', 'PostgreSQL', 'Docker'],
          collaborationInterests: ['High-throughput message queues', 'Open-source tooling'],
          profileVisibility: 'public',
        },
      }),
    });
    assert.strictEqual(editRes.status, 200);
    const editData = await editRes.json();
    assert.strictEqual(editData.member.headline, 'Full-Stack Distributed Systems Architect');

    // 3. Reload profile directly from database and verify persistence
    const getRes = await fetch(`${BASE_URL}/api/profiles?id=${independentUserId}`, {
      headers: { Cookie: independentCookie },
    });
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.strictEqual(getData.member.id, independentUserId);
    assert.strictEqual(getData.member.skills.length, 4);
    assert.strictEqual(getData.member.location, 'Pune, Maharashtra, India');
  });

  // JOURNEY B — Mock Core linking
  let linkedUserId = '';
  let linkedCookie = '';
  const coreEmail = `core_linked_${runId}@aitathastu.test`;

  await journey('B — Mock Core Linking & Approved Draft Projection', async () => {
    // 1. Authenticate through mock Core OIDC callback
    const oidcRes = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `code_core_${runId}`,
        codeVerifier: 'verifier_core_test',
        state: 'valid_state_param',
        mockClaims: {
          sub: `core_person_rahul`,
          email: coreEmail,
          fullName: 'Rahul Sharma',
          aud: 'collaborate_app',
        },
      }),
    });
    assert.strictEqual(oidcRes.status, 200);
    const oidcData = await oidcRes.json();
    assert.strictEqual(oidcData.success, true);
    linkedUserId = oidcData.member.id;
    linkedCookie = oidcRes.headers.get('set-cookie').split(';')[0];

    // 2. Fetch approved projection draft via Federation adapter
    const projRes = await fetch(`${BASE_URL}/api/federation?action=get_projection&sourcePersonId=core_person_rahul`);
    assert.strictEqual(projRes.status, 200);
    const projData = await projRes.json();
    assert.strictEqual(projData.approvedFields.fullName, 'Rahul Sharma');
    assert.ok(projData.approvedFields.projects.length >= 2);
    assert.ok(projData.quarantinedPrivateData.includes('Resumes (PDF/DOCX)'));

    // 3. Import projection into profile draft
    const importRes = await fetch(`${BASE_URL}/api/federation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: linkedCookie },
      body: JSON.stringify({
        action: 'one_click_import',
        sourcePersonId: 'core_person_rahul',
        syncSettings: {
          autoSyncProjects: true,
          autoSyncSkills: true,
          autoSyncAchievements: true,
        },
      }),
    });
    assert.strictEqual(importRes.status, 200);
    const importData = await importRes.json();
    assert.strictEqual(importData.member.isLinkedWithTathastu, true);
    assert.ok(importData.member.projects.some((p) => p.title === 'Tathastu AI Assistant'));

    // 4. Custom local edit preserving user control
    const customEdit = await fetch(`${BASE_URL}/api/profiles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: linkedCookie },
      body: JSON.stringify({
        id: linkedUserId,
        updates: { headline: 'Senior GenAI Engineer & Tathastu Fellow (Custom)' },
      }),
    });
    assert.strictEqual(customEdit.status, 200);
    const customData = await customEdit.json();
    assert.strictEqual(customData.member.headline, 'Senior GenAI Engineer & Tathastu Fellow (Custom)');
  });

  // JOURNEY C — Discovery
  await journey('C — People Discovery & Multi-Facet Filtering', async () => {
    // 1. Search all members
    const allRes = await fetch(`${BASE_URL}/api/discover`);
    assert.strictEqual(allRes.status, 200);
    const allData = await allRes.json();
    assert.ok(allData.results.length >= 1);

    // 2. Filter by specialization
    const specRes = await fetch(`${BASE_URL}/api/discover?specialization=Generative%20AI`);
    assert.strictEqual(specRes.status, 200);
    const specData = await specRes.json();
    assert.ok(specData.results.length >= 1);

    // 3. Filter by skill
    const skillRes = await fetch(`${BASE_URL}/api/discover?skill=Python`);
    assert.strictEqual(skillRes.status, 200);
    const skillData = await skillRes.json();
    assert.ok(skillData.results.length >= 1);

    // 4. Filter by query text
    const queryRes = await fetch(`${BASE_URL}/api/discover?q=Independent`);
    assert.strictEqual(queryRes.status, 200);
    const queryData = await queryRes.json();
    assert.ok(queryData.results.some((m) => m.id === independentUserId));
  });

  // JOURNEY D — Connections
  let connectionId = '';
  await journey('D — Connection Lifecycle: Request, Pending, Accept, Withdraw & Report', async () => {
    // 1. Independent Builder sends connection request to Core-linked member
    const reqRes = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: independentCookie },
      body: JSON.stringify({
        action: 'send_request',
        toId: linkedUserId,
        introMessage: 'Hi Rahul, would love to collaborate on distributed RAG architectures!',
      }),
    });
    assert.strictEqual(reqRes.status, 200);
    const reqData = await reqRes.json();
    assert.strictEqual(reqData.success, true);
    connectionId = reqData.connection.id;

    // 2. Linked member checks pending received requests
    const recRes = await fetch(`${BASE_URL}/api/connections`, {
      headers: { Cookie: linkedCookie },
    });
    assert.strictEqual(recRes.status, 200);
    const recData = await recRes.json();
    assert.ok(recData.pendingReceived.some((r) => r.connectionId === connectionId));

    // 3. Linked member accepts connection request
    const acceptRes = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: linkedCookie },
      body: JSON.stringify({
        action: 'respond',
        connectionId,
        decision: 'accept',
      }),
    });
    assert.strictEqual(acceptRes.status, 200);
    const acceptData = await acceptRes.json();
    assert.strictEqual(acceptData.connection.status, 'accepted');

    // 4. Test request withdrawal with a 3rd user Charlie
    const charlieReg = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `charlie_${runId}@collab.local`, password: 'Password123!', fullName: 'Charlie Davis' }),
    });
    const charlieCookie = charlieReg.headers.get('set-cookie').split(';')[0];
    const charlieId = (await charlieReg.json()).member.id;

    const charlieReq = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: charlieCookie },
      body: JSON.stringify({ action: 'send_request', toId: independentUserId, introMessage: 'Test withdraw' }),
    });
    const cConnId = (await charlieReq.json()).connection.id;

    // Charlie withdraws request
    const withdrawRes = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: charlieCookie },
      body: JSON.stringify({ action: 'withdraw', connectionId: cConnId }),
    });
    assert.strictEqual(withdrawRes.status, 200);
    assert.strictEqual((await withdrawRes.json()).withdrawn, true);

    // 5. Submit an abuse report
    const reportRes = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: charlieCookie },
      body: JSON.stringify({ action: 'report', toId: independentUserId, reason: 'spam_test', details: 'Test report' }),
    });
    assert.strictEqual(reportRes.status, 200);
    assert.strictEqual((await reportRes.json()).report.reason, 'spam_test');
  });

  // JOURNEY E — Messaging
  await journey('E — Direct Messaging: Authorization, Persistence, and Blocking', async () => {
    // 1. Independent Builder sends message to accepted connection
    const sendRes1 = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: independentCookie },
      body: JSON.stringify({
        recipientId: linkedUserId,
        content: 'Hey Rahul, congratulations on connecting! Let us build something awesome.',
      }),
    });
    assert.strictEqual(sendRes1.status, 200);
    const msgData1 = await sendRes1.json();
    assert.strictEqual(msgData1.success, true);
    const convId = msgData1.message.conversationId;

    // 2. Linked member reads messages and replies
    const getMsgs = await fetch(`${BASE_URL}/api/messages?conversationId=${convId}`, {
      headers: { Cookie: linkedCookie },
    });
    assert.strictEqual(getMsgs.status, 200);
    const getMsgsData = await getMsgs.json();
    assert.ok(getMsgsData.messages.length >= 1);

    const sendRes2 = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: linkedCookie },
      body: JSON.stringify({
        recipientId: independentUserId,
        content: 'Thanks! Absolutely, let us sync up on the architecture.',
      }),
    });
    assert.strictEqual(sendRes2.status, 200);

    // 3. Unconnected stranger attempts direct message -> MUST BE 400
    const strangerReg = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `stranger_${runId}@collab.local`, password: 'Password123!', fullName: 'Stranger' }),
    });
    const strangerCookie = strangerReg.headers.get('set-cookie').split(';')[0];
    const strangerMsg = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: strangerCookie },
      body: JSON.stringify({ recipientId: linkedUserId, content: 'Spam hello!' }),
    });
    assert.strictEqual(strangerMsg.status, 400);

    // 4. Blocking immediately cuts off direct messaging
    const blockRes = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: independentCookie },
      body: JSON.stringify({ action: 'block', toId: linkedUserId }),
    });
    assert.strictEqual(blockRes.status, 200);

    // Now message attempt between blocked users must be denied
    const blockedMsg = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: linkedCookie },
      body: JSON.stringify({ recipientId: independentUserId, content: 'Are you there?' }),
    });
    assert.strictEqual(blockedMsg.status, 400);
  });

  // JOURNEY F — Recommendations
  await journey('F — Explainable Professional Recommendations & Privacy Filtering', async () => {
    // 1. Fetch recommendations for Independent Builder
    const discRes = await fetch(`${BASE_URL}/api/discover`, {
      headers: { Cookie: independentCookie },
    });
    assert.strictEqual(discRes.status, 200);
    const discData = await discRes.json();
    assert.ok(Array.isArray(discData.recommendations));

    if (discData.recommendations.length > 0) {
      const rec = discData.recommendations[0];
      assert.ok(rec.matchScore >= 10);
      assert.ok(rec.reason.length > 5); // Truthful grounded explanation
      assert.notStrictEqual(rec.member.id, independentUserId); // Exclude self
      assert.notStrictEqual(rec.member.profileVisibility, 'private'); // Exclude private
    }
  });

  // JOURNEY G — Verification
  await journey('G — Admin Verification: Evidence Review, Anti-Self Approval & Revocation', async () => {
    // 1. Independent Builder submits verification request for institutional category
    const subRes = await fetch(`${BASE_URL}/api/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: independentCookie },
      body: JSON.stringify({
        action: 'submit_request',
        category: 'institution',
        evidenceSummary: 'Faculty ID and Institutional Research Profile',
      }),
    });
    assert.strictEqual(subRes.status, 200);
    const reqId = (await subRes.json()).request.id;

    // 2. Non-admin attempts approval -> MUST BE 403
    const nonAdminApprove = await fetch(`${BASE_URL}/api/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: independentCookie },
      body: JSON.stringify({ action: 'review_request', requestId: reqId, decision: 'approved', notes: 'Self approve' }),
    });
    assert.strictEqual(nonAdminApprove.status, 403);

    // 3. Admin logs in and approves
    const adminLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@aitathastu.com', password: 'admin1234' }),
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const adminApprove = await fetch(`${BASE_URL}/api/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ action: 'review_request', requestId: reqId, decision: 'approved', notes: 'Official credentials verified.' }),
    });
    assert.strictEqual(adminApprove.status, 200);

    // Check member has verified badge
    const checkProf = await fetch(`${BASE_URL}/api/profiles?id=${independentUserId}`, { headers: { Cookie: adminCookie } });
    assert.strictEqual((await checkProf.json()).member.isVerified, true);

    // 4. Admin revokes verification
    const revokeRes = await fetch(`${BASE_URL}/api/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ action: 'revoke_badge', memberId: independentUserId, reason: 'Periodic compliance re-audit' }),
    });
    assert.strictEqual(revokeRes.status, 200);

    const checkRev = await fetch(`${BASE_URL}/api/profiles?id=${independentUserId}`, { headers: { Cookie: adminCookie } });
    assert.strictEqual((await checkRev.json()).member.isVerified, false);
  });

  // JOURNEY H — Membership & Quota
  await journey('H — Server-Authoritative Free Quota & Sandbox Premium Entitlement', async () => {
    // 1. Create a fresh free user
    const quotaUserEmail = `quota_user_${runId}@test.local`;
    const qReg = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: quotaUserEmail, password: 'Password123!', fullName: 'Quota Explorer' }),
    });
    const qData = await qReg.json();
    const qMemberId = qData.member.id;
    const qCookie = qReg.headers.get('set-cookie').split(';')[0];

    // 2. View 3 distinct profiles (allowed)
    const v1 = await fetch(`${BASE_URL}/api/profiles?id=usr_rahul`, { headers: { Cookie: qCookie } });
    const v2 = await fetch(`${BASE_URL}/api/profiles?id=usr_priya`, { headers: { Cookie: qCookie } });
    const v3 = await fetch(`${BASE_URL}/api/profiles?id=usr_neha`, { headers: { Cookie: qCookie } });
    assert.strictEqual(v1.status, 200);
    assert.strictEqual(v2.status, 200);
    assert.strictEqual(v3.status, 200);

    // 3. View 4th distinct profile -> MUST BE 402 QUOTA_EXCEEDED
    const v4 = await fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: qCookie } });
    assert.strictEqual(v4.status, 402);
    const errData = await v4.json();
    assert.strictEqual(errData.error, 'QUOTA_EXCEEDED');

    // 4. Activate sandbox premium via signed billing webhook
    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || 'collaborate_webhook_secret_sandbox_sig_2026';
    const payloadObj = {
      eventType: 'payment.completed',
      memberId: qMemberId,
      plan: 'premium',
      amount: 49900,
      currency: 'INR',
    };
    const signature = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(payloadObj)).digest('hex');

    const whRes = await fetch(`${BASE_URL}/api/billing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookSignature: signature,
        payload: payloadObj,
      }),
    });
    assert.strictEqual(whRes.status, 200);

    // 5. With Premium active, 4th distinct profile is now successfully viewed
    const v4Prem = await fetch(`${BASE_URL}/api/profiles?id=usr_aman`, { headers: { Cookie: qCookie } });
    assert.strictEqual(v4Prem.status, 200);
  });

  // JOURNEY I — Auto-Sync Simulation (All 10 Core sync events)
  await journey('I — Future Core Auto-Synchronization Simulation (10 Events)', async () => {
    const syncEvents = [
      'new_eligible_member',
      'profile_updated',
      'new_confirmed_project',
      'approved_skill_updated',
      'visibility_changed',
      'consent_revoked',
      'user_unlinked',
      'source_record_deleted',
      'user_deactivated',
      'conflicting_local_override',
    ];

    for (const ev of syncEvents) {
      const res = await fetch(`${BASE_URL}/api/federation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'simulate_sync_event',
          eventType: ev,
          sourcePersonId: 'core_person_rahul',
          payload: {
            profile: { skills: ['LangChain', 'RAG', 'Agentic Workflows'] },
            project: { title: 'Autonomous Multi-Agent System', description: 'Simulated Core project' },
            skillName: 'Quantum Machine Learning',
            discoverable: true,
          },
        }),
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.report.eventType, ev);
    }
  });

  // JOURNEY J — Security (IDOR, BOLA, Underage Safeguarding)
  await journey('J — Comprehensive Security Isolation & Student Safeguarding', async () => {
    // 1. IDOR Check: User Charlie attempts to tamper with Independent Builder's profile -> MUST BE 403
    const charlieReg = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `tamper_${runId}@collab.local`, password: 'Password123!', fullName: 'Tamperer' }),
    });
    const tamperCookie = charlieReg.headers.get('set-cookie').split(';')[0];

    const idorRes = await fetch(`${BASE_URL}/api/profiles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: tamperCookie },
      body: JSON.stringify({ id: independentUserId, updates: { headline: 'Hacked Headline' } }),
    });
    assert.strictEqual(idorRes.status, 403);

    // 2. Student Safeguarding: Create minor account
    const minorReg = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `minor_${runId}@school.edu`,
        password: 'Password123!',
        fullName: 'Student Minor',
        isUnder18: true,
      }),
    });
    const minorData = await minorReg.json();
    const minorId = minorData.member.id;

    // Verify minor is private by default and not discoverable
    assert.strictEqual(minorData.member.isUnder18, true);
    assert.strictEqual(minorData.member.profileVisibility, 'private');
    assert.strictEqual(minorData.member.discoverable, false);

    // Unverified adult attempts unsolicited connection request to minor -> MUST BE 403
    const unsolicitedConn = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tamperCookie },
      body: JSON.stringify({ action: 'send_request', toId: minorId }),
    });
    assert.strictEqual(unsolicitedConn.status, 403);
    const err = await unsolicitedConn.json();
    assert.ok(err.error.includes('SAFETY_RESTRICTION'));
  });

  console.log(`\n========================================================================`);
  console.log(`   MASTER PRODUCT ACCEPTANCE COMPLETE: ${passed}/${passed + failed} JOURNEYS PASSED`);
  console.log(`========================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runMasterProductAcceptance().catch((err) => {
  console.error('Fatal execution error in master product acceptance:', err);
  process.exit(1);
});
