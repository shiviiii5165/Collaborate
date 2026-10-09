import { NextRequest, NextResponse } from 'next/server';
import { durableDb } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';
import { getRecommendationsForMember } from '@/lib/recommendations';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get('q') || '').toLowerCase().trim();
  const filterSkill = (searchParams.get('skill') || '').toLowerCase().trim();
  const filterSpecialization = (searchParams.get('specialization') || '').toLowerCase().trim();
  const filterInstitution = (searchParams.get('institution') || '').toLowerCase().trim();
  const filterInterest = (searchParams.get('interest') || '').toLowerCase().trim();
  const viewerId = session ? session.userId : (searchParams.get('viewerId') || '');
  const isProduction = process.env.NODE_ENV === 'production';
  const enableFixtures = process.env.COLLABORATE_ENABLE_FIXTURES === 'true';

  const recommendations = viewerId ? getRecommendationsForMember(viewerId, 6) : [];

  // Filter members for directory search
  const results: any[] = [];
  for (const m of durableDb.getAllMembers()) {
    if (m.id === viewerId || m.role === 'admin') continue;
    if (viewerId && durableDb.isBlocked(viewerId, m.id)) continue;
    if (!m.discoverable || m.profileVisibility === 'private' || m.isRestricted) continue;
    
    // Isolate demo accounts from production discovery
    if (isProduction && !enableFixtures && m.isDemo) continue;

    let matches = true;

    if (query) {
      const text = `${m.fullName} ${m.headline} ${m.about} ${m.location} ${m.skills.join(
        ' '
      )} ${m.aiSpecializations.join(' ')} ${m.education
        .map((e) => e.institution)
        .join(' ')}`.toLowerCase();
      if (!text.includes(query)) matches = false;
    }

    if (filterSkill && !m.skills.some((s) => s.toLowerCase().includes(filterSkill))) {
      matches = false;
    }

    if (
      filterSpecialization &&
      !m.aiSpecializations.some((s) => s.toLowerCase().includes(filterSpecialization))
    ) {
      matches = false;
    }

    if (
      filterInstitution &&
      !m.education.some((e) => e.institution.toLowerCase().includes(filterInstitution)) &&
      !(m.institutionDomain && m.institutionDomain.toLowerCase().includes(filterInstitution))
    ) {
      matches = false;
    }

    if (
      filterInterest &&
      !m.collaborationInterests.some((i) => i.toLowerCase().includes(filterInterest))
    ) {
      matches = false;
    }

    if (matches) {
      const conn = durableDb.getConnectionState(viewerId, m.id);
      results.push({
        ...m,
        connectionStatus: conn ? conn.status : 'not_connected',
        connectionId: conn ? conn.id : null,
      });
    }
  }

  return NextResponse.json({
    recommendations,
    results,
    viewerPlan: durableDb.getMemberById(viewerId)?.plan || 'free',
  });
}
