import { NextResponse } from 'next/server';
import { IdentityService } from '@/modules/identity/service';

export async function GET() {
  const oidcData = IdentityService.createOidcAuthUrl();
  return NextResponse.json({
    authUrl: oidcData.authUrl,
    state: oidcData.state,
    codeChallenge: oidcData.codeChallenge,
  });
}
