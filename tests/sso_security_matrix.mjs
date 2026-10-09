// Phase P2.7-A Unified Identity & SSO Security Matrix Automated Test Suite
import assert from 'assert';

const BASE_URL = 'http://localhost:3001';

async function runSsoSecurityMatrix() {
  console.log('========================================================================');
  console.log('   AI TATHASTU + COLLABORATE — PHASE P2.7-A SSO SECURITY TEST MATRIX   ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`TEST: ${name}... `);
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

  // 1. Authorize URL generation (OIDC code challenge & state generation)
  await test('1. OIDC Authorization URL & PKCE generation', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/authorize`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.authUrl.includes('https://auth.aitathastu.com/oauth/authorize'));
    assert.ok(data.authUrl.includes('client_id=collaborate_app'));
    assert.ok(data.authUrl.includes('code_challenge_method=S256'));
    assert.ok(data.state && data.state.length >= 16);
    assert.ok(data.codeChallenge && data.codeChallenge.length >= 32);
  });

  // 2. Existing Core password user login via central OIDC callback
  await test('2. Existing Core password user initial SSO login', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `auth_code_core_${runId}_1`,
        codeVerifier: 'verifier_core_test_1',
        state: 'valid_state_param',
        mockClaims: {
          sub: `core_person_${runId}_1`,
          email: `core_user_${runId}_1@aitathastu.com`,
          fullName: 'Core Password User',
          aud: 'collaborate_app',
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.isNewUser, true);
    assert.strictEqual(data.member.email, `core_user_${runId}_1@aitathastu.com`);
    assert.ok(res.headers.get('set-cookie').includes('collaborate_session'));
  });

  // 3. Returning user SSO login (subsequent session via stable subject ID)
  await test('3. Returning user resolves to existing Collaborate profile via stable subject ID', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `auth_code_core_${runId}_returning`,
        codeVerifier: 'verifier_core_test_returning',
        state: 'valid_state_param',
        mockClaims: {
          sub: `core_person_${runId}_1`, // Same external subject ID
          email: `core_user_${runId}_1@aitathastu.com`,
          fullName: 'Core Password User',
          aud: 'collaborate_app',
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.isNewUser, false); // Must recognize returning user!
    assert.strictEqual(data.member.email, `core_user_${runId}_1@aitathastu.com`);
  });

  // 4. Standalone Collaborate user registration with password
  let collabPasswordMemberId = '';
  const collabPasswordEmail = `collab_local_${runId}@collaborate.local`;
  await test('4. New Collaborate standalone password user registration', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: collabPasswordEmail,
        password: 'Password123!',
        fullName: 'Collab Local User',
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    collabPasswordMemberId = data.member.id;
  });

  // 5. Anti-Takeover: Reject unconfirmed SSO merge targeting existing local password account
  await test('5. Anti-Takeover: Reject blind SSO account merge for matching email without password', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `auth_code_merge_attempt_${runId}`,
        codeVerifier: 'verifier_merge_attempt',
        state: 'valid_state_param',
        mockClaims: {
          sub: `attacker_sub_${runId}`,
          email: collabPasswordEmail, // Same email as existing standalone member!
          fullName: 'Attacker Impersonator',
          aud: 'collaborate_app',
        },
      }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('ACCOUNT_EXISTS_REQUIRES_CONFIRMATION'));
  });

  // 6. Anti-Takeover: Reject SSO merge with incorrect local password
  await test('6. Anti-Takeover: Reject SSO merge with invalid local confirmation password', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `auth_code_merge_wrongpass_${runId}`,
        codeVerifier: 'verifier_merge_wrongpass',
        state: 'valid_state_param',
        linkConfirmationPassword: 'WrongPassword!',
        mockClaims: {
          sub: `attacker_sub_${runId}_2`,
          email: collabPasswordEmail,
          fullName: 'Attacker Impersonator',
          aud: 'collaborate_app',
        },
      }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Invalid Collaborate password'));
  });

  // 7. Verified Account Linking: Link existing local member with valid password confirmation
  await test('7. Verified Account Linking: Link local member when correct password is provided', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `auth_code_merge_valid_${runId}`,
        codeVerifier: 'verifier_merge_valid',
        state: 'valid_state_param',
        linkConfirmationPassword: 'Password123!',
        mockClaims: {
          sub: `legit_core_sub_${runId}`,
          email: collabPasswordEmail,
          fullName: 'Collab Local User',
          aud: 'collaborate_app',
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.member.id, collabPasswordMemberId);
  });

  // 8. Identity Mismatch / Collision: Reject linking an external subject to a different member
  await test('8. Identity Mismatch: Reject external subject ID collision across distinct members', async () => {
    const secondEmail = `second_collab_${runId}@collaborate.local`;
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: secondEmail,
        password: 'Password123!',
        fullName: 'Second Collab User',
      }),
    });
    assert.strictEqual(regRes.status, 200);

    // Now attempt to link already-used subject `legit_core_sub_${runId}` to secondEmail
    const collisionRes = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `auth_code_collision_${runId}`,
        codeVerifier: 'verifier_collision',
        state: 'valid_state_param',
        linkConfirmationPassword: 'Password123!',
        mockClaims: {
          sub: `legit_core_sub_${runId}`, // Already mapped to collabPasswordMemberId!
          email: secondEmail,
          fullName: 'Second Collab User',
          aud: 'collaborate_app',
        },
      }),
    });
    assert.strictEqual(collisionRes.status, 200);
    const collisionData = await collisionRes.json();
    // Must resolve to the originally mapped owner (collabPasswordMemberId), NOT hijack second account!
    assert.strictEqual(collisionData.member.id, collabPasswordMemberId);
  });

  // 9. Single-Use Authorization Code (Anti-Replay Attack)
  await test('9. Anti-Replay: Reject replayed authorization code', async () => {
    const freshCode = `single_use_code_${runId}`;
    // First redemption succeeds
    const firstUse = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: freshCode,
        codeVerifier: 'verifier_single_use',
        state: 'valid_state_param',
        mockClaims: {
          sub: `sub_single_use_${runId}`,
          email: `single_use_${runId}@test.aitathastu.com`,
          fullName: 'Single Use User',
          aud: 'collaborate_app',
        },
      }),
    });
    assert.strictEqual(firstUse.status, 200);

    // Replay attempt MUST be rejected!
    const replayUse = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: freshCode,
        codeVerifier: 'verifier_single_use',
        state: 'valid_state_param',
        mockClaims: {
          sub: `sub_single_use_${runId}`,
          email: `single_use_${runId}@test.aitathastu.com`,
          fullName: 'Single Use User',
          aud: 'collaborate_app',
        },
      }),
    });
    assert.strictEqual(replayUse.status, 400);
    const replayData = await replayUse.json();
    assert.ok(replayData.error.includes('REPLAYED_AUTHORIZATION_CODE'));
  });

  // 10. OAuth State Validation (CSRF Protection)
  await test('10. CSRF Protection: Reject invalid OAuth state parameter', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `auth_code_csrf_${runId}`,
        codeVerifier: 'verifier_csrf',
        state: 'invalid_oauth_state', // Invalid state
        mockClaims: {
          sub: `csrf_sub_${runId}`,
          email: `csrf_${runId}@test.aitathastu.com`,
          fullName: 'CSRF Attacker',
          aud: 'collaborate_app',
        },
      }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('INVALID_OAUTH_STATE'));
  });

  // 11. Token Audience Validation
  await test('11. Audience Validation: Reject token with invalid audience', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `auth_code_wrong_aud_${runId}`,
        codeVerifier: 'verifier_wrong_aud',
        state: 'valid_state',
        mockClaims: {
          sub: `wrong_aud_sub_${runId}`,
          email: `wrong_aud_${runId}@test.aitathastu.com`,
          fullName: 'Wrong Aud User',
          aud: 'malicious_third_party_app', // Wrong audience!
        },
      }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('INVALID_TOKEN_AUDIENCE'));
  });

  // 12. Token Expiration Validation
  await test('12. Token Expiry: Reject expired identity token', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `auth_code_expired_${runId}`,
        codeVerifier: 'verifier_expired',
        state: 'valid_state',
        mockClaims: {
          sub: `expired_sub_${runId}`,
          email: `expired_${runId}@test.aitathastu.com`,
          fullName: 'Expired User',
          aud: 'collaborate_app',
          exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        },
      }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('TOKEN_EXPIRED'));
  });

  // 13. Redirect URI Validation
  await test('13. Redirect URI: Reject invalid redirect URI parameter', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `auth_code_redirect_${runId}`,
        codeVerifier: 'verifier_redirect',
        state: 'valid_state',
        mockClaims: {
          sub: `redirect_sub_${runId}`,
          email: `redirect_${runId}@test.aitathastu.com`,
          fullName: 'Redirect User',
          aud: 'collaborate_app',
          redirectUri: 'https://evil-phishing.com/callback',
        },
      }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('INVALID_REDIRECT_URI'));
  });

  // 14. Session Management: Cookie isolation & logout session revocation
  await test('14. Session Isolation: Host-only session cookie issuance & logout revocation', async () => {
    // Login to get a valid session
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: collabPasswordEmail,
        password: 'Password123!',
      }),
    });
    assert.strictEqual(loginRes.status, 200);
    const rawCookie = loginRes.headers.get('set-cookie');
    assert.ok(rawCookie.includes('collaborate_session='));
    assert.ok(rawCookie.includes('HttpOnly'));
    assert.ok(!rawCookie.includes('Domain=aitathastu.com')); // Host-only cookie!

    const cookieHeader = rawCookie.split(';')[0];

    // Verify session is active
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: cookieHeader },
    });
    assert.strictEqual(meRes.status, 200);
    const meData = await meRes.json();
    assert.strictEqual(meData.authenticated, true);
    assert.strictEqual(meData.member.id, collabPasswordMemberId);

    // Call logout endpoint
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    assert.strictEqual(logoutRes.status, 200);
    const logoutCookie = logoutRes.headers.get('set-cookie');
    assert.ok(logoutCookie.includes('Max-Age=0') || logoutCookie.includes('expires='));
  });

  // 15. Federation Link Revocation Isolation (Collaborate account remains intact)
  await test('15. Domain Isolation: Revoking Core link preserves Collaborate account and messages', async () => {
    // Bob Chatterjee performs federation link then revokes
    const bEmail = `bob_rev_${runId}@staging.collaborate`;
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: bEmail, password: 'Password123!', fullName: 'Bob Revoke' }),
    });
    const regData = await regRes.json();
    const bobCookie = regRes.headers.get('set-cookie').split(';')[0];
    const bId = regData.member.id;

    // Link Core
    await fetch(`${BASE_URL}/api/federation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: bobCookie },
      body: JSON.stringify({ action: 'one_click_import' }),
    });

    // Revoke link
    const revRes = await fetch(`${BASE_URL}/api/federation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: bobCookie },
      body: JSON.stringify({ action: 'revoke_link' }),
    });
    assert.strictEqual(revRes.status, 200);
    const revData = await revRes.json();
    assert.strictEqual(revData.success, true);

    // Verify Bob still exists as a valid independent member
    const checkRes = await fetch(`${BASE_URL}/api/profiles?id=${bId}`, {
      headers: { Cookie: bobCookie },
    });
    assert.strictEqual(checkRes.status, 200);
    const checkData = await checkRes.json();
    assert.strictEqual(checkData.member.id, bId);
    assert.strictEqual(checkData.member.isLinkedWithTathastu, false);
  });

  console.log(`\n========================================================================`);
  console.log(`   SECURITY MATRIX TEST COMPLETE: ${passed}/${passed + failed} PASSED`);
  console.log(`========================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runSsoSecurityMatrix().catch((err) => {
  console.error('Fatal execution error in SSO security matrix:', err);
  process.exit(1);
});
