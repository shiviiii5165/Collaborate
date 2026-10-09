import { NextRequest, NextResponse } from 'next/server';
import { db, getKolkataDateKey } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetId = searchParams.get('id') || 'usr_rahul';
  const viewerId = searchParams.get('viewerId') || 'usr_rahul';

  const member = db.members.get(targetId);
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  // Check if viewing someone else
  if (viewerId !== targetId) {
    if (db.isBlocked(viewerId, targetId)) {
      return NextResponse.json({ error: 'Profile not available' }, { status: 403 });
    }

    if (member.profileVisibility === 'private') {
      return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
    }

    if (member.profileVisibility === 'connections_only') {
      const conn = db.getConnectionState(viewerId, targetId);
      if (!conn || conn.status !== 'accepted') {
        return NextResponse.json(
          { error: 'Profile visible to accepted connections only' },
          { status: 403 }
        );
      }
    }

    // Atomic 3-profile daily quota enforcement
    const quotaResult = db.recordProfileView(viewerId, targetId);
    if (!quotaResult.allowed) {
      return NextResponse.json(
        {
          error: 'QUOTA_EXCEEDED',
          message:
            'You have reached your daily Free plan quota of 3 distinct full-profile views. Upgrade to Collaborate Premium for unlimited access.',
          dateKey: getKolkataDateKey(),
          remaining: 0,
        },
        { status: 402 }
      );
    }

    const conn = db.getConnectionState(viewerId, targetId);

    return NextResponse.json({
      member,
      quota: {
        remaining: quotaResult.remaining,
        alreadyViewedToday: quotaResult.alreadyViewedToday,
        dateKey: getKolkataDateKey(),
      },
      connectionStatus: conn ? conn.status : 'not_connected',
      connectionId: conn ? conn.id : null,
    });
  }

  // Viewing own profile
  return NextResponse.json({
    member,
    quota: {
      remaining: 3,
      alreadyViewedToday: true,
      dateKey: getKolkataDateKey(),
    },
    connectionStatus: 'self',
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, updates } = body;

    const member = db.members.get(id || 'usr_rahul');
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Apply permitted profile updates
    Object.assign(member, updates);

    // If headline or about was modified manually, record local override to prevent silent overwrite from Core
    if (updates.headline || updates.about) {
      member.tathastuSyncStatus = 'synced';
    }

    return NextResponse.json({ success: true, member });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Update failed' }, { status: 500 });
  }
}
