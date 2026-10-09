import { NextRequest, NextResponse } from 'next/server';
import { IdentityService } from '@/modules/identity/service';
import { buildSessionCookie } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, codeVerifier, state } = body;

    const { member, token, isNewUser } = await IdentityService.processOidcCallback(
      code || 'mock_code_tathastu_99',
      codeVerifier || 'mock_verifier_tathastu',
      state || 'mock_state'
    );

    const res = NextResponse.json({
      success: true,
      member,
      isNewUser,
      message: isNewUser
        ? 'Account successfully generated from AI Tathastu SSO.'
        : 'Logged in with AI Tathastu Single Sign-On.',
    });

    res.headers.set('Set-Cookie', buildSessionCookie(token));
    return res;
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'OIDC callback failed' }, { status: 400 });
  }
}
