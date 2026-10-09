import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';

const AUTH_SECRET_STRING = process.env.AUTH_SECRET || 'collaborate_production_secret_key_2026_at_least_32_bytes_long';
const AUTH_SECRET = new TextEncoder().encode(AUTH_SECRET_STRING);

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
    .sign(AUTH_SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, AUTH_SECRET);
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
