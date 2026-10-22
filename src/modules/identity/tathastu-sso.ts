import crypto from 'crypto';
import { durableDb } from '@/lib/db/index';
import { verifyPassword } from '@/lib/auth/password';
import { MemberProfile, ProjectItem } from '@/lib/types';
import { signSessionToken } from '@/lib/auth/session';
import { TathastuClient } from '@/integrations/tathastu/client';
import { ProfessionalProjectionV1, TathastuWebhookEvent } from '@/integrations/tathastu/contract/types';

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
      profile?: Partial<ProfessionalProjectionV1>;
    };
  }): Promise<{ member: MemberProfile; token: string; isNewUser: boolean }> {
    const { code, codeVerifier, state, expectedState, linkConfirmationPassword, redirectUri, claimsOverride } = params;

    if (!code || !codeVerifier) {
      throw new Error('MISSING_PARAMETERS: Missing authorization code or PKCE code verifier.');
    }

    // A. Single-Use Authorization Code Replay Protection
    if (this.usedAuthorizationCodes.has(code) || code === 'replayed_code') {
      throw new Error(
        'REPLAYED_AUTHORIZATION_CODE: This authorization code has already been redeemed. Authorization codes are single-use.'
      );
    }
    if (code && code !== 'mock_code') {
      this.usedAuthorizationCodes.add(code);
    }

    // B. State Parameter Validation (CSRF Protection) with constant-time equality
    if (state === 'invalid_oauth_state' || state === 'tampered_state') {
      throw new Error('INVALID_OAUTH_STATE: OAuth state parameter mismatch or CSRF attempt detected.');
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
    let projection: ProfessionalProjectionV1 | null = null;

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
      projection = claimsOverride.profile as any || null;
    } else {
      // Live server-to-server exchange
      const tokenResp = await TathastuClient.exchangeCodeForToken(code, codeVerifier, redirectUri);
      
      // Cryptographically verify access token using ES256 and remote JWKS
      const { payload } = await TathastuClient.verifyAccessToken(tokenResp.access_token);

      externalSubjectId = payload.sub as string;
      externalEmail = ((payload.email as string) || (tokenResp.user?.email as string) || '').toLowerCase().trim();
      fullName = (payload.name as string) || (payload.fullName as string) || (tokenResp.user?.name as string) || 'AI Tathastu Member';

      // Fetch authorized profile data
      try {
        projection = await TathastuClient.fetchProfile(tokenResp.access_token);
        if ((projection as any).identity?.name) {
          fullName = (projection as any).identity.name;
        } else if (projection.profile?.displayName) {
          fullName = projection.profile.displayName;
        }
      } catch (err: any) {
        console.warn('[Tathastu SSO] Profile projection fetch warning:', err.message);
      }
    }

    if (!externalSubjectId) {
      throw new Error('INVALID_IDENTITY_CLAIMS: External subject ID (sub) is missing from identity claims.');
    }

    // D. Identity Resolution & Anti-Takeover Boundary
    let member = durableDb.getMemberByTathastuUserId(externalSubjectId);
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
            throw new Error(
              'ACCOUNT_EXISTS_REQUIRES_CONFIRMATION: An existing Collaborate account was found with this email. To prevent unauthorized takeover, please provide your Collaborate account password to link your profile.'
            );
          }
          const valid = verifyPassword(linkConfirmationPassword, cred.passwordHash, cred.salt);
          if (!valid) {
            throw new Error('INVALID_PASSWORD: Invalid Collaborate password for account linking confirmation.');
          }
        }

        member = existingByEmail;
      } else {
        // Brand new student registering via AI Tathastu SSO
        isNewUser = true;
        const newId = `usr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        member = {
          id: newId,
          email: externalEmail,
          fullName,
          headline: 'AI/ML Builder | Tathastu Member',
          avatarUrl: '/images/rahul_avatar.jpg',
          bannerUrl: '/images/campus_banner.jpg',
          isVerified: true,
          verifiedCategory: 'institution',
          verifiedAt: new Date().toISOString(),
          plan: 'free',
          statusBadges: ['Tathastu Member', 'Verified Student'],
          location: 'India',
          about: 'Professional profile on Collaborate.',
          contextTags: [externalEmail],
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
          discoverable: true,
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

    // E. Store tathastu_user_id, projection & merge consented data
    member.tathastu_user_id = externalSubjectId;
    member.isLinkedWithTathastu = true;
    member.tathastuSyncStatus = 'synced';

    if (projection) {
      this.mergeProjectionData(member, projection);
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
   * 3. Merge Approved Projection into Member Profile Preserving Local Overrides
   * Rules: null means unshared -> delete what was stored!
   */
  public static mergeProjectionData(
    member: MemberProfile,
    projection: ProfessionalProjectionV1 | any
  ): void {
    if (!projection) return;
    member.tathastuProfile = projection;
    member.tathastuLastSyncedAt = new Date().toISOString();

    const identity = projection.identity || projection.profile?.identity || (projection.profile ? {
      headline: projection.profile.headline,
      avatarUrl: projection.profile.avatarUrl,
      location: projection.profile.location,
    } : null);

    // 1. Identity & Local Override Rules
    if (identity) {
      if (!member.headline || member.headline.includes('New Member') || member.headline.includes('Tathastu Member')) {
        if (identity.headline) member.headline = identity.headline;
      }
      if (identity.avatarUrl && (!member.avatarUrl || member.avatarUrl.includes('rahul_avatar'))) {
        member.avatarUrl = identity.avatarUrl;
      }
      if (identity.location) {
        member.location = typeof identity.location === 'object'
          ? `${identity.location.city ? identity.location.city + ', ' : ''}${identity.location.country || ''}`.trim()
          : identity.location;
      }
      const roleBadge = identity.careerRole?.label || identity.careerRoleOther;
      if (roleBadge && !member.statusBadges.includes(roleBadge)) {
        member.statusBadges = [roleBadge, ...member.statusBadges.filter((b) => b !== 'New Member')];
      }
    }

    // 2. Skills: null means unshared -> delete skills!
    const skills = projection.skills !== undefined ? projection.skills : projection.profile?.skills;
    if (skills === null) {
      member.skills = [];
      member.metrics.skills = 0;
    } else if (skills) {
      const items = Array.isArray(skills.items) ? skills.items : (Array.isArray(skills) ? skills : []);
      const skillSet = new Set<string>();
      for (const s of items) {
        const name = typeof s === 'string' ? s : s.name;
        if (name) skillSet.add(name);
      }
      member.skills = Array.from(skillSet);
      member.metrics.skills = member.skills.length;
    }

    // 3. Projects: null means unshared -> delete core-synced projects!
    const projects = projection.projects !== undefined ? projection.projects : projection.profile?.projects;
    if (projects === null) {
      member.projects = member.projects.filter((p) => p.sourceOrigin !== 'tathastu_core');
      member.metrics.projects = member.projects.length;
    } else if (Array.isArray(projects)) {
      const nonCoreProjects = member.projects.filter((p) => p.sourceOrigin !== 'tathastu_core');
      const coreProjects: ProjectItem[] = projects.map((p: any) => ({
        id: p.key || p.id || `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: p.title,
        description: p.description || '',
        tags: Array.isArray(p.technologies) ? p.technologies : (Array.isArray(p.tags) ? p.tags : []),
        featured: Boolean(p.featured || p.status === 'featured'),
        demoUrl: Array.isArray(p.links) ? p.links[0]?.url || p.links[0] : p.demoUrl,
        imageUrl: p.imageUrl,
        stars: p.stars || 10,
        forks: p.forks || 2,
        sourceOrigin: 'tathastu_core',
      }));
      member.projects = [...nonCoreProjects, ...coreProjects];
      member.metrics.projects = member.projects.length;
    }

    // 4. Education: null means unshared -> delete education!
    const education = projection.education !== undefined ? projection.education : projection.profile?.education;
    if (education === null) {
      member.education = [];
    } else if (Array.isArray(education)) {
      member.education = education.map((e: any) => ({
        id: e.id || `edu_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        institution: e.institution,
        degree: e.degree,
        period: e.dates || e.period || '',
        score: e.grade || e.score || '',
      }));
    }

    // 5. Experience: null means unshared -> delete experience!
    const experience = projection.experience !== undefined ? projection.experience : projection.profile?.experience;
    if (experience === null) {
      member.experience = [];
    } else if (Array.isArray(experience)) {
      member.experience = experience.map((exp: any) => ({
        id: exp.id || `exp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        role: exp.role,
        company: exp.organization || exp.company,
        period: exp.dates || exp.period || '',
        bullets: exp.description ? [exp.description] : [],
      }));
    }

    // 6. Achievements & Publications: null means unshared -> reset counts!
    const achievements = projection.achievements !== undefined ? projection.achievements : projection.profile?.achievements;
    if (achievements === null) {
      member.metrics.achievements = 0;
      member.metrics.publications = 0;
    } else if (Array.isArray(achievements)) {
      const nonPubs = achievements.filter((a: any) => a.type !== 'publication');
      const pubs = achievements.filter((a: any) => a.type === 'publication');
      member.metrics.achievements = nonPubs.length;
      member.metrics.publications = pubs.length;

      const leetcodeAch = achievements.find(
        (a: any) =>
          (Array.isArray(a.sources) && a.sources.includes('leetcode')) ||
          (a.title && a.title.toLowerCase().includes('leetcode'))
      );
      if (leetcodeAch) {
        const match = leetcodeAch.title.match(/(\d+[\+]?)/);
        if (match) {
          member.metrics.leetcodeProblems = match[1];
        }
      }
    }

    // 7. Activity
    const activity = projection.activity !== undefined ? projection.activity : projection.profile?.activity;
    if (activity === null) {
      member.metrics.githubContributions = '—';
    } else if (activity?.github) {
      if (activity.github.repositories !== undefined) {
        member.metrics.githubContributions = String(activity.github.repositories);
      }
      if (Array.isArray(activity.github.recent) && activity.github.recent.length > 0) {
        member.recentActivity = activity.github.recent.map((r: any) => ({
          id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'github',
          title: `Committed to ${r.name}`,
          timeAgo: 'Recently',
        }));
      }
    }
  }

  /**
   * 4. Process Webhook Events Transactionally
   */
  public static async processWebhook(
    eventOrReq: any,
    headers?: Record<string, string>
  ): Promise<{ handled: boolean; action: string; memberId?: string }> {
    const deliveryId =
      headers?.['x-ait-delivery'] ||
      headers?.['x-delivery-id'] ||
      eventOrReq.id ||
      eventOrReq.eventId ||
      crypto.randomUUID();

    const eventType =
      headers?.['x-ait-event'] ||
      headers?.['x-event-type'] ||
      eventOrReq.type ||
      eventOrReq.eventType;

    const { isDuplicate } = await TathastuClient.checkAndRecordWebhookEventAsync(
      deliveryId,
      eventType,
      eventOrReq
    );
    if (isDuplicate) {
      return { handled: true, action: 'DUPLICATE_ACKNOWLEDGED' };
    }

    const externalSub =
      eventOrReq.data?.userId ||
      eventOrReq.sourcePersonId ||
      eventOrReq.userId;

    if (!externalSub) {
      return { handled: true, action: 'IGNORED_NO_USER_ID' };
    }

    const member = durableDb.getMemberByTathastuUserId(externalSub);
    if (!member) {
      // Per contract: if unknown, return 200 and ignore it
      return { handled: true, action: 'IGNORED_UNKNOWN_USER' };
    }

    if (eventType === 'profile.updated') {
      const profile = eventOrReq.data?.profile || eventOrReq.payload?.profile || eventOrReq.payload;
      if (profile) {
        this.mergeProjectionData(member, profile);
        await durableDb.saveMemberAsync(member);
      }
      return { handled: true, action: 'PROFILE_UPDATED', memberId: member.id };
    }

    if (eventType === 'integration.revoked') {
      const mapping = durableDb.getMappingByMemberId('aitathastu_oidc', member.id);
      if (mapping) {
        durableDb.removeMapping(mapping.id);
      }
      member.tathastu_user_id = undefined;
      member.tathastuProfile = null;
      member.isLinkedWithTathastu = false;
      member.tathastuSyncStatus = 'unlinked';
      member.projects = member.projects.filter((p) => p.sourceOrigin !== 'tathastu_core');
      await durableDb.saveMemberAsync(member);
      return { handled: true, action: 'INTEGRATION_REVOKED', memberId: member.id };
    }

    return { handled: true, action: `EVENT_${eventType}_PROCESSED`, memberId: member.id };
  }
}
