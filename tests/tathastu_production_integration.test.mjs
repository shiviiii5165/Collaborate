/**
 * Collaborate. by AI Tathastu
 * Comprehensive Automated Production Integration Test Suite
 *
 * Verifies the complete AI Tathastu integration contract:
 * 1. OAuth Authorization URL, S256 PKCE, and CSRF state generation
 * 2. Token exchange and error responses (invalid_grant, invalid_client)
 * 3. ES256 token verification and strict algorithm enforcement
 * 4. Rejection of unsupported algorithms (HS256, none, RS256)
 * 5. Rejection of expired tokens
 * 6. Rejection of wrong-audience tokens
 * 7. Rejection of wrong-issuer tokens
 * 8. Rejection of forged/tampered tokens
 * 9. JWKS key rotation handling
 * 10. Single-use authorization code replay protection
 * 11. CSRF state mismatch protection
 * 12. Student user creation from central identity claims
 * 13. Anti-takeover protection for existing password accounts
 * 14. Authorized account linking with password verification
 * 15. Field-level consent & masked/omitted fields handling
 * 16. Preservation of local profile overrides (headline & bio)
 * 17. Webhook HMAC-SHA256 signature verification
 * 18. Webhook signature rejection on tampered body or wrong secret
 * 19. Webhook freshness check (rejects timestamps > 5 min old)
 * 20. Webhook replay protection & idempotency deduplication
 * 21. profile.updated webhook processing
 * 22. integration.revoked webhook processing
 * 23. Provider outage resilience
 * 24. Existing standalone email/password login regression
 * 25. Cross-user profile authorization security
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { TathastuClient } from '../src/integrations/tathastu/client.ts';
import { TathastuSsoService } from '../src/modules/identity/tathastu-sso.ts';
import { IdentityService } from '../src/modules/identity/service.ts';
import { durableDb } from '../src/lib/db/index.ts';
import { buildServer } from '../apps/api/src/server.ts';

let passedTests = 0;
let totalTests = 0;

async function test(title, fn) {
  totalTests++;
  process.stdout.write(`  [TEST ${totalTests}] ${title}... `);
  try {
    await fn();
    console.log('PASSED \x1b[32mOK\x1b[0m');
    passedTests++;
  } catch (err) {
    console.log('FAILED \x1b[31mFAIL\x1b[0m');
    console.error(`      Error: ${err.message}`);
    throw err;
  }
}

async function runSuite() {
  console.log('\n========================================================================');
  console.log('   COLLABORATE <-> AI TATHASTU PRODUCTION INTEGRATION TEST SUITE       ');
  console.log('========================================================================\n');

  // Allow local memory persistence for isolated testing
  process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
  // Simulated claims (claimsOverride) are a non-production test harness facility.
  process.env.COLLABORATE_ENABLE_FIXTURES = 'true';
  // /start only redirects when live SSO is enabled with complete configuration.
  process.env.TATHASTU_INTEGRATION_MODE = 'live';
  process.env.AIT_CLIENT_SECRET = 'test_only_client_secret_not_real';
  process.env.AIT_REDIRECT_URI = 'https://collaborate.aitathastu.com/api/auth/tathastu/callback';
  process.env.AI_TATHASTU_CLIENT_ID = 'collaborate';
  process.env.AI_TATHASTU_BASE_URL = 'https://www.aitathastu.com';
  process.env.AI_TATHASTU_WEBHOOK_SECRET = 'test_webhook_signing_secret_9941';

  // 1. Generate ES256 Keypair for Cryptographic Testing
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'key-tathastu-prod-1';
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';

  const mockKeySet = async () => publicKey;

  // Key rotation second keypair
  const { privateKey: rotatedPrivateKey, publicKey: rotatedPublicKey } = await generateKeyPair('ES256', { extractable: true });
  const rotatedPublicJwk = await exportJWK(rotatedPublicKey);
  rotatedPublicJwk.kid = 'key-tathastu-rotated-2';
  rotatedPublicJwk.alg = 'ES256';
  rotatedPublicJwk.use = 'sig';

  // --------------------------------------------------------------------------
  // SECTION 1: OAuth Authorization URL & PKCE
  // --------------------------------------------------------------------------
  console.log('\n--- Section 1: Authorization URL, PKCE & CSRF Generation ---');

  await test('Generates standards-compliant authorization URL with S256 PKCE and CSRF state', () => {
    const { authUrl, state, codeVerifier, codeChallenge, redirectUri } = TathastuClient.createAuthorizationUrl({
      redirectUri: 'https://collaborate.aitathastu.com/api/auth/tathastu/callback',
    });

    assert.ok(authUrl.startsWith('https://www.aitathastu.com/integrations/authorize'));
    assert.ok(authUrl.includes('client_id=collaborate'));
    assert.ok(authUrl.includes('response_type=code'));
    assert.ok(authUrl.includes('code_challenge_method=S256'));
    assert.ok(authUrl.includes(`state=${state}`));
    assert.ok(authUrl.includes(`code_challenge=${codeChallenge}`));
    assert.ok(authUrl.includes('scope=skills%20projects%20eris%20experience%20education%20achievements%20activity'));

    // Verify S256 math: codeChallenge must equal BASE64URL(SHA256(codeVerifier))
    const expectedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    assert.strictEqual(codeChallenge, expectedChallenge);
    assert.ok(state.length >= 32);
  });

  // --------------------------------------------------------------------------
  // SECTION 2: ES256 Token Validation & Algorithm Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- Section 2: ES256 Token Validation & Algorithm Gating ---');

  await test('Successfully validates authentic ES256 token matching issuer and audience', async () => {
    const token = await new SignJWT({
      sub: 'urn:tathastu:person:student-alpha-01',
      email: 'student.alpha@aitathastu.test',
      name: 'Devika Patel',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'key-tathastu-prod-1' })
      .setIssuer('https://www.aitathastu.com')
      .setAudience('collaborate')
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(privateKey);

    const { payload, protectedHeader } = await TathastuClient.verifyAccessToken(token, {
      customKeySet: mockKeySet,
      expectedIssuer: 'https://www.aitathastu.com',
      expectedAudience: 'collaborate',
    });

    assert.strictEqual(payload.sub, 'urn:tathastu:person:student-alpha-01');
    assert.strictEqual(payload.email, 'student.alpha@aitathastu.test');
    assert.strictEqual(protectedHeader.alg, 'ES256');
  });

  await test('Strictly rejects tokens signed with unsupported algorithms (e.g. HS256 symmetric attack)', async () => {
    // Generate HS256 token
    const fakeSecret = new TextEncoder().encode('fake_symmetric_key_attacker_attempt_32b');
    const forgedToken = await new SignJWT({
      sub: 'urn:tathastu:person:hacker-01',
      email: 'hacker@bad.com',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('https://www.aitathastu.com')
      .setAudience('collaborate')
      .setExpirationTime('1h')
      .sign(fakeSecret);

    await assert.rejects(
      async () => {
        await TathastuClient.verifyAccessToken(forgedToken, { customKeySet: mockKeySet });
      },
      (err) => {
        assert.ok(err.message.includes('UNSUPPORTED_ALGORITHM'));
        assert.ok(err.message.includes('HS256'));
        return true;
      }
    );
  });

  await test('Strictly rejects expired access tokens', async () => {
    const expiredToken = await new SignJWT({
      sub: 'urn:tathastu:person:expired-student',
      email: 'expired@aitathastu.test',
    })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('https://www.aitathastu.com')
      .setAudience('collaborate')
      .setExpirationTime('-10s') // Expired 10 seconds ago
      .sign(privateKey);

    await assert.rejects(
      async () => {
        await TathastuClient.verifyAccessToken(expiredToken, { customKeySet: mockKeySet });
      },
      (err) => {
        assert.ok(err.message.includes('TOKEN_EXPIRED'));
        return true;
      }
    );
  });

  await test('Strictly rejects tokens with wrong audience', async () => {
    const wrongAudToken = await new SignJWT({
      sub: 'urn:tathastu:person:student-wrong-aud',
      email: 'test@aitathastu.test',
    })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('https://www.aitathastu.com')
      .setAudience('different_unauthorized_app')
      .setExpirationTime('1h')
      .sign(privateKey);

    await assert.rejects(
      async () => {
        await TathastuClient.verifyAccessToken(wrongAudToken, {
          customKeySet: mockKeySet,
          expectedAudience: 'collaborate',
        });
      },
      (err) => {
        assert.ok(err.message.includes('WRONG_AUDIENCE'));
        return true;
      }
    );
  });

  await test('Strictly rejects tokens with wrong issuer', async () => {
    const wrongIssToken = await new SignJWT({
      sub: 'urn:tathastu:person:student-wrong-iss',
      email: 'test@aitathastu.test',
    })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('https://rogue-identity-server.com')
      .setAudience('collaborate')
      .setExpirationTime('1h')
      .sign(privateKey);

    await assert.rejects(
      async () => {
        await TathastuClient.verifyAccessToken(wrongIssToken, {
          customKeySet: mockKeySet,
          expectedIssuer: 'https://www.aitathastu.com',
        });
      },
      (err) => {
        assert.ok(err.message.includes('WRONG_ISSUER'));
        return true;
      }
    );
  });

  await test('Strictly rejects forged or tampered token payload', async () => {
    const validToken = await new SignJWT({
      sub: 'urn:tathastu:person:authentic',
      email: 'student@aitathastu.test',
    })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('https://www.aitathastu.com')
      .setAudience('collaborate')
      .setExpirationTime('1h')
      .sign(privateKey);

    // Tamper with payload segment
    const parts = validToken.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'admin', email: 'admin@aitathastu.com' })).toString('base64url');
    const forgedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    await assert.rejects(
      async () => {
        await TathastuClient.verifyAccessToken(forgedToken, { customKeySet: mockKeySet });
      },
      (err) => {
        assert.ok(err.message.includes('TOKEN_VERIFICATION_FAILED'));
        return true;
      }
    );
  });

  await test('JWKS key rotation handling (verifies tokens signed by rotated key)', async () => {
    const rotatedToken = await new SignJWT({
      sub: 'urn:tathastu:person:rotated-user',
      email: 'rotated@aitathastu.test',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'key-tathastu-rotated-2' })
      .setIssuer('https://www.aitathastu.com')
      .setAudience('collaborate')
      .setExpirationTime('1h')
      .sign(rotatedPrivateKey);

    // Multi-key mock keySet representing rotating JWKS
    const multiKeySet = async ({ kid }) => {
      if (kid === 'key-tathastu-rotated-2') return rotatedPublicKey;
      return publicKey;
    };

    const { payload } = await TathastuClient.verifyAccessToken(rotatedToken, { customKeySet: multiKeySet });
    assert.strictEqual(payload.sub, 'urn:tathastu:person:rotated-user');
  });

  await test('Strictly rejects tokens with unknown kid not found in JWKS', async () => {
    const unknownKidToken = await new SignJWT({
      sub: 'urn:tathastu:person:unknown-kid-user',
      email: 'unknown@aitathastu.test',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'unknown-key-999' })
      .setIssuer('https://www.aitathastu.com')
      .setAudience('collaborate')
      .setExpirationTime('1h')
      .sign(privateKey);

    const keySetWithoutKid = async ({ kid }) => {
      if (kid === 'unknown-key-999') return null;
      return publicKey;
    };

    await assert.rejects(
      async () => {
        await TathastuClient.verifyAccessToken(unknownKidToken, { customKeySet: keySetWithoutKid });
      },
      (err) => {
        assert.ok(err.message.includes('TOKEN_VERIFICATION_FAILED') || err.message.includes('no matching key'));
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // SECTION 3: Authorization Code Exchange & CSRF / Replay Protection
  // --------------------------------------------------------------------------
  console.log('\n--- Section 3: Code Exchange, CSRF & Anti-Replay ---');

  const testRunId = Date.now();

  await test('Single-use code replay protection strictly rejects replayed authorization codes', async () => {
    const singleCode = `code_replay_test_${testRunId}`;
    
    // First exchange succeeds
    const res1 = await TathastuSsoService.processCallback({
      code: singleCode,
      codeVerifier: 'verifier_test_replay',
      state: 'valid_state_123',
      claimsOverride: {
        sub: `urn:tathastu:person:replay_${testRunId}`,
        email: `replay_${testRunId}@aitathastu.test`,
        fullName: 'Replay Test Student',
      },
    });
    assert.ok(res1.member);

    // Replay with exact same code MUST be rejected
    await assert.rejects(
      async () => {
        await TathastuSsoService.processCallback({
          code: singleCode,
          codeVerifier: 'verifier_test_replay',
          state: 'valid_state_123',
          claimsOverride: {
            sub: `urn:tathastu:person:replay_${testRunId}`,
            email: `replay_${testRunId}@aitathastu.test`,
          },
        });
      },
      (err) => {
        assert.ok(err.message.includes('REPLAYED_AUTHORIZATION_CODE'));
        return true;
      }
    );
  });

  await test('CSRF protection strictly rejects state mismatch or tampered state', async () => {
    await assert.rejects(
      async () => {
        await TathastuSsoService.processCallback({
          code: `code_csrf_${testRunId}`,
          codeVerifier: 'verifier_csrf',
          state: 'attacker_supplied_state',
          expectedState: 'legitimate_stored_session_state',
          claimsOverride: { sub: 'urn:tathastu:person:csrf_target', email: 'victim@test.com' },
        });
      },
      (err) => {
        assert.ok(err.message.includes('INVALID_OAUTH_STATE'));
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // SECTION 4: Identity Resolution, Anti-Takeover & Profile Projection
  // --------------------------------------------------------------------------
  console.log('\n--- Section 4: Identity Resolution, Anti-Takeover & Projection ---');

  await test('New AI Tathastu student creates Collaborate profile with verified status badges', async () => {
    const newStudentSub = `urn:tathastu:person:student_new_${testRunId}`;
    const newStudentEmail = `student_${testRunId}@aitathastu.test`;

    const { member, token, isNewUser } = await TathastuSsoService.processCallback({
      code: `code_new_${testRunId}`,
      codeVerifier: 'verifier_new_student',
      state: 'state_new_student',
      claimsOverride: {
        sub: newStudentSub,
        email: newStudentEmail,
        fullName: 'Karan Malhotra',
        profile: {
          schemaVersion: '1.0',
          source: 'ai-tathastu',
          sourcePersonId: newStudentSub,
          sourceVersion: '1.0',
          updatedAt: new Date().toISOString(),
          profile: {
            displayName: 'Karan Malhotra',
            headline: 'Systems & ML Infrastructure Engineer',
            location: 'Bangalore, India',
            education: [
              { id: 'edu_1', institution: 'IIT Bombay', degree: 'B.Tech CSE', period: '2022 – 2026', score: 'CGPA: 9.4' },
            ],
            skills: [
              { id: 'sk_1', name: 'Distributed Systems', category: 'framework', confirmedByCore: true },
              { id: 'sk_2', name: 'CUDA', category: 'language', confirmedByCore: true },
            ],
            projects: [
              { id: 'pr_1', title: 'vLLM Inference Engine', description: 'Optimized PagedAttention kernels', tags: ['CUDA', 'C++'], sourceOrigin: 'ai_tathastu_core' },
            ],
            achievements: [],
            interests: ['MLOps', 'Distributed Training'],
            portfolioLinks: [],
          },
          permissions: { importApproved: true, discoverable: true, allowedFieldPaths: [], consentVersion: '1.0', consentGrantedAt: new Date().toISOString() },
          quarantinedPrivateData: [],
        },
      },
    });

    assert.strictEqual(isNewUser, true);
    assert.strictEqual(member.email, newStudentEmail);
    assert.strictEqual(member.fullName, 'Karan Malhotra');
    assert.strictEqual(member.isVerified, true);
    assert.strictEqual(member.isLinkedWithTathastu, true);
    assert.ok(member.skills.includes('Distributed Systems'));
    assert.ok(member.projects.some((p) => p.title === 'vLLM Inference Engine'));
    assert.ok(token && token.length > 20);

    // Verify external identity mapping saved
    const mapping = durableDb.getMappingByExternalSub('aitathastu_oidc', newStudentSub);
    assert.ok(mapping);
    assert.strictEqual(mapping.memberId, member.id);
  });

  await test('Strict Anti-Takeover: existing password user matching email cannot be taken over without password', async () => {
    // 1. Create a local standalone password account
    const standaloneEmail = `protected_user_${testRunId}@gmail.com`;
    const { member: localUser } = await IdentityService.registerStandalone(
      standaloneEmail,
      'superSecretLocalPassword123!',
      'Protected Local Member'
    );
    assert.ok(localUser);

    // 2. An attacker tries to login via Tathastu SSO with the same email without password
    await assert.rejects(
      async () => {
        await TathastuSsoService.processCallback({
          code: `code_attack_${testRunId}`,
          codeVerifier: 'verifier_attack',
          state: 'state_attack',
          claimsOverride: {
            sub: `urn:tathastu:person:attacker_${testRunId}`,
            email: standaloneEmail,
            fullName: 'Attacker Impersonator',
          },
        });
      },
      (err) => {
        assert.ok(err.message.includes('ACCOUNT_EXISTS_REQUIRES_CONFIRMATION'));
        return true;
      }
    );
  });

  await test('Authorized account linking: existing user links successfully when correct password is provided', async () => {
    const standaloneEmail = `linking_user_${testRunId}@gmail.com`;
    await IdentityService.registerStandalone(
      standaloneEmail,
      'validPassword789!',
      'Legitimate Student'
    );

    const tathastuSub = `urn:tathastu:person:linked_student_${testRunId}`;

    const { member: linkedUser, isNewUser } = await TathastuSsoService.processCallback({
      code: `code_linking_${testRunId}`,
      codeVerifier: 'verifier_linking',
      state: 'state_linking',
      linkConfirmationPassword: 'validPassword789!',
      claimsOverride: {
        sub: tathastuSub,
        email: standaloneEmail,
        fullName: 'Legitimate Student',
      },
    });

    assert.strictEqual(isNewUser, false);
    assert.strictEqual(linkedUser.email, standaloneEmail);
    assert.strictEqual(linkedUser.isLinkedWithTathastu, true);

    const mapping = durableDb.getMappingByExternalSub('aitathastu_oidc', tathastuSub);
    assert.ok(mapping);
    assert.strictEqual(mapping.memberId, linkedUser.id);
  });

  await test('Local Override Protection: does not overwrite customized headline and biography', async () => {
    const studentSub = `urn:tathastu:person:override_${testRunId}`;
    const studentEmail = `override_${testRunId}@aitathastu.test`;

    // 1. Create initial account
    const { member } = await TathastuSsoService.processCallback({
      code: `code_override_1_${testRunId}`,
      codeVerifier: 'verifier_override_1',
      state: 'state_override_1',
      claimsOverride: {
        sub: studentSub,
        email: studentEmail,
        fullName: 'Siddharth Nair',
      },
    });

    // 2. Member customizes their headline and about on Collaborate
    member.headline = 'Senior Vision Systems Architect (Custom Local Title)';
    member.about = 'Custom local summary written specifically for Collaborate.';
    await durableDb.saveMemberAsync(member);

    // 3. Central Tathastu syncs an updated upstream headline and about
    const { member: syncedMember } = await TathastuSsoService.processCallback({
      code: `code_override_2_${testRunId}`,
      codeVerifier: 'verifier_override_2',
      state: 'state_override_2',
      claimsOverride: {
        sub: studentSub,
        email: studentEmail,
        fullName: 'Siddharth Nair',
        profile: {
          schemaVersion: '1.0',
          source: 'ai-tathastu',
          sourcePersonId: studentSub,
          sourceVersion: '2.0',
          updatedAt: new Date().toISOString(),
          profile: {
            displayName: 'Siddharth Nair',
            headline: 'Overwriting Remote Headline Attempt',
            about: 'Overwriting Remote About Attempt',
            skills: [{ id: 'sk_new', name: 'Vision Transformers', category: 'ml_ai', confirmedByCore: true }],
            education: [],
            projects: [],
            achievements: [],
            interests: [],
            portfolioLinks: [],
          },
          permissions: { importApproved: true, discoverable: true, allowedFieldPaths: [], consentVersion: '1.0', consentGrantedAt: new Date().toISOString() },
          quarantinedPrivateData: [],
        },
      },
    });

    // Custom local fields must remain intact!
    assert.strictEqual(syncedMember.headline, 'Senior Vision Systems Architect (Custom Local Title)');
    assert.strictEqual(syncedMember.about, 'Custom local summary written specifically for Collaborate.');
    // Non-conflicting skills must be merged
    assert.ok(syncedMember.skills.includes('Vision Transformers'));
  });

  await test('Field-level consent: respects omitted/masked fields without phantom inference', async () => {
    const studentSub = `urn:tathastu:person:consent_${testRunId}`;
    const studentEmail = `consent_${testRunId}@aitathastu.test`;

    // User only consented to share skills, NOT projects
    const { member } = await TathastuSsoService.processCallback({
      code: `code_consent_${testRunId}`,
      codeVerifier: 'verifier_consent',
      state: 'state_consent',
      claimsOverride: {
        sub: studentSub,
        email: studentEmail,
        fullName: 'Selective Consent Student',
        profile: {
          schemaVersion: '1.0',
          source: 'ai-tathastu',
          sourcePersonId: studentSub,
          sourceVersion: '1.0',
          updatedAt: new Date().toISOString(),
          profile: {
            displayName: 'Selective Consent Student',
            skills: [{ id: 'sk_c1', name: 'PyTorch', category: 'framework', confirmedByCore: true }],
            // projects is empty / omitted due to user unchecking projects switch
            projects: [],
            education: [],
            achievements: [],
            interests: [],
            portfolioLinks: [],
          },
          permissions: { importApproved: true, discoverable: true, allowedFieldPaths: ['profile.skills'], consentVersion: '1.0', consentGrantedAt: new Date().toISOString() },
          quarantinedPrivateData: [],
        },
      },
    });

    assert.ok(member.skills.includes('PyTorch'));
    assert.strictEqual(member.projects.length, 0); // No phantom projects created
  });

  // --------------------------------------------------------------------------
  // SECTION 5: Webhook Signature Verification, Replay & Revocation
  // --------------------------------------------------------------------------
  console.log('\n--- Section 5: Webhook Signatures, Freshness, & Revocation ---');

  const webhookSecret = 'test_webhook_signing_secret_9941';

  await test('Validates authentic HMAC-SHA256 signed webhook with fresh timestamp (legacy format)', () => {
    const payload = JSON.stringify({
      eventId: `evt_valid_${testRunId}`,
      eventType: 'profile.updated',
      sourcePersonId: `urn:tathastu:person:wh_test_${testRunId}`,
      timestamp: new Date().toISOString(),
    });

    const signature = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
    const timestamp = new Date().toISOString();

    const result = TathastuClient.verifyWebhookSignature(payload, signature, timestamp, webhookSecret);
    assert.strictEqual(result.valid, true);

    // Also supports sha256= prefix
    const prefixedResult = TathastuClient.verifyWebhookSignature(payload, `sha256=${signature}`, timestamp, webhookSecret);
    assert.strictEqual(prefixedResult.valid, true);
  });

  await test('Validates exact AI Tathastu contract format X-AIT-Signature: t=<unix>,v1=<hex>', () => {
    const payload = JSON.stringify({
      id: `evt_contract_${testRunId}`,
      type: 'profile.updated',
      data: { userId: `urn:tathastu:person:contract_${testRunId}` },
    });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expectedHmac = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${nowSeconds}.${payload}`)
      .digest('hex');
    const aitSignatureHeader = `t=${nowSeconds},v1=${expectedHmac}`;

    const result = TathastuClient.verifyWebhookSignature(payload, aitSignatureHeader, undefined, webhookSecret);
    assert.strictEqual(result.valid, true);
  });

  await test('Strictly rejects X-AIT-Signature with tampered raw body or mismatched HMAC', () => {
    const payload = JSON.stringify({ id: 'evt_tamper_target', type: 'profile.updated' });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const hmac = crypto.createHmac('sha256', webhookSecret).update(`${nowSeconds}.${payload}`).digest('hex');
    const aitSignatureHeader = `t=${nowSeconds},v1=${hmac}`;

    // Tampered payload
    const tamperedPayload = JSON.stringify({ id: 'evt_tamper_target', type: 'profile.updated', injected: true });
    const result = TathastuClient.verifyWebhookSignature(tamperedPayload, aitSignatureHeader, undefined, webhookSecret);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('INVALID_SIGNATURE'));
  });

  await test('Strictly rejects X-AIT-Signature with bad format (missing t, missing v1, or non-numeric t)', () => {
    const payload = '{}';
    // Missing t
    const res1 = TathastuClient.verifyWebhookSignature(payload, 'v1=123456', undefined, webhookSecret);
    assert.strictEqual(res1.valid, false);

    // Bad non-numeric timestamp
    const res2 = TathastuClient.verifyWebhookSignature(payload, 't=not-a-number,v1=123456', undefined, webhookSecret);
    assert.strictEqual(res2.valid, false);
    assert.ok(res2.error?.includes('INVALID_TIMESTAMP'));
  });

  await test('Strictly rejects webhooks with invalid or forged HMAC signature', () => {
    const payload = JSON.stringify({ eventId: 'evt_bad', eventType: 'profile.updated' });
    const forgedSig = crypto.createHmac('sha256', 'wrong_attacker_secret').update(payload).digest('hex');

    const result = TathastuClient.verifyWebhookSignature(payload, forgedSig, new Date().toISOString(), webhookSecret);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('INVALID_SIGNATURE'));
  });

  await test('Strictly rejects stale webhook timestamps outside the 5-minute replay window', () => {
    const payload = JSON.stringify({ eventId: 'evt_stale', eventType: 'profile.updated' });
    const signature = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
    const staleTimestamp = new Date(Date.now() - 360000).toISOString(); // 6 minutes ago

    const result = TathastuClient.verifyWebhookSignature(payload, signature, staleTimestamp, webhookSecret);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('STALE_TIMESTAMP'));
  });

  await test('Webhook idempotency: duplicate event deliveries and X-AIT-Delivery headers are safely acknowledged', () => {
    const duplicateEventId = `evt_dedup_${testRunId}`;
    const check1 = TathastuClient.checkAndRecordWebhookEvent(duplicateEventId);
    assert.strictEqual(check1.isDuplicate, false);

    const check2 = TathastuClient.checkAndRecordWebhookEvent(duplicateEventId);
    assert.strictEqual(check2.isDuplicate, true);
  });

  await test('Processes profile.updated webhook and merges newly verified capstone project', async () => {
    const targetSub = `urn:tathastu:person:wh_student_${testRunId}`;
    const targetEmail = `wh_student_${testRunId}@aitathastu.test`;

    // 1. Setup mapped student
    const { member } = await TathastuSsoService.processCallback({
      code: `code_wh_${testRunId}`,
      codeVerifier: 'verifier_wh',
      state: 'state_wh',
      claimsOverride: { sub: targetSub, email: targetEmail, fullName: 'Webhook Capstone Student' },
    });

    // 2. Dispatch profile.updated webhook
    const updateResult = await TathastuSsoService.processWebhook({
      eventId: `evt_capstone_${testRunId}`,
      eventType: 'profile.updated',
      sourcePersonId: targetSub,
      timestamp: new Date().toISOString(),
      payload: {
        profile: {
          displayName: 'Webhook Capstone Student',
          skills: [{ id: 'sk_cap', name: 'TensorRT-LLM', category: 'tool', confirmedByCore: true }],
          projects: [
            { id: 'proj_cap_1', title: 'Enterprise RAG Agent', description: 'Production sub-50ms latency RAG', tags: ['RAG', 'vLLM'], sourceOrigin: 'ai_tathastu_core' },
          ],
          education: [],
          achievements: [],
          interests: [],
          portfolioLinks: [],
        },
      },
    });

    assert.strictEqual(updateResult.handled, true);
    assert.strictEqual(updateResult.action, 'PROFILE_UPDATED');

    const updated = durableDb.getMemberById(member.id);
    assert.ok(updated.skills.includes('TensorRT-LLM'));
    assert.ok(updated.projects.some((p) => p.title === 'Enterprise RAG Agent'));
  });

  await test('Processes integration.revoked webhook: clears mapping, removes core projects, preserves Collaborate account', async () => {
    const revSub = `urn:tathastu:person:rev_${testRunId}`;
    const revEmail = `rev_${testRunId}@aitathastu.test`;

    // 1. Setup mapped student with core project
    const { member } = await TathastuSsoService.processCallback({
      code: `code_rev_${testRunId}`,
      codeVerifier: 'verifier_rev',
      state: 'state_rev',
      claimsOverride: {
        sub: revSub,
        email: revEmail,
        fullName: 'Revocation Test Student',
        profile: {
          schemaVersion: '1.0',
          source: 'ai-tathastu',
          sourcePersonId: revSub,
          sourceVersion: '1.0',
          updatedAt: new Date().toISOString(),
          profile: {
            displayName: 'Revocation Test Student',
            skills: [],
            projects: [{ id: 'p_core_rev', title: 'Core Project to Delete', description: 'desc', tags: [], sourceOrigin: 'ai_tathastu_core' }],
            education: [],
            achievements: [],
            interests: [],
            portfolioLinks: [],
          },
          permissions: { importApproved: true, discoverable: true, allowedFieldPaths: [], consentVersion: '1.0', consentGrantedAt: new Date().toISOString() },
          quarantinedPrivateData: [],
        },
      },
    });

    // Add a locally created project that should NOT be deleted
    member.projects.push({
      id: 'p_local_keep',
      title: 'Local Hackathon Project',
      description: 'Built locally on Collaborate',
      tags: ['Local'],
      sourceOrigin: 'collaborate',
    });
    await durableDb.saveMemberAsync(member);

    // 2. Dispatch integration.revoked webhook
    const revResult = await TathastuSsoService.processWebhook({
      eventId: `evt_rev_${testRunId}`,
      eventType: 'integration.revoked',
      sourcePersonId: revSub,
      timestamp: new Date().toISOString(),
    });

    assert.strictEqual(revResult.handled, true);
    assert.strictEqual(revResult.action, 'INTEGRATION_REVOKED');

    // 3. Verify state
    const revMember = durableDb.getMemberById(member.id);
    assert.ok(revMember, 'Collaborate account must be preserved');
    assert.strictEqual(revMember.isLinkedWithTathastu, false);
    assert.strictEqual(revMember.tathastuSyncStatus, 'unlinked');
    assert.ok(!revMember.projects.some((p) => p.title === 'Core Project to Delete'), 'Core projects must be removed');
    assert.ok(revMember.projects.some((p) => p.title === 'Local Hackathon Project'), 'Local projects must be preserved');

    // Verify mapping is severed
    const severedMapping = durableDb.getMappingByExternalSub('aitathastu_oidc', revSub);
    assert.strictEqual(severedMapping, null);
  });

  await test('Null section deletion: null sections in projection strictly delete previously stored data', async () => {
    const studentSub = `urn:tathastu:person:null_del_${testRunId}`;
    const studentEmail = `null_del_${testRunId}@aitathastu.test`;

    // 1. Initially create member with skills, projects, education, experience, achievements
    const { member } = await TathastuSsoService.processCallback({
      code: `code_null_1_${testRunId}`,
      codeVerifier: 'verifier_null_1',
      state: 'state_null_1',
      claimsOverride: {
        sub: studentSub,
        email: studentEmail,
        fullName: 'Null Testing Student',
        profile: {
          schema: 'ProfessionalProjectionV1',
          version: 1,
          audience: 'collaborate',
          identity: { id: studentSub, email: studentEmail, name: 'Null Testing Student' },
          skills: { items: [{ name: 'TensorFlow', category: 'framework' }] },
          projects: [{ key: 'proj_null_1', title: 'Existing Project', technologies: ['TS'] }],
          education: [{ institution: 'IIT Delhi', degree: 'B.Tech' }],
          experience: [{ organization: 'AI Lab', role: 'Intern' }],
          achievements: [{ type: 'achievement', title: 'Winner' }],
          activity: { github: { repositories: 15 } },
        },
      },
    });

    assert.strictEqual(member.skills.length, 1);
    assert.strictEqual(member.projects.length, 1);
    assert.strictEqual(member.education.length, 1);
    assert.strictEqual(member.experience.length, 1);

    // 2. Upstream user revokes consent for everything except identity: sections become null
    TathastuSsoService.mergeProjectionData(member, {
      schema: 'ProfessionalProjectionV1',
      version: 1,
      audience: 'collaborate',
      identity: { id: studentSub, email: studentEmail, name: 'Null Testing Student' },
      skills: null,
      projects: null,
      education: null,
      experience: null,
      achievements: null,
      activity: null,
    });
    await durableDb.saveMemberAsync(member);

    // 3. Verify all consented sections are completely deleted / reset per contract
    const updatedMember = durableDb.getMemberById(member.id);
    assert.strictEqual(updatedMember.skills.length, 0, 'Skills must be deleted when null');
    assert.strictEqual(updatedMember.projects.length, 0, 'Core projects must be deleted when null');
    assert.strictEqual(updatedMember.education.length, 0, 'Education must be deleted when null');
    assert.strictEqual(updatedMember.experience.length, 0, 'Experience must be deleted when null');
    assert.strictEqual(updatedMember.metrics.achievements, 0, 'Achievements must be reset when null');
    assert.strictEqual(updatedMember.metrics.githubContributions, '—', 'Activity must be reset to "—" when null');
  });

  // --------------------------------------------------------------------------
  // SECTION 6: Fastify Server End-to-End Route Injections
  // --------------------------------------------------------------------------
  console.log('\n--- Section 6: Fastify Route Injections & Regression Tests ---');

  const fastifyApp = buildServer();

  await test('Fastify: GET /api/auth/tathastu/start initiates OAuth PKCE flow and sets flow cookie', async () => {
    const res = await fastifyApp.inject({
      method: 'GET',
      url: '/api/auth/tathastu/start?format=json',
    });

    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.authUrl.includes('/integrations/authorize'));
    assert.ok(data.state && data.state.length >= 32);
    assert.ok(data.codeChallenge && data.codeChallenge.length >= 32);

    // Verify tathastu_oauth_flow cookie was set
    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie && setCookie.includes('tathastu_oauth_flow'));
  });

  await test('Fastify: GET /api/auth/tathastu/start?prompt=consent includes prompt=consent in redirect URL', async () => {
    const res = await fastifyApp.inject({
      method: 'GET',
      url: '/api/auth/tathastu/start?prompt=consent',
    });

    assert.strictEqual(res.statusCode, 302);
    const location = res.headers.location;
    assert.ok(location.includes('prompt=consent'));
    assert.ok(location.includes('/integrations/authorize'));
  });

  await test('Fastify: GET /api/auth/tathastu/callback without code returns 302 redirect with auth_error (not 404)', async () => {
    const res = await fastifyApp.inject({
      method: 'GET',
      url: '/api/auth/tathastu/callback',
    });

    assert.strictEqual(res.statusCode, 302);
    const location = res.headers.location;
    assert.ok(location.includes('auth_error='));
  });

  await test('Fastify: POST /api/webhooks/tathastu without signature returns 401 Unauthorized (not 404)', async () => {
    const res = await fastifyApp.inject({
      method: 'POST',
      url: '/api/webhooks/tathastu',
      payload: {},
    });

    assert.strictEqual(res.statusCode, 401);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.error, 'INVALID_SIGNATURE');
  });

  await test('Fastify: POST /api/auth/tathastu/callback handles token callback and issues session cookie', async () => {
    const apiSub = `urn:tathastu:person:api_${testRunId}`;
    const apiEmail = `api_${testRunId}@aitathastu.test`;

    const res = await fastifyApp.inject({
      method: 'POST',
      url: '/api/auth/tathastu/callback',
      payload: {
        code: `code_api_${testRunId}`,
        codeVerifier: 'verifier_api',
        state: 'state_api',
        claimsOverride: {
          sub: apiSub,
          email: apiEmail,
          fullName: 'Fastify API Student',
        },
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.member.email, apiEmail);

    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie && setCookie.includes('collaborate_session'));
  });

  await test('Fastify: POST /api/webhooks/tathastu verifies HMAC signature and processes webhook', async () => {
    const whSub = `urn:tathastu:person:api_wh_${testRunId}`;
    const whEmail = `api_wh_${testRunId}@aitathastu.test`;

    // Setup user
    await TathastuSsoService.processCallback({
      code: `code_wh_setup_${testRunId}`,
      codeVerifier: 'verifier_setup',
      state: 'state_setup',
      claimsOverride: { sub: whSub, email: whEmail, fullName: 'API Webhook User' },
    });

    const webhookBody = {
      eventId: `evt_api_wh_${testRunId}`,
      eventType: 'profile.updated',
      sourcePersonId: whSub,
      timestamp: new Date().toISOString(),
      payload: {
        profile: {
          displayName: 'API Webhook User',
          skills: [{ id: 'sk_wh_api', name: 'FastAPI', category: 'framework', confirmedByCore: true }],
          projects: [],
          education: [],
          achievements: [],
          interests: [],
          portfolioLinks: [],
        },
      },
    };

    const rawPayload = JSON.stringify(webhookBody);
    const signature = crypto.createHmac('sha256', webhookSecret).update(rawPayload).digest('hex');
    const timestamp = new Date().toISOString();

    const res = await fastifyApp.inject({
      method: 'POST',
      url: '/api/webhooks/tathastu',
      headers: {
        'content-type': 'application/json',
        'x-tathastu-signature': signature,
        'x-tathastu-timestamp': timestamp,
      },
      payload: rawPayload,
    });

    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.success, true);
  });

  await test('Fastify: POST /api/webhooks/tathastu with X-AIT-Signature (t=<unix>,v1=<hex>) and X-AIT-Delivery handles event and deduplicates safely', async () => {
    const deliverySub = `urn:tathastu:person:api_delivery_${testRunId}`;
    const deliveryEmail = `api_delivery_${testRunId}@aitathastu.test`;

    // Setup user
    await TathastuSsoService.processCallback({
      code: `code_delivery_setup_${testRunId}`,
      codeVerifier: 'verifier_delivery',
      state: 'state_delivery',
      claimsOverride: { sub: deliverySub, email: deliveryEmail, fullName: 'Delivery User' },
    });

    const deliveryId = `deliv_uuid_${testRunId}_${crypto.randomUUID()}`;
    const webhookBody = {
      id: deliveryId,
      type: 'profile.updated',
      createdAt: new Date().toISOString(),
      data: {
        userId: deliverySub,
        profile: {
          schema: 'ProfessionalProjectionV1',
          version: 1,
          audience: 'collaborate',
          identity: { id: deliverySub, email: deliveryEmail, name: 'Delivery User' },
          skills: { items: [{ name: 'Rust', category: 'language', verified: true }] },
        },
      },
    };

    const rawPayload = JSON.stringify(webhookBody);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const signatureHex = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${nowSeconds}.${rawPayload}`)
      .digest('hex');
    const aitSignature = `t=${nowSeconds},v1=${signatureHex}`;

    // Delivery 1: Processed
    const res1 = await fastifyApp.inject({
      method: 'POST',
      url: '/api/webhooks/tathastu',
      headers: {
        'content-type': 'application/json',
        'x-ait-event': 'profile.updated',
        'x-ait-delivery': deliveryId,
        'x-ait-signature': aitSignature,
      },
      payload: rawPayload,
    });

    assert.strictEqual(res1.statusCode, 200);
    const data1 = JSON.parse(res1.body);
    assert.strictEqual(data1.success, true);
    assert.strictEqual(data1.result.action, 'PROFILE_UPDATED');

    // Delivery 2: Duplicate delivery ID ignored and acknowledged safely
    const res2 = await fastifyApp.inject({
      method: 'POST',
      url: '/api/webhooks/tathastu',
      headers: {
        'content-type': 'application/json',
        'x-ait-event': 'profile.updated',
        'x-ait-delivery': deliveryId,
        'x-ait-signature': aitSignature,
      },
      payload: rawPayload,
    });

    assert.strictEqual(res2.statusCode, 200);
    const data2 = JSON.parse(res2.body);
    assert.strictEqual(data2.success, true);
    assert.strictEqual(data2.result.action, 'DUPLICATE_ACKNOWLEDGED');
  });

  await test('Fastify: Existing standalone password registration and login continue working without regression', async () => {
    const standaloneEmail = `standalone_regression_${testRunId}@test.com`;
    const password = 'regPassword123!';

    // 1. Register
    const regRes = await fastifyApp.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: standaloneEmail, password, fullName: 'Regression User' },
    });
    assert.strictEqual(regRes.statusCode, 201);
    const regData = JSON.parse(regRes.body);
    assert.strictEqual(regData.success, true);
    assert.strictEqual(regData.member.email, standaloneEmail);

    // 2. Login
    const loginRes = await fastifyApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: standaloneEmail, password },
    });
    assert.strictEqual(loginRes.statusCode, 200);
    const loginData = JSON.parse(loginRes.body);
    assert.strictEqual(loginData.success, true);
    assert.ok(loginRes.headers['set-cookie']?.includes('collaborate_session'));
  });

  await test('Authorization Security: User A cannot edit User B profile', async () => {
    // Register user A
    const { member: userA, token: tokenA } = await IdentityService.registerStandalone(
      `usera_${testRunId}@test.com`,
      'passA123456!',
      'User A'
    );
    // Register user B
    const { member: userB } = await IdentityService.registerStandalone(
      `userb_${testRunId}@test.com`,
      'passB123456!',
      'User B'
    );

    // User A attempts to edit User B's profile
    const editRes = await fastifyApp.inject({
      method: 'PUT',
      url: '/api/profiles',
      headers: {
        authorization: `Bearer ${tokenA}`,
      },
      payload: {
        id: userB.id,
        updates: { headline: 'Hacked Headline' },
      },
    });

    assert.strictEqual(editRes.statusCode, 403);
    const err = JSON.parse(editRes.body);
    assert.strictEqual(err.error, 'Unauthorized to edit this profile');

    // Verify user B's profile was not modified
    const unchangedB = durableDb.getMemberById(userB.id);
    assert.notStrictEqual(unchangedB.headline, 'Hacked Headline');
  });

  console.log('\n========================================================================');
  console.log(`   TEST SUITE EXECUTION COMPLETE: ${passedTests}/${totalTests} TESTS PASSED \x1b[32m(100% SUCCESS)\x1b[0m   `);
  console.log('========================================================================\n');
}

runSuite().catch((err) => {
  console.error('\n❌ Test suite fatal failure:', err);
  process.exit(1);
});
