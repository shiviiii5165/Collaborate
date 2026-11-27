/**
 * Fixed-window attempt limiter for password-bearing endpoints (login, registration,
 * account-link confirmation, password change, account deletion).
 *
 * Per instance: with N API instances an attacker gets at most N x the limit. That still bounds
 * brute force; a shared (Postgres) counter is a documented follow-up in the runbook.
 * Memory is bounded (oldest keys evicted).
 */
type Bucket = { count: number; resetAt: number };

const MAX_KEYS = 20_000;

export class AttemptLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Records an attempt. Returns retryAfter seconds when the key is over its limit. */
  hit(key: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs };
      if (this.buckets.size >= MAX_KEYS) this.buckets.delete(this.buckets.keys().next().value as string);
      this.buckets.set(key, b);
    }
    b.count++;
    return b.count > this.limit ? { allowed: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) } : { allowed: true, retryAfter: 0 };
  }

  reset(key: string) {
    this.buckets.delete(key);
  }
}

/**
 * Per 15 minutes: 10 attempts per account+IP, 50 per IP, and 30 per account from ANY IP.
 *
 * The IP comes from X-Forwarded-For (the API runs behind Render's proxy and the Vercel gateway, so
 * trustProxy is on). The API is also reachable directly, where that header is client-controlled, so
 * the two IP-keyed limits alone can be bypassed by sending a new X-Forwarded-For per request. The
 * account-only limit caps guesses against one account however the IP is presented.
 */
export const passwordAttemptsPerAccount = new AttemptLimiter(10, 15 * 60_000);
export const passwordAttemptsPerIp = new AttemptLimiter(50, 15 * 60_000);
export const passwordAttemptsPerAccountAnyIp = new AttemptLimiter(30, 15 * 60_000);

/**
 * Anti-scraping limits for reads of OTHER members' profiles, keyed on the signed-in member id (not the IP,
 * which a direct caller can spoof). Generous for a person browsing; far too low to copy the directory.
 */
// Discover is paged (20 per request), so 120 requests = up to 2,400 profiles per 10 minutes for scrolling and searching.
export const discoverReadsPerMember = new AttemptLimiter(120, 10 * 60_000);
export const profileReadsPerMember = new AttemptLimiter(150, 10 * 60_000);

/** Anti-spam limits for writes that reach another member, keyed on the signed-in member id. */
export const messagesSentPerMember = new AttemptLimiter(60, 60_000); // a fast conversation, not a flood
export const connectionRequestsPerMember = new AttemptLimiter(40, 60 * 60_000);

export function checkPasswordAttempt(ip: string, account: string): { allowed: boolean; retryAfter: number } {
  const acct = account.toLowerCase().trim();
  const perIp = passwordAttemptsPerIp.hit(`ip:${ip}`);
  const perAccount = passwordAttemptsPerAccount.hit(`acct:${acct}|${ip}`);
  const perAccountAnyIp = passwordAttemptsPerAccountAnyIp.hit(`acct:${acct}`);
  if (!perIp.allowed || !perAccount.allowed || !perAccountAnyIp.allowed) {
    return { allowed: false, retryAfter: Math.max(perIp.retryAfter, perAccount.retryAfter, perAccountAnyIp.retryAfter) };
  }
  return { allowed: true, retryAfter: 0 };
}
