import crypto from 'crypto';

/**
 * Collaborate payment webhook contract (service-to-service, no user session).
 *
 *   POST /api/webhooks/payments          (also accepted on POST /api/billing)
 *   Content-Type: application/json
 *   X-Payment-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, "<t>.<raw body>")>
 *   Body: { "id": "<unique event id>", "type": "payment.succeeded", "data": { "memberId": "<collaborate member id>" } }
 *
 * - The timestamp is part of the signed material, so it cannot be altered.
 * - Timestamp tolerance: PAYMENT_WEBHOOK_TOLERANCE_SECONDS (300 s = 5 minutes) in either
 *   direction, to absorb clock skew and retries while keeping the replay window short.
 * - Each event id is accepted once (atomic durable claim); replays are rejected with 409.
 * - Missing PAYMENT_WEBHOOK_SECRET -> every webhook is rejected (fail closed).
 */
export const PAYMENT_WEBHOOK_TOLERANCE_SECONDS = 300;
export const PAYMENT_WEBHOOK_PROVIDER = 'payments';

export function getPaymentWebhookSecret(): string {
  return (process.env.PAYMENT_WEBHOOK_SECRET || '').trim();
}

export type PaymentSignatureResult =
  | { valid: true; timestamp: number }
  | { valid: false; error: 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE_FORMAT' | 'STALE_TIMESTAMP' | 'INVALID_SIGNATURE' };

export function signPaymentWebhook(rawBody: string, secret: string, timestamp: number): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

export function verifyPaymentWebhookSignature(
  rawBody: string | Buffer,
  header: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): PaymentSignatureResult {
  if (!header || !header.trim()) return { valid: false, error: 'MISSING_SIGNATURE' };

  const parts: Record<string, string> = {};
  for (const piece of header.split(',')) {
    const idx = piece.indexOf('=');
    if (idx > 0) parts[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim();
  }
  const t = parts.t;
  const v1 = (parts.v1 || '').toLowerCase();
  if (!t || !/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/.test(v1)) {
    return { valid: false, error: 'INVALID_SIGNATURE_FORMAT' };
  }

  const timestamp = Number(t);
  if (Math.abs(nowSeconds - timestamp) > PAYMENT_WEBHOOK_TOLERANCE_SECONDS) {
    return { valid: false, error: 'STALE_TIMESTAMP' };
  }

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(v1, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { valid: false, error: 'INVALID_SIGNATURE' };
  }
  return { valid: true, timestamp };
}
