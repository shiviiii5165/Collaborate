import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRecommendationsForMember } from '@/lib/recommendations';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get('q') || '').toLowerCase().trim();
  const filterSkill = (searchParams.get('skill') || '').toLowerCase().trim();
  const filterSpecialization = (searchParams.get('specialization') || '').toLowerCase().trim();
  const viewerId = searchParams.get('viewerId') || 'usr_rahul';

  const recommendations = getRecommendationsForMember(viewerId, 6);

  // Filter members for directory search
  const results: any[] = [];
  for (const m of db.members.values()) {
    if (m.id === viewerId || m.role === 'admin') continue;
    if (db.isBlocked(viewerId, m.id)) continue;
    if (!m.discoverable || m.profileVisibility === 'private') continue;

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

    if (matches) {
      const conn = db.getConnectionState(viewerId, m.id);
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
    viewerPlan: db.members.get(viewerId)?.plan || 'free',
  });
}
