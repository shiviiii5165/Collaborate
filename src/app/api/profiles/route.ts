import { NextRequest, NextResponse } from 'next/server';
import { durableDb, getKolkataDateKey } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';
import { z } from 'zod';

const ProfileUpdateSchema = z.object({
  headline: z.string().max(255).optional(),
  about: z.string().max(3000).optional(),
  location: z.string().max(128).optional(),
  skills: z.array(z.string().max(64)).max(50).optional(),
  statusBadges: z.array(z.string().max(64)).max(10).optional(),
  profileVisibility: z.enum(['public', 'connections_only', 'private']).optional(),
  contactVisibility: z.enum(['connections_only', 'hidden']).optional(),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const session = await getSession(req);
  const isFixturesAllowed = process.env.COLLABORATE_ENABLE_FIXTURES === 'true';

  const targetId = searchParams.get('id') || (session ? session.userId : (isFixturesAllowed ? 'usr_rahul' : ''));
  if (!targetId) {
    return NextResponse.json({ error: 'Profile ID required' }, { status: 400 });
  }

  // Resolve viewer from verified session cookie
  const viewerId = session ? session.userId : (searchParams.get('viewerId') || '');

  const member = durableDb.getMemberById(targetId);
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  // Check if viewing someone else
  if (viewerId !== targetId) {
    if (durableDb.isBlocked(viewerId, targetId)) {
      return NextResponse.json({ error: 'Profile not available' }, { status: 403 });
    }

    if (member.profileVisibility === 'private' && session?.role !== 'admin') {
      return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
    }

    if (member.profileVisibility === 'connections_only' && session?.role !== 'admin') {
      const conn = durableDb.getConnectionState(viewerId, targetId);
      if (!conn || conn.status !== 'accepted') {
        return NextResponse.json(
          { error: 'Profile visible to accepted connections only' },
          { status: 403 }
        );
      }
    }

    // Guest viewer viewing public profile
    if (!viewerId) {
      return NextResponse.json({
        member,
        quota: { remaining: 3, alreadyViewedToday: false, dateKey: getKolkataDateKey() },
        connectionStatus: 'not_connected',
        connectionId: null,
      });
    }

    // Atomic 3-profile daily quota enforcement
    const quotaResult = durableDb.recordProfileView(viewerId, targetId);
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

    const conn = durableDb.getConnectionState(viewerId, targetId);

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

  // Viewing own profile: unlimited
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
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Authentication required to update profile' }, { status: 401 });
    }
    const body = await req.json();
    const targetUserId = body.id || session.userId;

    // Strict Authorization: Users can ONLY edit their own profile unless admin
    if (session.userId !== targetUserId && session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized to edit this profile' }, { status: 403 });
    }

    const member = durableDb.getMemberById(targetUserId);
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Validate updates
    const validated = ProfileUpdateSchema.parse(body.updates || {});

    // Apply updates
    if (validated.headline !== undefined) member.headline = validated.headline;
    if (validated.about !== undefined) member.about = validated.about;
    if (validated.location !== undefined) member.location = validated.location;
    if (validated.skills !== undefined) member.skills = validated.skills;
    if (validated.statusBadges !== undefined) member.statusBadges = validated.statusBadges;
    if (validated.profileVisibility !== undefined) member.profileVisibility = validated.profileVisibility;
    if (validated.contactVisibility !== undefined) member.contactVisibility = validated.contactVisibility;

    // Preserve local override so Core sync does not overwrite custom headline/about
    member.tathastuSyncStatus = 'synced';

    durableDb.saveMember(member);

    return NextResponse.json({ success: true, member });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Profile update failed' },
      { status: error.name === 'ZodError' ? 422 : 500 }
    );
  }
}
