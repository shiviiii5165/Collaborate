import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import {
  ProfessionalProjectionV1,
  TathastuTokenResponse,
  TathastuWebhookEvent,
} from './contract/types';
import { validateProfessionalProjection } from './contract/validator';
import { durableDb } from '@/lib/db/index';

/**
 * Enterprise AI Tathastu Integration Client
 * Implements the verified contract for AI Tathastu SSO, ES256 Token Validation,
 * ProfessionalProjectionV1 Profile API, and Webhooks.
 */
export class TathastuClient {
  private static cachedJwks: JWTVerifyGetKey | null = null;
  private static processedWebhookEvents = new Map<string, number>();

  /**
   * Validate all required integration environment variables at startup
   */
  public static validateStartupConfig(): { valid: boolean; missing: string[] } {
    const required = [
      { name: 'AIT_ISSUER', value: process.env.AIT_ISSUER || process.env.AI_TATHASTU_BASE_URL },
      { name: 'AIT_CLIENT_ID', value: process.env.AIT_CLIENT_ID || process.env.AI_TATHASTU_CLIENT_ID },
      { name: 'AIT_CLIENT_SECRET', value: process.env.AIT_CLIENT_SECRET || process.env.AI_TATHASTU_CLIENT_SECRET },
      { name: 'AIT_REDIRECT_URI', value: process.env.AIT_REDIRECT_URI || process.env.AI_TATHASTU_REDIRECT_URI },
      { name: 'AIT_WEBHOOK_SECRET', value: process.env.AIT_WEBHOOK_SECRET || process.env.AI_TATHASTU_WEBHOOK_SECRET },
    ];
    const missing = required.filter((r) => !r.value || r.value.trim() === '').map((r) => r.name);
    if (missing.length > 0 && process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required AI Tathastu integration environment variables: ${missing.join(', ')}`);
    }
    return { valid: missing.length === 0, missing };
  }

  /**
   * Resolve configured base URL for AI Tathastu platform
   */
  public static getBaseUrl(): string {
    const raw =
      process.env.AIT_ISSUER ||
      process.env.AI_TATHASTU_BASE_URL ||
      process.env.TATHASTU_CORE_API_URL ||
      'https://www.aitathastu.com';
    return raw.trim().replace(/\/+$/, '');
  }

  /**
   * Resolve configured Client ID for Collaborate
   */
  public static getClientId(): string {
    return (
      process.env.AIT_CLIENT_ID ||
      process.env.AI_TATHASTU_CLIENT_ID ||
      process.env.OIDC_CLIENT_ID ||
      'collaborate'
    ).trim();
  }

  /**
   * Resolve configured Client Secret for Collaborate
   */
  public static getClientSecret(): string {
    return (
      process.env.AIT_CLIENT_SECRET ||
      process.env.AI_TATHASTU_CLIENT_SECRET ||
      process.env.OIDC_CLIENT_SECRET ||
      ''
    ).trim();
  }

  /**
   * Resolve default Redirect URI for Collaborate callback
   */
  public static getRedirectUri(): string {
    if (process.env.AIT_REDIRECT_URI) {
      return process.env.AIT_REDIRECT_URI.trim();
    }
    if (process.env.AI_TATHASTU_REDIRECT_URI) {
      return process.env.AI_TATHASTU_REDIRECT_URI.trim();
    }
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://collaborate.aitathastu.com')
      .split(',')[0]
      .trim()
      .replace(/\/+$/, '');
    return `${appUrl}/api/auth/tathastu/callback`;
  }

  public static getAuthorizeUrl(): string {
    return (
      process.env.AIT_AUTHORIZE_URL ||
      process.env.AI_TATHASTU_AUTH_URL ||
      `${this.getBaseUrl()}/integrations/authorize`
    ).trim();
  }

  public static getTokenUrl(): string {
    return (
      process.env.AIT_TOKEN_URL ||
      process.env.AI_TATHASTU_TOKEN_URL ||
      `${this.getBaseUrl()}/api/integrations/sso/token`
    ).trim();
  }

  public static getProfileUrl(): string {
    return (
      process.env.AIT_PROFILE_URL ||
      process.env.AI_TATHASTU_PROFILE_URL ||
      `${this.getBaseUrl()}/api/integrations/v1/profile`
    ).trim();
  }

  public static getJwksUrl(): string {
    return (
      process.env.AIT_JWKS_URL ||
      process.env.AI_TATHASTU_JWKS_URL ||
      `${this.getBaseUrl()}/api/integrations/jwks`
    ).trim();
  }

  public static getWebhookSecret(): string {
    return (
      process.env.AIT_WEBHOOK_SECRET ||
      process.env.AI_TATHASTU_WEBHOOK_SECRET ||
      ''
    ).trim();
  }

  /**
   * 1. Generate OAuth-style Authorization URL with S256 PKCE and CSRF state
   */
  public static createAuthorizationUrl(options?: {
    redirectUri?: string;
    state?: string;
    codeVerifier?: string;
    scopes?: string[];
    prompt?: string;
  }): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    codeChallenge: string;
    redirectUri: string;
  } {
    const clientId = this.getClientId();
    const redirectUri = options?.redirectUri || this.getRedirectUri();

    // 1. High-entropy state parameter for CSRF mitigation (RFC 6749)
    const state = options?.state || crypto.randomBytes(32).toString('base64url');

    // 2. PKCE code_verifier (high-entropy cryptographic random string 43-128 chars)
    const codeVerifier = options?.codeVerifier || crypto.randomBytes(48).toString('base64url');

    // 3. PKCE S256 code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Scopes supported by AI Tathastu integration system
    const scopesList =
      options?.scopes && options.scopes.length > 0
        ? options.scopes
        : ['skills', 'projects', 'eris', 'experience', 'education', 'achievements', 'activity'];
    const scopeParam = encodeURIComponent(scopesList.join(' '));

    const authEndpoint = this.getAuthorizeUrl();

    let authUrl = `${authEndpoint}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&state=${encodeURIComponent(
      state
    )}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256&scope=${scopeParam}`;

    if (options?.prompt) {
      authUrl += `&prompt=${encodeURIComponent(options.prompt)}`;
    }

    return {
      authUrl,
      state,
      codeVerifier,
      codeChallenge,
      redirectUri,
    };
  }

  /**
   * 2. Exchange one-time authorization code for ES256 access token
   */
  public static async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    redirectUri?: string
  ): Promise<TathastuTokenResponse> {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();
    const targetRedirectUri = redirectUri || this.getRedirectUri();

    if (!code || !code.trim()) {
      throw new Error('MISSING_AUTHORIZATION_CODE: Authorization code is required.');
    }
    if (!codeVerifier || !codeVerifier.trim()) {
      throw new Error('MISSING_CODE_VERIFIER: PKCE code_verifier is required.');
    }

    const tokenEndpoint = this.getTokenUrl();

    const authHeader = `Basic ${Buffer.from(
      `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`
    ).toString('base64')}`;

    const formParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.trim(),
      redirect_uri: targetRedirectUri,
      code_verifier: codeVerifier.trim(),
    });

    let response: Response;
    try {
      response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'Collaborate-Auth-Client/1.0',
        },
        body: formParams.toString(),
      });
    } catch (err: any) {
      throw new Error(`PROVIDER_UNAVAILABLE: Failed to reach AI Tathastu token endpoint: ${err.message}`);
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      const errCode = data?.error || 'TOKEN_EXCHANGE_FAILED';
      const errDesc = data?.error_description || data?.message || `HTTP ${response.status} from token endpoint`;
      throw new Error(`${errCode}: ${errDesc}`);
    }

    if (!data.access_token) {
      throw new Error('INVALID_TOKEN_RESPONSE: Response did not contain an access_token.');
    }

    return {
      access_token: data.access_token,
      token_type: data.token_type || 'Bearer',
      expires_in: typeof data.expires_in === 'number' ? data.expires_in : 900,
      scope: data.scope || 'profile:read',
      id_token: data.id_token,
      user: data.user,
    };
  }

  /**
   * 3. Validate access token against AI Tathastu JWKS public keys
   * Enforces ES256 ONLY, rejecting forged, expired, wrong-audience, wrong-issuer,
   * or unsupported-algorithm tokens.
   */
  public static async verifyAccessToken(
    token: string,
    options?: {
      jwksUrl?: string;
      expectedIssuer?: string;
      expectedAudience?: string;
      customKeySet?: any;
    }
  ): Promise<{
    payload: Record<string, any>;
    protectedHeader: Record<string, any>;
  }> {
    if (!token || typeof token !== 'string') {
      throw new Error('INVALID_TOKEN: Access token string is required.');
    }

    // 1. Structural inspection & ES256 algorithm enforcement
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('INVALID_TOKEN_FORMAT: Access token is not a valid 3-part JWT.');
    }

    let header: any;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      throw new Error('INVALID_TOKEN_HEADER: Failed to parse JWT header.');
    }

    // Strict algorithm gating: ES256 ONLY
    if (header.alg !== 'ES256') {
      throw new Error(
        `UNSUPPORTED_ALGORITHM: Expected ES256 signing algorithm per AI Tathastu contract, received: ${header.alg}. Tokens using '${header.alg}' are strictly rejected.`
      );
    }

    const expectedAudience = options?.expectedAudience || this.getClientId();
    const expectedIssuer = options?.expectedIssuer || this.getBaseUrl();
    const jwksUrl = options?.jwksUrl || process.env.AI_TATHASTU_JWKS_URL || `${this.getBaseUrl()}/api/integrations/jwks`;

    // 2. Resolve JWKS
    let keySet: any = options?.customKeySet;
    if (!keySet) {
      if (!this.cachedJwks) {
        this.cachedJwks = createRemoteJWKSet(new URL(jwksUrl), {
          cooldownDuration: 15000,
          cacheMaxAge: 600000,
        });
      }
      keySet = this.cachedJwks;
    }

    // 3. Cryptographic validation using jose
    try {
      const { payload, protectedHeader } = await jwtVerify(token, keySet, {
        algorithms: ['ES256'],
        audience: expectedAudience,
        issuer: expectedIssuer,
      });

      return { payload, protectedHeader };
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('expired') || err.code === 'ERR_JWT_EXPIRED') {
        throw new Error('TOKEN_EXPIRED: The AI Tathastu access token has expired.');
      }
      if (err.claim === 'iss' || msg.includes('issuer')) {
        throw new Error(`WRONG_ISSUER: Token issuer mismatch. ${msg}`);
      }
      if (err.claim === 'aud' || msg.includes('audience') || err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
        throw new Error(`WRONG_AUDIENCE: Token audience mismatch. ${msg}`);
      }
      throw new Error(`TOKEN_VERIFICATION_FAILED: ${msg}`);
    }
  }

  /**
   * 4. Fetch user's authorized ProfessionalProjectionV1 profile server-to-server
   */
  public static async fetchProfile(
    accessToken: string,
    profileUrl?: string
  ): Promise<ProfessionalProjectionV1> {
    const baseUrl = this.getBaseUrl();
    const targetUrl = profileUrl || process.env.AI_TATHASTU_PROFILE_URL || `${baseUrl}/api/integrations/v1/profile`;

    let res: Response;
    try {
      res = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'User-Agent': 'Collaborate-Profile-Sync/1.0',
        },
      });
    } catch (err: any) {
      throw new Error(`PROVIDER_UNAVAILABLE: Failed to reach AI Tathastu Profile API: ${err.message}`);
    }

    if (res.status === 401) {
      throw new Error('TOKEN_REVOKED_OR_EXPIRED: Profile fetch rejected with 401 Unauthorized.');
    }
    if (res.status === 403) {
      throw new Error('CONSENT_REQUIRED: User has not granted profile sharing permissions.');
    }
    if (!res.ok) {
      throw new Error(`PROFILE_FETCH_FAILED: AI Tathastu profile API returned HTTP ${res.status}: ${res.statusText}`);
    }

    const json = await res.json().catch(() => null);
    if (!json) {
      throw new Error('INVALID_PROFILE_PAYLOAD: Empty or invalid JSON received from Profile API.');
    }

    // Validate against versioned contract schema
    return validateProfessionalProjection(json);
  }

  /**
   * 5. Cryptographic Webhook Signature & Freshness Verification
   * Verifies HMAC-SHA256 signature using raw body and checks 5-minute freshness window.
   * Supports both X-AIT-Signature (t=<unix>,v1=<hmac>) and legacy X-Tathastu-Signature.
   */
  public static verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader?: string,
    timestampHeader?: string,
    customSecret?: string
  ): { valid: boolean; error?: string } {
    const secret = customSecret || this.getWebhookSecret();

    if (!secret || !secret.trim()) {
      return { valid: false, error: 'WEBHOOK_SECRET_NOT_CONFIGURED: AIT_WEBHOOK_SECRET is not configured.' };
    }

    if (!signatureHeader || !signatureHeader.trim()) {
      return { valid: false, error: 'MISSING_SIGNATURE: Webhook signature header is missing.' };
    }

    const rawBodyBuffer = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    const rawBodyStr = rawBodyBuffer.toString('utf8');

    // Format 1: Exact AI Tathastu contract format: "t=<unix seconds>,v1=<hex>"
    if (signatureHeader.includes('t=') && signatureHeader.includes('v1=')) {
      const parts = signatureHeader.split(',').reduce((acc, part) => {
        const [k, v] = part.trim().split('=');
        if (k && v) acc[k] = v;
        return acc;
      }, {} as Record<string, string>);

      const tStr = parts.t;
      const v1 = parts.v1;
      if (!tStr || !v1) {
        return { valid: false, error: 'INVALID_SIGNATURE_FORMAT: Expected t=<timestamp>,v1=<signature>.' };
      }

      const tNum = parseInt(tStr, 10);
      if (isNaN(tNum)) {
        return { valid: false, error: 'INVALID_TIMESTAMP: Webhook timestamp could not be parsed.' };
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const ageSeconds = Math.abs(nowSeconds - tNum);
      if (ageSeconds > 300) {
        return {
          valid: false,
          error: `STALE_TIMESTAMP: Webhook timestamp is outside the 5-minute replay window (${ageSeconds}s old).`,
        };
      }

      const expectedSig = crypto
        .createHmac('sha256', secret.trim())
        .update(`${tStr}.${rawBodyStr}`)
        .digest('hex')
        .toLowerCase();

      const cleanSig = v1.trim().toLowerCase();
      const cleanBuf = Buffer.from(cleanSig, 'utf8');
      const expectedBuf = Buffer.from(expectedSig, 'utf8');

      if (cleanBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(cleanBuf, expectedBuf)) {
        return { valid: false, error: 'INVALID_SIGNATURE: HMAC SHA-256 cryptographic signature mismatch.' };
      }

      return { valid: true };
    }

    // Format 2: Fallback / Legacy format: timestampHeader with raw or sha256=<hex> signature
    if (timestampHeader) {
      const eventTime = isNaN(Number(timestampHeader))
        ? Date.parse(timestampHeader)
        : Number(timestampHeader) > 10000000000
        ? Number(timestampHeader)
        : Number(timestampHeader) * 1000;

      if (isNaN(eventTime)) {
        return { valid: false, error: 'INVALID_TIMESTAMP: Webhook timestamp header could not be parsed.' };
      }
      const ageMs = Math.abs(Date.now() - eventTime);
      if (ageMs > 300000) {
        return {
          valid: false,
          error: `STALE_TIMESTAMP: Webhook timestamp is outside the 5-minute replay window (${Math.round(
            ageMs / 1000
          )}s old).`,
        };
      }
    }

    const cleanSig = signatureHeader.replace(/^sha256=/i, '').trim().toLowerCase();
    const expectedSig = crypto
      .createHmac('sha256', secret.trim())
      .update(rawBodyBuffer)
      .digest('hex')
      .toLowerCase();

    const cleanBuf = Buffer.from(cleanSig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');

    if (cleanBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(cleanBuf, expectedBuf)) {
      return { valid: false, error: 'INVALID_SIGNATURE: HMAC SHA-256 cryptographic signature mismatch.' };
    }

    return { valid: true };
  }

  /**
   * 6. Webhook Idempotency & Replay Protection
   * Records event IDs and rejects duplicate deliveries safely.
   * Persists to durable storage (Postgres / JSON store) to survive process restarts
   * and multi-instance cloud deployments.
   */
  public static checkAndRecordWebhookEvent(eventId: string): { isDuplicate: boolean } {
    if (!eventId) return { isDuplicate: false };

    // 1. Fast in-memory check
    const now = Date.now();
    for (const [id, ts] of this.processedWebhookEvents.entries()) {
      if (now - ts > 86400000) {
        this.processedWebhookEvents.delete(id);
      }
    }

    if (this.processedWebhookEvents.has(eventId)) {
      return { isDuplicate: true };
    }

    // 2. Check durable storage
    if (durableDb.isWebhookProcessed('aitathastu', eventId)) {
      this.processedWebhookEvents.set(eventId, now);
      return { isDuplicate: true };
    }

    this.processedWebhookEvents.set(eventId, now);
    durableDb.recordWebhookEvent('aitathastu', eventId, 'webhook');
    return { isDuplicate: false };
  }

  public static async checkAndRecordWebhookEventAsync(
    eventId: string,
    eventType: string = 'webhook',
    payload: any = {}
  ): Promise<{ isDuplicate: boolean }> {
    if (!eventId) return { isDuplicate: false };

    if (this.processedWebhookEvents.has(eventId)) {
      return { isDuplicate: true };
    }

    const isProcessed = await durableDb.isWebhookProcessedAsync('aitathastu', eventId);
    if (isProcessed) {
      this.processedWebhookEvents.set(eventId, Date.now());
      return { isDuplicate: true };
    }

    this.processedWebhookEvents.set(eventId, Date.now());
    await durableDb.recordWebhookEventAsync('aitathastu', eventId, eventType, payload);
    return { isDuplicate: false };
  }

  /**
   * For testing: Reset internal caches
   */
  public static resetCaches(): void {
    this.cachedJwks = null;
    this.processedWebhookEvents.clear();
  }
}
