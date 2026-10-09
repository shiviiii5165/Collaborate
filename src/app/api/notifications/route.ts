import { NextRequest, NextResponse } from 'next/server';
import { durableDb } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const { searchParams } = new URL(req.url);
  const userId = session ? session.userId : (searchParams.get('userId') || 'usr_rahul');

  const notifications = durableDb.getNotificationsForUser(userId);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return NextResponse.json({ notifications, unreadCount });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { notifId } = body;
    if (notifId) {
      durableDb.markNotificationRead(notifId);
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Notification update failed' }, { status: 400 });
  }
}
