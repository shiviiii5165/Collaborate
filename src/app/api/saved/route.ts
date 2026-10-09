import { NextRequest, NextResponse } from 'next/server';
import { durableDb } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    const { searchParams } = new URL(req.url);
    const userId = session ? session.userId : (searchParams.get('userId') || 'usr_rahul');

    const savedMembers = durableDb.getSavedMembers(userId);

    return NextResponse.json({
      success: true,
      savedMembers,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch saved members' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();
    const { action, targetId } = body;

    if (!targetId) {
      return NextResponse.json({ error: 'targetId is required' }, { status: 400 });
    }

    const target = durableDb.getMemberById(targetId);
    if (!target) {
      return NextResponse.json({ error: 'Target member not found' }, { status: 404 });
    }

    // Privacy & safety: Cannot save blocked or private members
    if (durableDb.isBlocked(session.userId, targetId)) {
      return NextResponse.json({ error: 'Cannot save blocked member' }, { status: 403 });
    }

    if (action === 'save') {
      durableDb.saveMemberBookmark(session.userId, targetId);
    } else if (action === 'remove') {
      durableDb.removeMemberBookmark(session.userId, targetId);
    } else if (action === 'toggle') {
      const alreadySaved = durableDb.isMemberSaved(session.userId, targetId);
      if (alreadySaved) {
        durableDb.removeMemberBookmark(session.userId, targetId);
      } else {
        durableDb.saveMemberBookmark(session.userId, targetId);
      }
    } else {
      return NextResponse.json({ error: 'Invalid action. Must be save, remove, or toggle.' }, { status: 400 });
    }

    const isSaved = durableDb.isMemberSaved(session.userId, targetId);
    return NextResponse.json({
      success: true,
      isSaved,
      message: isSaved ? 'Profile saved to your bookmarks.' : 'Profile removed from your bookmarks.',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Saved action failed' }, { status: 500 });
  }
}
