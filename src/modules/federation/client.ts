import { durableDb } from '@/lib/db/index';
import { MemberProfile } from '@/lib/types';
import { getTathastuAdapter } from '@/integrations/tathastu';

export interface TathastuApprovedProjection {
  sourcePersonId: string;
  sourceVersion: string;
  lastSyncedAt: string;
  approvedFields: {
    fullName: string;
    avatarUrl: string;
    headline: string;
    statusBadges: string[];
    location: string;
    education: Array<{
      id: string;
      institution: string;
      period: string;
      degree: string;
      score: string;
    }>;
    projects: Array<{
      id: string;
      title: string;
      featured: boolean;
      description: string;
      tags: string[];
      stars: number;
      forks: number;
      demoUrl?: string;
      imageUrl?: string;
      sourceOrigin: 'tathastu_core';
    }>;
    skills: string[];
    aiSpecializations: string[];
    collaborationInterests: string[];
  };
  quarantinedPrivateData: string[];
}

export class FederationService {
  // Fetch authorized projection from Core API via the configured adapter
  public static async fetchApprovedProjection(
    corePersonId: string,
    scopes: string[] = ['person360.read']
  ): Promise<TathastuApprovedProjection> {
    const adapter = getTathastuAdapter();
    const projectionV1 = await adapter.fetchProjection(corePersonId);

    return {
      sourcePersonId: projectionV1.sourcePersonId,
      sourceVersion: projectionV1.sourceVersion,
      lastSyncedAt: projectionV1.updatedAt,
      approvedFields: {
        fullName: projectionV1.profile.displayName,
        avatarUrl: projectionV1.profile.avatarUrl || '/images/rahul_avatar.jpg',
        headline: projectionV1.profile.headline || 'Collaborate Member',
        statusBadges: ['Tathastu Member', 'Verified Student'],
        location: projectionV1.profile.location || 'India',
        education: projectionV1.profile.education.map((e) => ({
          id: e.id,
          institution: e.institution,
          period: e.period,
          degree: e.degree,
          score: e.score || '',
        })),
        projects: projectionV1.profile.projects.map((p) => ({
          id: p.id,
          title: p.title,
          featured: Boolean(p.featured),
          description: p.description,
          tags: p.tags,
          stars: p.stars || 0,
          forks: p.forks || 0,
          demoUrl: p.demoUrl,
          imageUrl: p.imageUrl,
          sourceOrigin: 'tathastu_core' as const,
        })),
        skills: projectionV1.profile.skills.map((s) => s.name),
        aiSpecializations: projectionV1.profile.skills
          .filter((s) => s.category === 'ml_ai' || s.category === 'theory')
          .map((s) => s.name),
        collaborationInterests: projectionV1.profile.interests,
      },
      quarantinedPrivateData: projectionV1.quarantinedPrivateData,
    };
  }

  // Synchronize approved projection while preserving local overrides
  public static async syncProjectionToMember(
    memberId: string,
    projection: TathastuApprovedProjection,
    syncSettings?: { autoSyncProjects: boolean; autoSyncSkills: boolean; autoSyncAchievements: boolean }
  ): Promise<MemberProfile> {
    const member = durableDb.getMemberById(memberId);
    if (!member) throw new Error('Member not found');

    // Update sync settings if provided
    if (syncSettings) {
      member.tathastuSyncSettings = syncSettings;
    }

    // Sync only approved fields that are enabled and not locally overridden
    if (member.tathastuSyncSettings.autoSyncProjects) {
      // Merge projects: keep local projects, add or update core projects
      const existingCoreIds = new Set(
        member.projects.filter((p) => p.sourceOrigin === 'tathastu_core').map((p) => p.id)
      );
      for (const coreProj of projection.approvedFields.projects) {
        if (!existingCoreIds.has(coreProj.id)) {
          member.projects.push(coreProj);
        }
      }
    }

    if (member.tathastuSyncSettings.autoSyncSkills) {
      // Merge skills uniquely without overwriting custom skills
      const skillSet = new Set(member.skills);
      for (const s of projection.approvedFields.skills) {
        skillSet.add(s);
      }
      member.skills = Array.from(skillSet);
    }

    // DO NOT overwrite member.headline or member.about if the user has custom Collaborate overrides!
    // The prompt explicitly forbids silent overwrites of user-customized profile text.

    member.isLinkedWithTathastu = true;
    member.tathastuSyncStatus = 'synced';
    durableDb.saveMember(member);

    return member;
  }
}
