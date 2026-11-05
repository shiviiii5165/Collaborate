import { durableDb } from '@/lib/db/index';
import { MemberProfile } from '@/lib/types';
import { getTathastuAdapter } from '@/integrations/tathastu';
import type { LegacyHarnessProjection } from '@/integrations/tathastu/contract/types';
import { PROJECTION_SCHEMA } from '@/integrations/tathastu/contract/projection-v1';
import { TathastuSsoService } from '@/modules/identity/tathastu-sso';

export class ReauthorizationRequiredError extends Error {
  constructor() {
    super(
      'REAUTHORIZE_REQUIRED: AI Tathastu profile data can only be read with your consent in a fresh sign-in. ' +
        'Use "Continue with AI Tathastu" to refresh; later changes arrive automatically by webhook.'
    );
    this.name = 'ReauthorizationRequiredError';
  }
}

/**
 * Converts the test-harness mock shape into the real ProfessionalProjectionV1 so harness
 * imports go through exactly the same validation and ownership pipeline as production.
 * Only fields that exist in the harness data are mapped; nothing is invented.
 */
export function legacyHarnessToV1(legacy: LegacyHarnessProjection, audience = 'collaborate') {
  const p = legacy.profile;
  return {
    schema: PROJECTION_SCHEMA,
    version: 1,
    audience,
    generatedAt: new Date(legacy.updatedAt || Date.now()).toISOString(),
    identity: {
      id: legacy.sourcePersonId,
      email: null,
      name: p.displayName ?? null,
      headline: p.headline ?? null,
      avatarUrl: p.avatarUrl ?? null,
      careerRole: null,
      careerRoleOther: null,
      location: p.location ? { city: p.location, country: null } : null,
    },
    education: (p.education || []).map((e) => ({
      institution: e.institution ?? null,
      degree: e.degree ?? null,
      fieldOfStudy: null,
      dates: e.period ?? null,
      grade: e.score ?? null,
      sources: ['harness'],
    })),
    skills: {
      items: (p.skills || []).map((s) => ({
        name: s.name,
        category: s.category ?? null,
        evidenceStrength: null,
        verified: Boolean(s.confirmedByCore),
        verificationStatus: s.confirmedByCore ? 'verified' : 'self_reported',
        sources: ['harness'],
      })),
      erisReadiness: null,
    },
    projects: (p.projects || []).map((pr) => ({
      key: pr.id,
      title: pr.title,
      description: pr.description ?? null,
      technologies: pr.tags || [],
      links: [pr.repositoryUrl, pr.demoUrl].filter((l): l is string => Boolean(l)),
      status: null,
      sources: ['harness'],
    })),
    experience: null,
    achievements: (p.achievements || []).map((a) => ({
      type: 'achievement' as const,
      title: a.title,
      issuer: a.issuer ?? null,
      date: a.issuedAt ?? null,
      description: null,
      url: null,
      sources: ['harness'],
    })),
    privacy: {
      scopes: { skills: true, projects: true, education: true, achievements: true, experience: false, eris: false, activity: false },
      masked: ['experience', 'activity', 'skills.erisReadiness'],
      hiddenProjects: 0,
      consentUpdatedAt: null,
    },
  };
}

export class FederationService {
  /**
   * The member's authorized projection. Live mode has no stored user token (AI Tathastu
   * access tokens last 15 minutes and are not persisted), so a manual refresh requires a
   * fresh consented sign-in. The mock adapter is available only in the test harness.
   */
  public static async fetchApprovedProjection(corePersonId: string): Promise<unknown> {
    const adapter = getTathastuAdapter();
    if (adapter.mode !== 'mock') throw new ReauthorizationRequiredError();
    const legacy = await adapter.fetchProjection(corePersonId);
    return legacyHarnessToV1(legacy);
  }

  /** Imports a projection through the shared, validated ownership pipeline. */
  public static async syncProjectionToMember(
    memberId: string,
    projection: unknown,
    syncSettings?: { autoSyncProjects: boolean; autoSyncSkills: boolean; autoSyncAchievements: boolean }
  ): Promise<MemberProfile> {
    const member = durableDb.getMemberById(memberId);
    if (!member) throw new Error('Member not found');
    if (syncSettings) member.tathastuSyncSettings = syncSettings;
    TathastuSsoService.importProjection(member, projection);
    member.isLinkedWithTathastu = true;
    await durableDb.saveMemberAsync(member);
    return member;
  }
}
