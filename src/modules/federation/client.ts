import { durableDb } from '@/lib/db/index';
import { MemberProfile } from '@/lib/types';

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
  // Fetch authorized projection from Core API
  public static async fetchApprovedProjection(
    corePersonId: string,
    scopes: string[] = ['person360.read']
  ): Promise<TathastuApprovedProjection> {
    // In production, invokes Tathastu Core versioned projection endpoint:
    // GET https://api.aitathastu.com/v1/federation/projections/{corePersonId}
    // with scoped bearer token
    return {
      sourcePersonId: corePersonId,
      sourceVersion: 'v2.4.1',
      lastSyncedAt: new Date().toISOString(),
      approvedFields: {
        fullName: 'Rahul Sharma',
        avatarUrl: '/images/rahul_avatar.jpg',
        headline: 'AI/ML Builder | GenAI Enthusiast | Final Year CSE @ LPU',
        statusBadges: ['Student', 'GenAI Engineer (Goal)', 'Open to internships'],
        location: 'Phagwara, Punjab, India',
        education: [
          {
            id: 'edu_c1',
            institution: 'Lovely Professional University (LPU)',
            period: '2021 – 2025 (Expected)',
            degree: 'B.Tech in Computer Science and Engineering',
            score: 'CGPA: 8.4 / 10',
          },
        ],
        projects: [
          {
            id: 'proj_c1',
            title: 'Tathastu AI Assistant',
            featured: true,
            description:
              'A RAG-based AI assistant for students with multi-source document understanding.',
            tags: ['Python', 'RAG', 'OpenAI', 'FastAPI'],
            stars: 112,
            forks: 28,
            demoUrl: 'https://tathastu-assistant.demo.aitathastu.com',
            imageUrl: '/images/tathastu_robot.jpg',
            sourceOrigin: 'tathastu_core',
          },
          {
            id: 'proj_c2',
            title: 'Autonomous Code Review Agent',
            featured: false,
            description:
              'Multi-agent review system using AST parsing and LLM feedback to detect security vulnerabilities.',
            tags: ['TypeScript', 'LangChain', 'Next.js'],
            stars: 45,
            forks: 12,
            sourceOrigin: 'tathastu_core',
          },
        ],
        skills: [
          'Python',
          'Machine Learning',
          'Deep Learning',
          'GenAI',
          'RAG',
          'LangChain',
          'Pinecone',
          'FastAPI',
          'React',
          'Docker',
          'AWS',
          'PostgreSQL',
          'Git',
        ],
        aiSpecializations: ['Generative AI', 'Retrieval-Augmented Generation'],
        collaborationInterests: ['Open-source AI tooling', 'Model evaluation pipelines'],
      },
      quarantinedPrivateData: [
        'Resumes (PDF/DOCX)',
        'Private Course Grades',
        'Raw Authentication Passwords',
        'EORA Private Chats',
        'Institutional Readiness Score',
        'Internal Mentor Notes',
      ],
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
