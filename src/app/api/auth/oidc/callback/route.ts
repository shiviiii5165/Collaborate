import { NextRequest, NextResponse } from 'next/server';
import { IdentityService } from '@/modules/identity/service';
import { buildSessionCookie } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error)}`, req.url));
    }
    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    }

    const { token } = await IdentityService.processOidcCallback(
      code,
      'pkce_verifier_from_cookie',
      state || ''
    );

    const res = NextResponse.redirect(new URL('/', req.url));
    res.headers.set('Set-Cookie', buildSessionCookie(token));
    return res;
  } catch (err: any) {
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(err.message)}`, req.url));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, codeVerifier, state, linkConfirmationPassword, mockClaims } = body;

    const { member, token, isNewUser } = await IdentityService.processOidcCallback(
      code || 'mock_code_tathastu_99',
      codeVerifier || 'mock_verifier_tathastu',
      state || 'mock_state',
      linkConfirmationPassword,
      mockClaims
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
