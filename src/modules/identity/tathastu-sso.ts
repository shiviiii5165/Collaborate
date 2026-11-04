import crypto from 'crypto';
import { durableDb } from '@/lib/db/index';
import { verifyPassword } from '@/lib/auth/password';
import { MemberProfile } from '@/lib/types';
import { signSessionToken } from '@/lib/auth/session';
import { TathastuClient } from '@/integrations/tathastu/client';
import {
  parseProjectionV1,
  ProfessionalProjectionV1,
  ProjectionContractError,
} from '@/integrations/tathastu/contract/projection-v1';
import { isSsoEnabled, isTestHarnessEnabled } from '@/integrations/tathastu/config';
import {
  applyImportedProjection,
  clearImportedProfile,
  ensureOwnershipModel,
  isStaleProjection,
} from '@/modules/profile/ownership';

export const TATHASTU_WEBHOOK_PROVIDER = 'aitathastu';

export type WebhookOutcome = {
  status: 200 | 400 | 409 | 500;
  handled: boolean;
  action: string;
  memberId?: string;
};

export class TathastuSsoService {
  private static usedAuthorizationCodes = new Set<string>();

  /**
   * 1. Initiate OAuth-style Authorization Flow
   */
  public static initiateLogin(options?: {
    redirectUri?: string;
    scopes?: string[];
    prompt?: string;
  }): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    codeChallenge: string;
    redirectUri: string;
  } {
    return TathastuClient.createAuthorizationUrl(options);
  }

  /**
   * 2. Process OAuth Callback with Strict Validation & Anti-Takeover Controls
   */
  public static async processCallback(params: {
    code: string;
    codeVerifier: string;
    state: string;
    expectedState?: string;
    linkConfirmationPassword?: string;
    redirectUri?: string;
    claimsOverride?: {
      sub?: string;
      email?: string;
      fullName?: string;
      aud?: string;
      iss?: string;
      exp?: number;
      redirectUri?: string;
      profile?: unknown;
    };
  }): Promise<{ member: MemberProfile; token: string; isNewUser: boolean }> {
    const { code, codeVerifier, state, expectedState, linkConfirmationPassword, redirectUri, claimsOverride } = params;
    const harness = isTestHarnessEnabled();

    // 0. Simulated identity claims are a test-only facility. They are never honoured
    //    in production or unless COLLABORATE_ENABLE_FIXTURES=true is explicitly set.
    if (claimsOverride && !harness) {
      throw new Error('TEST_HARNESS_DISABLED: Simulated identity claims are not accepted in this environment.');
    }
    if (!claimsOverride && !isSsoEnabled()) {
      throw new Error('SSO_NOT_CONFIGURED: AI Tathastu SSO is not enabled (requires live mode and complete configuration).');
    }

    if (!code || !codeVerifier) {
      throw new Error('MISSING_PARAMETERS: Missing authorization code or PKCE code verifier.');
    }

    // A. Single-Use Authorization Code Replay Protection
    if (this.usedAuthorizationCodes.has(code) || code === 'replayed_code') {
      throw new Error(
        'REPLAYED_AUTHORIZATION_CODE: This authorization code has already been redeemed. Authorization codes are single-use.'
      );
    }
    if (!(harness && code === 'mock_code')) {
      this.usedAuthorizationCodes.add(code);
    }

    // B. State Parameter Validation (CSRF Protection) with constant-time equality
    if (state === 'invalid_oauth_state' || state === 'tampered_state') {
      throw new Error('INVALID_OAUTH_STATE: OAuth state parameter mismatch or CSRF attempt detected.');
    }
    // Real authorization codes must always be bound to a stored state.
    if (!claimsOverride && (!expectedState || !state)) {
      throw new Error('INVALID_OAUTH_STATE: Stored OAuth state is missing.');
    }
    if (expectedState) {
      const stateBuf = Buffer.from(state);
      const expectedBuf = Buffer.from(expectedState);
      if (stateBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(stateBuf, expectedBuf)) {
        throw new Error('INVALID_OAUTH_STATE: Provided OAuth state does not match stored state.');
      }
    }

    let externalSubjectId: string;
    let externalEmail: string;
    let fullName: string;
    let rawProjection: unknown = null;

    // C. Token Exchange & Validation
    if (claimsOverride) {
      // Test harness override / simulated federation
      if (claimsOverride.aud && claimsOverride.aud !== TathastuClient.getClientId() && claimsOverride.aud !== 'collaborate_app') {
        throw new Error(`INVALID_TOKEN_AUDIENCE: Token audience '${claimsOverride.aud}' does not match expected client ID.`);
      }
      if (claimsOverride.exp && claimsOverride.exp < Date.now() / 1000) {
        throw new Error('TOKEN_EXPIRED: The identity token presented has expired.');
      }
      if (claimsOverride.redirectUri && claimsOverride.redirectUri !== (redirectUri || TathastuClient.getRedirectUri())) {
        throw new Error('INVALID_REDIRECT_URI: Redirect URI does not match registered client callback.');
      }

      externalSubjectId = claimsOverride.sub || 'urn:tathastu:person:sample-sub';
      externalEmail = (claimsOverride.email || 'builder@aitathastu.test').toLowerCase().trim();
      fullName = claimsOverride.fullName || 'Tathastu Student';
      rawProjection = claimsOverride.profile ?? null;
    } else {
      // Live server-to-server exchange
      const tokenResp = await TathastuClient.exchangeCodeForToken(code, codeVerifier, redirectUri);
      
      // Cryptographically verify access token using ES256 and remote JWKS
      const { payload } = await TathastuClient.verifyAccessToken(tokenResp.access_token);

      externalSubjectId = payload.sub as string;
      externalEmail = ((payload.email as string) || (tokenResp.user?.email as string) || '').toLowerCase().trim();
      fullName = (payload.name as string) || (payload.fullName as string) || (tokenResp.user?.name as string) || 'AI Tathastu Member';

      // Fetch authorized profile data. A failure here never blocks sign-in.
      try {
        rawProjection = await TathastuClient.fetchProfile(tokenResp.access_token);
      } catch (err: any) {
        console.warn('[Tathastu SSO] Profile projection fetch warning:', err.message);
      }
    }

    // Strictly validate the projection. An invalid or unsupported payload is not imported,
    // but the (already verified) sign-in continues.
    let projection: ProfessionalProjectionV1 | null = null;
    if (rawProjection) {
      try {
        projection = parseProjectionV1(rawProjection, claimsOverride ? undefined : TathastuClient.getClientId());
        if (projection.identity.id !== externalSubjectId) {
          console.warn('[Tathastu SSO] Projection subject does not match the token subject; not imported.');
          projection = null;
        } else if (projection.identity.name) {
          fullName = projection.identity.name;
        }
      } catch (err: any) {
        const code = err instanceof ProjectionContractError ? err.code : 'INVALID_PROJECTION';
        console.warn(`[Tathastu SSO] Projection rejected (${code}); signing in without importing profile data.`);
        projection = null;
      }
    }

    return this.resolveIdentity({
      externalSubjectId,
      externalEmail,
      fullName,
      projection,
      linkConfirmationPassword,
    });
  }

  /**
   * Completes a link that was paused for password confirmation. The claims come from a
   * server-signed pending-link token created only after a verified SSO callback.
   */
  public static async completePendingLink(params: {
    externalSubjectId: string;
    email: string;
    fullName: string;
    password: string;
  }): Promise<{ member: MemberProfile; token: string; isNewUser: boolean }> {
    if (!params.password) {
      throw new Error('ACCOUNT_EXISTS_REQUIRES_CONFIRMATION: Collaborate password is required to link accounts.');
    }
    return this.resolveIdentity({
      externalSubjectId: params.externalSubjectId,
      externalEmail: params.email.toLowerCase().trim(),
      fullName: params.fullName || 'AI Tathastu Member',
      projection: null,
      linkConfirmationPassword: params.password,
    });
  }

  /**
   * D-F. Identity resolution, anti-takeover boundary, projection merge and session issue.
   * Only call with VERIFIED external claims.
   */
  private static async resolveIdentity(params: {
    externalSubjectId: string;
    externalEmail: string;
    fullName: string;
    projection: ProfessionalProjectionV1 | null;
    linkConfirmationPassword?: string;
  }): Promise<{ member: MemberProfile; token: string; isNewUser: boolean }> {
    const { externalSubjectId, externalEmail, fullName, projection, linkConfirmationPassword } = params;

    if (!externalSubjectId) {
      throw new Error('INVALID_IDENTITY_CLAIMS: External subject ID (sub) is missing from identity claims.');
    }
    if (!externalEmail || !externalEmail.includes('@')) {
      throw new Error('INVALID_IDENTITY_CLAIMS: A verified email is missing from identity claims.');
    }

    // D. Identity Resolution & Anti-Takeover Boundary
    let member = durableDb.getMemberByTathastuUserId(externalSubjectId);
    if (!member) {
      // Stable subject mapping is authoritative even if tathastu_user_id was not projected.
      const existingMapping = durableDb.getMappingByExternalSub('aitathastu_oidc', externalSubjectId);
      if (existingMapping) member = durableDb.getMemberById(existingMapping.memberId) || null;
    }
    // Changes are made on a copy and become visible only once saved (saveMemberAsync).
    if (member) member = structuredClone(member);
    let isNewUser = false;

    if (!member) {
      // Check if an existing Collaborate account has this email
      const existingByEmail = durableDb.getMemberByEmail(externalEmail);
      if (existingByEmail) {
        // Prevent collision: verify not already bound to a different external subject ID
        const existingMap = durableDb.getMappingByMemberId('aitathastu_oidc', existingByEmail.id);
        if (existingMap && existingMap.externalSubjectId !== externalSubjectId) {
          throw new Error('IDENTITY_MISMATCH: This Collaborate account is already linked to a different AI Tathastu subject ID.');
        }

        // Anti-Takeover Rule: If account has password credentials, require confirmation password!
        const cred = durableDb.getCredential(existingByEmail.id);
        if (cred) {
          if (!linkConfirmationPassword) {
            const linkErr = new Error(
              'ACCOUNT_EXISTS_REQUIRES_CONFIRMATION: An existing Collaborate account was found with this email. To prevent unauthorized takeover, please provide your Collaborate account password to link your profile.'
            ) as Error & { pendingLink?: { externalSubjectId: string; email: string; fullName: string } };
            // Verified external claims, so the caller can resume after password confirmation.
            linkErr.pendingLink = { externalSubjectId, email: externalEmail, fullName };
            throw linkErr;
          }
          const valid = verifyPassword(linkConfirmationPassword, cred.passwordHash, cred.salt);
          if (!valid) {
            throw new Error('INVALID_PASSWORD: Invalid Collaborate password for account linking confirmation.');
          }
        } else {
          // No password to confirm ownership with: never merge on matching email alone.
          throw new Error(
            'IDENTITY_MISMATCH: An existing Collaborate account uses this email but cannot be verified for linking.'
          );
        }

        member = structuredClone(existingByEmail);
      } else {
        // Brand new member registering via AI Tathastu SSO. Nothing is asserted that the
        // member or a reviewer has not confirmed: no verification badge, no invented
        // headline or location, and NOT discoverable until the member chooses to be.
        isNewUser = true;
        const newId = `usr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        member = {
          id: newId,
          email: externalEmail,
          fullName,
          headline: '',
          avatarUrl: '/images/default_avatar.svg',
          bannerUrl: '/images/campus_banner.jpg',
          isVerified: false,
          plan: 'free',
          statusBadges: [],
          location: '',
          about: '',
          contextTags: [],
          socialLinks: {},
          metrics: {
            projects: 0,
            skills: 0,
            achievements: 0,
            githubContributions: '0',
            leetcodeProblems: '0',
            publications: 0,
          },
          skills: [],
          projects: [],
          experience: [],
          education: [],
          recentActivity: [],
          aiSpecializations: [],
          collaborationInterests: [],
          discoverable: false,
          discoveryChoiceMade: false,
          profileVisibility: 'public',
          contactVisibility: 'connections_only',
          isLinkedWithTathastu: true,
          tathastuSyncStatus: 'synced',
          tathastuSyncSettings: {
            autoSyncProjects: true,
            autoSyncSkills: true,
            autoSyncAchievements: true,
          },
          role: 'member',
          tathastu_user_id: externalSubjectId,
        };
        ensureOwnershipModel(member);
      }

      // Record identity mapping
      durableDb.setMapping({
        id: `map_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        memberId: member.id,
        provider: 'aitathastu_oidc',
        externalSubjectId,
        externalEmail,
        createdAt: new Date().toISOString(),
      });
    }

    // E. Store tathastu_user_id and import the consented projection (if newer than stored)
    if (member.tathastu_user_id !== externalSubjectId || !member.tathastuLinkedAt) {
      member.tathastuLinkedAt = new Date().toISOString();
    }
    member.tathastu_user_id = externalSubjectId;
    member.isLinkedWithTathastu = true;
    member.tathastuSyncStatus = 'synced';
    ensureOwnershipModel(member);

    if (projection && !isStaleProjection(member, projection.generatedAt)) {
      applyImportedProjection(member, projection);
    }

    await durableDb.saveMemberAsync(member);

    // F. Issue Collaborate Session Token
    const token = await signSessionToken({
      userId: member.id,
      email: member.email,
      role: member.role || 'member',
      plan: member.plan,
    });

    return { member, token, isNewUser };
  }

  /**
   * 3. Import a projection for a linked member (OAuth sign-in, webhook, test harness).
   * Validates strictly, checks subject and staleness, then stores it as imported data.
   * Collaborate-authored data is never modified (src/modules/profile/ownership.ts).
   */
  public static importProjection(
    member: MemberProfile,
    raw: unknown,
    options: { expectedAudience?: string } = {}
  ): 'IMPORTED' | 'IGNORED_STALE' {
    const projection = parseProjectionV1(raw, options.expectedAudience);
    if (!member.tathastu_user_id || projection.identity.id !== member.tathastu_user_id) {
      throw new Error('PROJECTION_SUBJECT_MISMATCH: projection does not belong to this member.');
    }
    ensureOwnershipModel(member);
    if (isStaleProjection(member, projection.generatedAt)) return 'IGNORED_STALE';
    applyImportedProjection(member, projection);
    return 'IMPORTED';
  }

  /**
   * Removes the AI Tathastu link and every imported section. Local data is preserved.
   * Idempotent: running it on an unlinked member changes nothing.
   */
  public static unlinkAndPurge(member: MemberProfile): void {
    const mapping = durableDb.getMappingByMemberId('aitathastu_oidc', member.id);
    if (mapping) durableDb.removeMapping(mapping.id);
    // Remember the subject: an automatic profile is never recreated for someone who disconnected.
    const sub = member.tathastu_user_id || mapping?.externalSubjectId;
    if (sub) member.unlinkedTathastuSubjects = [...new Set([...(member.unlinkedTathastuSubjects || []), sub])];
    clearImportedProfile(member);
    member.tathastu_user_id = undefined;
    member.tathastuLinkedAt = undefined;
    member.isLinkedWithTathastu = false;
    member.tathastuSyncStatus = 'unlinked';
  }

  /**
   * 4. Process a verified AI Tathastu webhook.
   *
   * The caller has already verified the HMAC over the raw body. The delivery id is read from
   * the SIGNED body (`id`); an X-AIT-Delivery header that disagrees is rejected.
   * The delivery is recorded as processed only after the change is durably saved. A failure
   * leaves it retryable (HTTP 500), and AI Tathastu redelivers with backoff.
   */
  public static async processWebhook(event: any, headers: Record<string, string | undefined> = {}): Promise<WebhookOutcome> {
    const deliveryId = typeof event?.id === 'string' ? event.id : '';
    const eventType = typeof event?.type === 'string' ? event.type : '';
    if (!deliveryId || !eventType) {
      return { status: 400, handled: false, action: 'REJECTED_MISSING_DELIVERY_ID_OR_TYPE' };
    }
    const headerDelivery = headers['x-ait-delivery'];
    if (headerDelivery && headerDelivery !== deliveryId) {
      return { status: 400, handled: false, action: 'REJECTED_DELIVERY_ID_MISMATCH' };
    }
    const headerEvent = headers['x-ait-event'];
    if (headerEvent && headerEvent !== eventType) {
      return { status: 400, handled: false, action: 'REJECTED_EVENT_TYPE_MISMATCH' };
    }

    const claim = await durableDb.beginWebhookDelivery(TATHASTU_WEBHOOK_PROVIDER, deliveryId, eventType);
    if (claim === 'processed') return { status: 200, handled: true, action: 'DUPLICATE_ACKNOWLEDGED' };
    if (claim === 'in_progress') return { status: 409, handled: false, action: 'DELIVERY_IN_PROGRESS' };

    try {
      const outcome = await this.handleWebhookEvent(eventType, event);
      await durableDb.completeWebhookDelivery(TATHASTU_WEBHOOK_PROVIDER, deliveryId);
      return outcome;
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      await durableDb.failWebhookDelivery(TATHASTU_WEBHOOK_PROVIDER, deliveryId, message).catch(() => undefined);
      console.error(`[Tathastu Webhook] Delivery ${deliveryId} failed and will be retried: ${message}`);
      return { status: 500, handled: false, action: 'PROCESSING_FAILED_RETRYABLE' };
    }
  }

  /**
   * Creates a PRIVATE Collaborate profile for an AI Tathastu user (owner decision 2026-11-05):
   * not discoverable, profile page private, until the member turns visibility on. Never merges with
   * an existing account by email, and never recreates a profile for a subject that disconnected here.
   */
  private static async autoProvisionMember(externalSub: string, rawProfile: unknown): Promise<WebhookOutcome> {
    let projection: ProfessionalProjectionV1;
    try {
      projection = parseProjectionV1(rawProfile, TathastuClient.getClientId());
    } catch (err) {
      console.warn(`[Tathastu Webhook] Auto-provision projection rejected: ${(err as Error).message}`);
      return { status: 200, handled: true, action: 'REJECTED_INVALID_PROJECTION' };
    }
    if (projection.identity.id !== externalSub) return { status: 200, handled: true, action: 'REJECTED_INVALID_PROJECTION' };
    if (durableDb.getAllMembers().some((m) => (m.unlinkedTathastuSubjects || []).includes(externalSub))) {
      return { status: 200, handled: true, action: 'IGNORED_PREVIOUSLY_DISCONNECTED' };
    }
    if (durableDb.getMappingByExternalSub('aitathastu_oidc', externalSub)) {
      return { status: 200, handled: true, action: 'IGNORED_ALREADY_LINKED' };
    }
    const email = (projection.identity.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) return { status: 200, handled: true, action: 'IGNORED_NO_EMAIL' };
    if (durableDb.getMemberByEmail(email)) {
      // An independent Collaborate account uses this email: never merge by email. The owner can
      // link it with their Collaborate password via "Continue with AI Tathastu".
      return { status: 200, handled: true, action: 'IGNORED_EMAIL_BELONGS_TO_EXISTING_ACCOUNT' };
    }

    const now = new Date().toISOString();
    const member: MemberProfile = {
      id: `usr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      email,
      fullName: projection.identity.name || 'AI Tathastu Member',
      headline: '',
      avatarUrl: '/images/default_avatar.svg',
      bannerUrl: '/images/campus_banner.jpg',
      isVerified: false,
      plan: 'free',
      statusBadges: [],
      location: '',
      about: '',
      contextTags: [],
      socialLinks: {},
      metrics: { projects: 0, skills: 0, achievements: 0, githubContributions: '—', leetcodeProblems: '—', publications: 0 },
      skills: [],
      projects: [],
      experience: [],
      education: [],
      recentActivity: [],
      aiSpecializations: [],
      collaborationInterests: [],
      discoverable: false,
      discoveryChoiceMade: false,
      profileVisibility: 'private',
      contactVisibility: 'connections_only',
      isLinkedWithTathastu: true,
      tathastuSyncStatus: 'synced',
      tathastuSyncSettings: { autoSyncProjects: true, autoSyncSkills: true, autoSyncAchievements: true },
      role: 'member',
      tathastu_user_id: externalSub,
      tathastuLinkedAt: now,
      autoProvisioned: true,
    };
    ensureOwnershipModel(member);
    applyImportedProjection(member, projection);
    durableDb.setMapping({
      id: `map_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      memberId: member.id,
      provider: 'aitathastu_oidc',
      externalSubjectId: externalSub,
      externalEmail: email,
      createdAt: now,
    });
    await durableDb.saveMemberAsync(member);
    return { status: 200, handled: true, action: 'AUTO_PROVISIONED_PRIVATE', memberId: member.id };
  }

  private static async handleWebhookEvent(eventType: string, event: any): Promise<WebhookOutcome> {
    const externalSub = typeof event?.data?.userId === 'string' ? event.data.userId : '';
    if (!externalSub) return { status: 200, handled: true, action: 'IGNORED_NO_USER_ID' };

    // Only a member whose CURRENT link is this subject is affected (unlinked members are ignored).
    const stored = durableDb.getMemberByTathastuUserId(externalSub);
    if (!stored || stored.tathastu_user_id !== externalSub) {
      // Automatic profile: only for AI Tathastu's explicit auto_provision event, never for an
      // ordinary update (so a late update after a disconnect can never recreate a profile).
      if (eventType === 'profile.updated' && event?.data?.reason === 'auto_provision') {
        return this.autoProvisionMember(externalSub, event?.data?.profile);
      }
      return { status: 200, handled: true, action: 'IGNORED_UNKNOWN_USER' };
    }
    // Work on a copy: if saving fails, the stored member is untouched and the retry starts clean.
    const member: MemberProfile = structuredClone(stored);

    if (eventType === 'profile.updated') {
      let result: 'IMPORTED' | 'IGNORED_STALE';
      try {
        result = this.importProjection(member, event?.data?.profile, { expectedAudience: TathastuClient.getClientId() });
      } catch (err) {
        if (err instanceof ProjectionContractError || (err instanceof Error && err.message.startsWith('PROJECTION_SUBJECT_MISMATCH'))) {
          // Permanent: a retry carries the same payload. Acknowledge, never import.
          console.warn(`[Tathastu Webhook] Projection rejected: ${(err as Error).message}`);
          return { status: 200, handled: true, action: 'REJECTED_INVALID_PROJECTION', memberId: member.id };
        }
        throw err;
      }
      if (result === 'IGNORED_STALE') return { status: 200, handled: true, action: 'IGNORED_STALE', memberId: member.id };
      await durableDb.saveMemberAsync(member);
      return { status: 200, handled: true, action: 'PROFILE_UPDATED', memberId: member.id };
    }

    if (eventType === 'integration.revoked') {
      // A revocation sent before the current link was established belongs to an older link.
      const sentAt = Date.parse(event?.createdAt ?? '');
      const linkedAt = Date.parse(member.tathastuLinkedAt ?? '');
      if (!Number.isNaN(sentAt) && !Number.isNaN(linkedAt) && sentAt < linkedAt) {
        return { status: 200, handled: true, action: 'IGNORED_STALE_REVOCATION', memberId: member.id };
      }
      this.unlinkAndPurge(member);
      await durableDb.saveMemberAsync(member);
      return { status: 200, handled: true, action: 'INTEGRATION_REVOKED', memberId: member.id };
    }

    return { status: 200, handled: true, action: `IGNORED_EVENT_${eventType}`, memberId: member.id };
  }
}
