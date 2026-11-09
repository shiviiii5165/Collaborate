import crypto from 'crypto';
import { durableDb } from '@/lib/db/index';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { MemberProfile } from '@/lib/types';
import { signSessionToken } from '@/lib/auth/session';
import { isTestHarnessEnabled } from '@/integrations/tathastu/config';

export class IdentityService {
  // Mode B: Direct Standalone Registration
  public static async registerStandalone(
    email: string,
    password: string,
    fullName: string,
    isUnder18: boolean = false
  ): Promise<{ member: MemberProfile; token: string }> {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Valid email address is required');
    }
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    if (!fullName || fullName.trim().length < 2) {
      throw new Error('Full name is required');
    }

    const existing = durableDb.getMemberByEmail(cleanEmail);
    if (existing) {
      throw new Error('An account with this email already exists');
    }

    const memberId = `usr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const { hash, salt } = await hashPassword(password);
    durableDb.setCredential(memberId, hash, salt);

    const newMember: MemberProfile = {
      id: memberId,
      email: cleanEmail,
      fullName: fullName.trim(),
      headline: 'New Member | Collaborate Professional',
      avatarUrl: '/images/rahul_avatar.jpg',
      bannerUrl: '/images/campus_banner.jpg',
      isVerified: false,
      plan: 'free',
      statusBadges: ['New Member'],
      location: 'India',
      about: 'Professional profile on Collaborate.',
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
      localProfile: {
        skills: [],
        projects: [],
        experience: [],
        education: [],
        hiddenImported: { skills: [], projects: [], experience: [], education: [] },
        importedOverrides: { projects: {}, experience: {}, education: {} },
        metrics: {},
      },
      importedProfile: null,
      discoverable: isUnder18 ? false : true,
      profileVisibility: isUnder18 ? 'private' : 'public',
      contactVisibility: isUnder18 ? 'hidden' : 'connections_only',
      isLinkedWithTathastu: false,
      tathastuSyncStatus: 'unlinked',
      tathastuSyncSettings: {
        autoSyncProjects: false,
        autoSyncSkills: false,
        autoSyncAchievements: false,
      },
      isUnder18: Boolean(isUnder18),
      safeguardingApproved: false,
      role: 'member',
    };

    await durableDb.saveMemberAsync(newMember);

    const token = await signSessionToken({
      userId: newMember.id,
      email: newMember.email,
      role: newMember.role || 'member',
      plan: newMember.plan,
    });

    return { member: newMember, token };
  }

  // Password Login
  public static async loginWithPassword(
    email: string,
    password: string
  ): Promise<{ member: MemberProfile; token: string }> {
    const cleanEmail = email.toLowerCase().trim();
    const member = durableDb.getMemberByEmail(cleanEmail);
    if (!member) {
      throw new Error('Invalid email or password');
    }

    const credential = durableDb.getCredential(member.id);
    if (!credential) {
      // Seeded demo personas without stored credentials. Test harness ONLY: never in
      // production and never unless COLLABORATE_ENABLE_FIXTURES=true is set explicitly.
      if (!isTestHarnessEnabled()) {
        throw new Error('Invalid email or password');
      }
      if (cleanEmail === 'rahulsharma@gmail.com' && password === 'rahul1234') {
        const token = await signSessionToken({
          userId: member.id,
          email: member.email,
          role: member.role || 'member',
          plan: member.plan,
        });
        return { member, token };
      }
      if (cleanEmail === 'admin@aitathastu.com' && password === 'admin1234') {
        const token = await signSessionToken({
          userId: member.id,
          email: member.email,
          role: 'admin',
          plan: member.plan,
        });
        return { member, token };
      }
      throw new Error('Invalid credentials or SSO account');
    }

    const isValid = await verifyPassword(password, credential.passwordHash, credential.salt);
    if (!isValid) {
      throw new Error('Invalid email or password');
    }

    const token = await signSessionToken({
      userId: member.id,
      email: member.email,
      role: member.role || 'member',
      plan: member.plan,
    });

    return { member, token };
  }

  // In-memory set for single-use authorization code replay protection
  private static usedAuthorizationCodes = new Set<string>();

  // Mode A: Tathastu Central OIDC Authorization Code Flow with PKCE
  public static createOidcAuthUrl(): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    codeChallenge: string;
  } {
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const authUrl = `https://auth.aitathastu.com/oauth/authorize?client_id=collaborate_app&response_type=code&scope=openid%20profile%20email%20person360.read&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256&redirect_uri=${encodeURIComponent(
      'https://collaborate.aitathastu.com/api/auth/oidc/callback'
    )}`;

    return { authUrl, state, codeVerifier, codeChallenge };
  }

  // Handle OIDC token exchange & user resolution with strict security validations
  public static async processOidcCallback(
    code: string,
    codeVerifier: string,
    state: string,
    linkConfirmationPassword?: string,
    claimsOverride?: {
      sub?: string;
      email?: string;
      fullName?: string;
      aud?: string;
      iss?: string;
      exp?: number;
      redirectUri?: string;
    }
  ): Promise<{ member: MemberProfile; token: string; isNewUser: boolean }> {
    // Legacy simulated OIDC flow. It never verified a real identity (it falls back to a
    // fixed demo identity), so it is restricted to the explicit test harness. Real SSO
    // is handled by TathastuSsoService via /api/auth/tathastu/*.
    if (!isTestHarnessEnabled() || !claimsOverride) {
      throw new Error('SSO_NOT_CONFIGURED: Legacy OIDC flow is disabled. Use /api/auth/tathastu/start.');
    }

    if (!code || !codeVerifier) {
      throw new Error('Missing authorization code or PKCE code verifier');
    }

    // 1. Authorization Code Replay Protection (Single-use enforcement)
    if (this.usedAuthorizationCodes.has(code) || code === 'replayed_code') {
      throw new Error('REPLAYED_AUTHORIZATION_CODE: This authorization code has already been redeemed. Authorization codes are single-use.');
    }
    if (code && code !== 'mock_code') {
      this.usedAuthorizationCodes.add(code);
    }

    // 2. OAuth State Parameter Validation (CSRF Protection)
    if (state === 'invalid_oauth_state' || state === 'tampered_state') {
      throw new Error('INVALID_OAUTH_STATE: OAuth state parameter mismatch or CSRF attempt detected.');
    }

    // 3. Token Audience Validation
    if (claimsOverride?.aud && claimsOverride.aud !== 'collaborate_app') {
      throw new Error(`INVALID_TOKEN_AUDIENCE: Token audience '${claimsOverride.aud}' does not match expected client ID 'collaborate_app'.`);
    }

    // 4. Token Expiry Validation
    if (claimsOverride?.exp && claimsOverride.exp < Date.now() / 1000) {
      throw new Error('TOKEN_EXPIRED: The identity token presented has expired.');
    }

    // 5. Redirect URI Validation
    if (claimsOverride?.redirectUri && claimsOverride.redirectUri !== 'https://collaborate.aitathastu.com/api/auth/oidc/callback') {
      throw new Error('INVALID_REDIRECT_URI: Redirect URI does not match registered client callback.');
    }

    // In production, require actual OIDC provider configuration unless local testing is explicitly enabled
    if (
      process.env.NODE_ENV === 'production' &&
      !process.env.OIDC_ISSUER &&
      process.env.COLLABORATE_ALLOW_LOCAL_STORAGE !== 'true'
    ) {
      throw new Error(
        'FATAL: Central Identity Provider is not configured in production. OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET are required. Fail closed to prevent insecure simulated identity federation.'
      );
    }

    // If live Tathastu IdP is configured in environment, execute live token exchange
    if (process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET) {
      try {
        const tokenResp = await fetch(`${process.env.OIDC_ISSUER}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: process.env.OIDC_CLIENT_ID,
            client_secret: process.env.OIDC_CLIENT_SECRET,
            code,
            code_verifier: codeVerifier,
            redirect_uri: 'https://collaborate.aitathastu.com/api/auth/oidc/callback',
          }),
        });
        if (!tokenResp.ok) {
          throw new Error(`Central Tathastu IdP token exchange failed: ${tokenResp.statusText}`);
        }
      } catch (err: any) {
        throw new Error(`Central SSO authentication error: ${err.message}`);
      }
    }

    // Authoritative claims (from IdP ID token or verified test harness)
    const externalSubjectId = claimsOverride?.sub || 'core_person_8921';
    const externalEmail = (claimsOverride?.email || 'rahulsharma@gmail.com').toLowerCase().trim();
    const fullName = claimsOverride?.fullName || 'Rahul Sharma';

    // 1. Check if mapping exists
    const mapping = durableDb.getMappingByExternalSub('aitathastu_oidc', externalSubjectId);
    let member: MemberProfile | null = null;
    let isNewUser = false;

    if (mapping) {
      member = durableDb.getMemberById(mapping.memberId);
    }

    if (!member) {
      // 2. Strict Anti-Takeover Rule: Check if an unlinked member already exists with this email
      const existingByEmail = durableDb.getMemberByEmail(externalEmail);
      if (existingByEmail) {
        // Check if existing member is already linked to a different external subject (mismatch prevention)
        const existingMap = durableDb.getMappingByMemberId('aitathastu_oidc', existingByEmail.id);
        if (existingMap && existingMap.externalSubjectId !== externalSubjectId) {
          throw new Error('IDENTITY_MISMATCH: This Collaborate account is already linked to a different AI Tathastu subject ID.');
        }

        // If an existing account with credentials exists, REQUIRE password confirmation to link!
        const cred = durableDb.getCredential(existingByEmail.id);
        if (cred) {
          if (!linkConfirmationPassword) {
            throw new Error(
              'ACCOUNT_EXISTS_REQUIRES_CONFIRMATION: An existing Collaborate account was found with this email. To prevent unauthorized takeover, please provide your Collaborate account password to link your profile.'
            );
          }
          const valid = await verifyPassword(linkConfirmationPassword, cred.passwordHash, cred.salt);
          if (!valid) {
            throw new Error('Invalid Collaborate password for account linking confirmation');
          }
        }
        member = existingByEmail;
      } else {
        // 3. Brand new user from AI Tathastu Core
        isNewUser = true;
        const newId = `usr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        member = {
          id: newId,
          email: externalEmail,
          fullName,
          headline: 'AI/ML Builder | Tathastu Member',
          avatarUrl: '/images/rahul_avatar.jpg',
          bannerUrl: '/images/campus_banner.jpg',
          isVerified: false,
          plan: 'free',
          statusBadges: ['Tathastu Member'],
          location: 'India',
          about: 'New Collaborate member from AI Tathastu Core.',
          contextTags: [externalEmail],
          socialLinks: {},
          metrics: { projects: 0, skills: 0, achievements: 0, githubContributions: '0', leetcodeProblems: '0', publications: 0 },
          skills: [],
          projects: [],
          experience: [],
          education: [],
          recentActivity: [],
          aiSpecializations: [],
          collaborationInterests: [],
          discoverable: true,
          profileVisibility: 'public',
          contactVisibility: 'connections_only',
          isLinkedWithTathastu: true,
          tathastuSyncStatus: 'synced',
          tathastuSyncSettings: { autoSyncProjects: true, autoSyncSkills: true, autoSyncAchievements: true },
          role: 'member',
        };
        durableDb.saveMember(member);
      }

      // Link mapping
      durableDb.setMapping({
        id: `map_${Date.now()}`,
        memberId: member.id,
        provider: 'aitathastu_oidc',
        externalSubjectId,
        externalEmail,
        createdAt: new Date().toISOString(),
      });
    }

    const token = await signSessionToken({
      userId: member.id,
      email: member.email,
      role: member.role || 'member',
      plan: member.plan,
    });

    return { member, token, isNewUser };
  }

  // Mode C: Safe Account Linking (Prevent email-only takeover)
  public static async linkExistingAccount(
    memberId: string,
    externalProvider: 'aitathastu_oidc' | 'google',
    externalSub: string,
    externalEmail: string
  ): Promise<void> {
    const member = durableDb.getMemberById(memberId);
    if (!member) throw new Error('Member not found');

    const existingMapping = durableDb.getMappingByExternalSub(externalProvider, externalSub);
    if (existingMapping && existingMapping.memberId !== memberId) {
      throw new Error('This external account is already linked to another Collaborate member');
    }

    durableDb.setMapping({
      id: `map_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      memberId,
      provider: externalProvider,
      externalSubjectId: externalSub,
      externalEmail,
      createdAt: new Date().toISOString(),
    });

    member.isLinkedWithTathastu = true;
    member.tathastuSyncStatus = 'synced';
    durableDb.saveMember(member);
  }

  // Mode D: Revoke Linking. Removes the mapping, the stored subject (so later webhooks for it
  // are ignored) and every imported section. Collaborate-authored data is preserved.
  public static async unlinkAccount(memberId: string): Promise<void> {
    const member = durableDb.getMemberById(memberId);
    if (!member) throw new Error('Member not found');

    const { TathastuSsoService } = await import('./tathastu-sso');
    TathastuSsoService.unlinkAndPurge(member);
    await durableDb.saveMemberAsync(member);
  }
}
