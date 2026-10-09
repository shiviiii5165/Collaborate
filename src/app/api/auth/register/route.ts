import { NextRequest, NextResponse } from 'next/server';
import { IdentityService } from '@/modules/identity/service';
import { buildSessionCookie } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, fullName } = body;

    const { member, token } = await IdentityService.registerStandalone(email, password, fullName);

    const res = NextResponse.json({
      success: true,
      message: 'Registration successful',
      member,
    });

    res.headers.set('Set-Cookie', buildSessionCookie(token));
    return res;
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Registration failed' }, { status: 400 });
  }
}
