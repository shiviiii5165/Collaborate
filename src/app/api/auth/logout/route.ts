import { NextResponse } from 'next/server';
import { buildClearSessionCookie } from '@/lib/auth/session';

export async function POST() {
  const res = NextResponse.json({ success: true, message: 'Logged out' });
  res.headers.set('Set-Cookie', buildClearSessionCookie());
  return res;
}
