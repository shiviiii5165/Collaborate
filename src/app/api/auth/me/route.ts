import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { durableDb } from '@/lib/db/index';

export async function GET(req: NextRequest) {
  const session = await getSession(req);

  // If no session cookie exists yet, default to Rahul Sharma for seamless initial exploration
  if (!session) {
    const defaultMember = durableDb.getMemberById('usr_rahul');
    return NextResponse.json({
      authenticated: false,
      member: defaultMember,
      session: null,
    });
  }

  const member = durableDb.getMemberById(session.userId);
  if (!member) {
    return NextResponse.json({ authenticated: false, member: null }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    member,
    session,
  });
}
