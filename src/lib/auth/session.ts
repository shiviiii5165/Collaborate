import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';

import { resolveServerSecret } from './secrets';

// Resolved lazily (never at import time, so builds do not need the secret) and with no
// public fallback: missing in production -> throws.
function authSecret(): Uint8Array {
  return new TextEncoder().encode(resolveServerSecret('AUTH_SECRET'));
}

export const COOKIE_NAME = 'collaborate_session';

export interface SessionPayload {
  userId: string;
  email: string;
  role: 'member' | 'admin';
  plan: 'free' | 'premium';
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(authSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, authSecret(),{ algorithms: ['HS256'] });
    // Only genuine session tokens carry a userId and no audience. This rejects other
    // purpose-scoped tokens signed with the same secret (e.g. pending SSO link tokens).
    if (typeof payload.userId !== 'string' || !payload.userId || payload.aud !== undefined) {
      return null;
    }
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: (payload.role as 'member' | 'admin') || 'member',
      plan: (payload.plan as 'free' | 'premium') || 'free',
    };
  } catch {
    return null;
  }
}

export async function getSession(req: Request | NextRequest): Promise<SessionPayload | null> {
  let cookieHeader = '';
  if ('cookies' in req && typeof (req as NextRequest).cookies?.get === 'function') {
    const cookie = (req as NextRequest).cookies.get(COOKIE_NAME);
    if (cookie?.value) return verifySessionToken(cookie.value);
  } else {
    cookieHeader = req.headers.get('cookie') || '';
  }

  // Parse cookie header if nextRequest.cookies was not available
  if (cookieHeader) {
    const match = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    if (match) {
      const token = match.substring(COOKIE_NAME.length + 1);
      return verifySessionToken(token);
    }
  }

  // Also check Bearer Authorization header for API calls
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return verifySessionToken(token);
  }

  return null;
}

export async function requireAuth(req: Request | NextRequest): Promise<SessionPayload> {
  const session = await getSession(req);
  if (!session) {
    throw new Error('UNAUTHORIZED');
  }
  return session;
}

export async function requireAdmin(req: Request | NextRequest): Promise<SessionPayload> {
  const session = await requireAuth(req);
  if (session.role !== 'admin') {
    throw new Error('FORBIDDEN_ADMIN_REQUIRED');
  }
  return session;
}

export function buildSessionCookie(token: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    7 * 24 * 60 * 60
  }${isProd ? '; Secure' : ''}`;
}

export function buildClearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Pending AI Tathastu account-link token
// Holds VERIFIED external identity claims for 10 minutes while the user confirms
// their existing Collaborate password. It is audience-scoped and contains no
// userId, so verifySessionToken() can never accept it as a session.
// ---------------------------------------------------------------------------
export const PENDING_LINK_COOKIE_NAME = 'tathastu_pending_link';
const PENDING_LINK_AUDIENCE = 'collaborate:tathastu-pending-link';

export interface PendingLinkPayload {
  externalSubjectId: string;
  email: string;
  fullName: string;
}

export async function signPendingLinkToken(payload: PendingLinkPayload): Promise<string> {
  return await new SignJWT({ sub: payload.externalSubjectId, email: payload.email, name: payload.fullName })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(PENDING_LINK_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(authSecret());
}

export async function verifyPendingLinkToken(token: string): Promise<PendingLinkPayload | null> {
  try {
    const { payload } = await jwtVerify(token, authSecret(),{
      algorithms: ['HS256'],
      audience: PENDING_LINK_AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return {
      externalSubjectId: payload.sub,
      email: payload.email,
      fullName: typeof payload.name === 'string' ? payload.name : '',
    };
  } catch {
    return null;
  }
}
