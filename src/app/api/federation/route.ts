import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const userId = searchParams.get('userId') || 'usr_rahul';

  // 1. Fetch Person 360 projection proposal from Tathastu Core
  if (action === 'get_projection') {
    const projection = {
      sourcePersonId: 'core_person_8921',
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
      excludedPrivateData: [
        'Resumes (PDF)',
        'Private Course Grades',
        'Raw Auth Passwords',
        'EORA Private Chats',
        'Internal Institutional Rank',
      ],
    };

    return NextResponse.json(projection);
  }

  // 2. Check sync status
  const member = db.members.get(userId);
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  return NextResponse.json({
    isLinked: member.isLinkedWithTathastu,
    syncStatus: member.tathastuSyncStatus,
    syncSettings: member.tathastuSyncSettings,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userId, selectedFields, syncSettings } = body;
    const member = db.members.get(userId || 'usr_rahul');

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    if (action === 'one_click_import') {
      // Threads-style initial profile generation from approved data
      member.isLinkedWithTathastu = true;
      member.tathastuSyncStatus = 'synced';
      if (syncSettings) {
        member.tathastuSyncSettings = syncSettings;
      }
      return NextResponse.json({
        success: true,
        message: 'Successfully generated profile draft from AI Tathastu Core',
        member,
      });
    }

    if (action === 'update_sync_settings') {
      member.tathastuSyncSettings = syncSettings;
      return NextResponse.json({ success: true, syncSettings: member.tathastuSyncSettings });
    }

    if (action === 'revoke_link') {
      // User disconnects Tathastu Core.
      // Keeps independent Collaborate identity, messages, and connections intact.
      member.isLinkedWithTathastu = false;
      member.tathastuSyncStatus = 'unlinked';
      return NextResponse.json({
        success: true,
        message: 'Tathastu Core link revoked. Collaborate account remains active independently.',
      });
    }

    return NextResponse.json({ error: 'Unknown federation action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Federation action failed' }, { status: 500 });
  }
}
