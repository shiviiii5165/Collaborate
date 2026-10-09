import { NextRequest, NextResponse } from 'next/server';

/**
 * Collaborate. by AI Tathastu — Unified Vercel API Gateway
 *
 * Responsibilities:
 * - Transparent, secure forwarding of all /api/* requests to authoritative Render backend.
 * - Enforcement of host-only cookies on Vercel domain (strips any upstream domain attributes).
 * - Full streaming propagation for Server-Sent Events (SSE) messages.
 * - Zero database credentials or authoritative business logic execution on Vercel.
 * - Resilient 503 fallback during Render cold-starts so the UI displays graceful retry state.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBackendBaseUrl(): string {
  const envUrl = process.env.COLLABORATE_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/$/, '');
  }
  return 'https://collaborate-sggk.onrender.com';
}

function sanitizeHostOnlyCookie(cookieStr: string): string {
  // Strip any Domain=... attribute to enforce strict host-only cookie on the Vercel frontend origin
  return cookieStr.replace(/;\s*Domain=[^;]+/gi, '').trim();
}

async function gatewayHandler(req: NextRequest): Promise<Response> {
  const backendBase = getBackendBaseUrl();
  const url = new URL(req.url);
  const targetUrl = `${backendBase}${url.pathname}${url.search}`;

  // Forward incoming headers, excluding hop-by-hop headers
  const forwardHeaders = new Headers();
  const hopByHop = new Set([
    'host',
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'content-length',
  ]);

  req.headers.forEach((value, key) => {
    if (!hopByHop.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });

  // Attach gateway routing and tracking headers
  forwardHeaders.set('x-forwarded-host', req.headers.get('host') || 'collaborate-umber.vercel.app');
  forwardHeaders.set('x-forwarded-proto', 'https');
  const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
  forwardHeaders.set('x-forwarded-for', clientIp);

  // Read request body if method allows body
  let body: BodyInit | undefined = undefined;
  if (!['GET', 'HEAD'].includes(req.method)) {
    const arrayBuffer = await req.arrayBuffer();
    if (arrayBuffer.byteLength > 0) {
      body = arrayBuffer;
    }
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body,
      redirect: 'manual',
      cache: 'no-store',
    });

    const contentType = upstreamRes.headers.get('content-type') || '';

    // 1. Server-Sent Events (SSE) streaming support
    if (contentType.includes('text/event-stream')) {
      const streamHeaders = new Headers();
      streamHeaders.set('Content-Type', 'text/event-stream');
      streamHeaders.set('Cache-Control', 'no-cache, no-transform');
      streamHeaders.set('Connection', 'keep-alive');
      streamHeaders.set('X-Accel-Buffering', 'no');

      if (typeof upstreamRes.headers.getSetCookie === 'function') {
        const cookies = upstreamRes.headers.getSetCookie();
        cookies.forEach((c) => streamHeaders.append('Set-Cookie', sanitizeHostOnlyCookie(c)));
      }

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: streamHeaders,
      });
    }

    // 2. Standard JSON / REST responses
    const responseHeaders = new Headers();
    upstreamRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!hopByHop.has(lower) && lower !== 'set-cookie') {
        responseHeaders.set(key, value);
      }
    });

    // Propagate Set-Cookie as host-only cookies
    if (typeof upstreamRes.headers.getSetCookie === 'function') {
      const cookies = upstreamRes.headers.getSetCookie();
      cookies.forEach((c) => {
        responseHeaders.append('Set-Cookie', sanitizeHostOnlyCookie(c));
      });
    } else {
      const setCookie = upstreamRes.headers.get('set-cookie');
      if (setCookie) {
        responseHeaders.append('Set-Cookie', sanitizeHostOnlyCookie(setCookie));
      }
    }

    const responseBody = await upstreamRes.arrayBuffer();
    return new NextResponse(responseBody, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error(`[Vercel Gateway] Upstream error contacting ${targetUrl}:`, err.message);

    return NextResponse.json(
      {
        error: 'BACKEND_SERVICE_UNAVAILABLE',
        message: 'Collaborate backend service is warming up or temporarily unreachable. Please retry.',
        target: targetUrl,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

export const GET = gatewayHandler;
export const POST = gatewayHandler;
export const PUT = gatewayHandler;
export const DELETE = gatewayHandler;
export const PATCH = gatewayHandler;
export const HEAD = gatewayHandler;
export const OPTIONS = gatewayHandler;
