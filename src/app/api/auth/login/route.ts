import { NextRequest, NextResponse } from 'next/server';
import { IdentityService } from '@/modules/identity/service';
import { buildSessionCookie } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    const { member, token } = await IdentityService.loginWithPassword(email, password);

    const res = NextResponse.json({
      success: true,
      message: 'Logged in successfully',
      member,
    });

    res.headers.set('Set-Cookie', buildSessionCookie(token));
    return res;
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Login failed' }, { status: 401 });
  }
}
