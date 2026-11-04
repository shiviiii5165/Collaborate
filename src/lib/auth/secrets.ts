import crypto from 'crypto';

/**
 * Server secret resolution with NO public fallback values.
 *
 * - Configured value: used as-is (must be >= 32 characters in production).
 * - Missing/short in production: throws (the service refuses to start / sign).
 * - Missing outside production: a random per-process secret is generated. It is never
 *   logged or written anywhere; sessions simply do not survive a restart.
 */
const MIN_PRODUCTION_LENGTH = 32;
const ephemeral = new Map<string, string>();
const warned = new Set<string>();

export class MissingSecretError extends Error {
  constructor(name: string, reason: string) {
    super(`SECRET_NOT_CONFIGURED: ${name} ${reason}`);
    this.name = 'MissingSecretError';
  }
}

export function resolveServerSecret(name: 'AUTH_SECRET' | 'SESSION_SECRET'): string {
  const value = (process.env[name] || '').trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (value) {
    if (isProd && value.length < MIN_PRODUCTION_LENGTH) {
      throw new MissingSecretError(name, `must be at least ${MIN_PRODUCTION_LENGTH} characters in production.`);
    }
    return value;
  }

  if (isProd) {
    throw new MissingSecretError(name, 'is required in production.');
  }

  if (!ephemeral.has(name)) {
    ephemeral.set(name, crypto.randomBytes(48).toString('base64url'));
  }
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[Security] ${name} is not set; using a random per-process development secret.`);
  }
  return ephemeral.get(name)!;
}

const isCloudRuntime = () =>
  Boolean(process.env.RENDER || process.env.VERCEL || process.env.VERCEL_ENV || process.env.FLY_APP_NAME || process.env.AWS_REGION);

/**
 * Fail closed on a hosted runtime that is not configured as production. Without this, a
 * hosted deploy missing NODE_ENV=production would use random per-process secrets and would
 * honour COLLABORATE_ENABLE_FIXTURES (simulated identities). Names only, never values.
 */
export function assertSafeRuntimeConfig(): void {
  if (!isCloudRuntime()) return;
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('UNSAFE_RUNTIME_CONFIG: NODE_ENV must be "production" on a hosted runtime.');
  }
  if (process.env.COLLABORATE_ENABLE_FIXTURES === 'true') {
    throw new Error('UNSAFE_RUNTIME_CONFIG: COLLABORATE_ENABLE_FIXTURES must not be set on a hosted runtime.');
  }
}

/** Throws in production if any required server secret is missing. Names only, never values. */
export function assertProductionSecrets(): void {
  assertSafeRuntimeConfig();
  if (process.env.NODE_ENV !== 'production') return;
  resolveServerSecret('AUTH_SECRET');
  resolveServerSecret('SESSION_SECRET');
}
