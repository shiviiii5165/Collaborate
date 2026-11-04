/**
 * AI Tathastu integration runtime configuration & diagnostics.
 *
 * - Reports missing variable NAMES only. Never returns or logs values.
 * - Decides whether real AI Tathastu SSO is enabled (live mode + complete config).
 * - Decides whether the in-process test harness (claimsOverride / demo personas)
 *   may run. The harness is NEVER available when NODE_ENV=production.
 */

export type TathastuIntegrationMode = 'mock' | 'live';

/** Reads TATHASTU_INTEGRATION_MODE. Anything other than an explicit "live" is mock. */
export function getIntegrationMode(): TathastuIntegrationMode {
  return (process.env.TATHASTU_INTEGRATION_MODE || '').trim().toLowerCase() === 'live' ? 'live' : 'mock';
}

function present(...names: string[]): boolean {
  return names.some((n) => {
    const v = process.env[n];
    return typeof v === 'string' && v.trim() !== '';
  });
}

/**
 * Variables required for live SSO. Each entry lists the canonical name first,
 * followed by the pre-existing legacy alias the client already reads.
 */
const REQUIRED_SSO_VARS: Array<[string, ...string[]]> = [
  ['AIT_ISSUER', 'AI_TATHASTU_BASE_URL'],
  ['AIT_CLIENT_ID', 'AI_TATHASTU_CLIENT_ID'],
  ['AIT_CLIENT_SECRET', 'AI_TATHASTU_CLIENT_SECRET'],
  ['AIT_REDIRECT_URI', 'AI_TATHASTU_REDIRECT_URI'],
];

const REQUIRED_WEBHOOK_VARS: Array<[string, ...string[]]> = [['AIT_WEBHOOK_SECRET', 'AI_TATHASTU_WEBHOOK_SECRET']];

export interface TathastuConfigDiagnostics {
  mode: TathastuIntegrationMode;
  ssoEnabled: boolean;
  missingSsoVariables: string[];
  missingWebhookVariables: string[];
  insecureDefaults: string[];
  testHarnessEnabled: boolean;
}

export function getMissingSsoVariables(): string[] {
  return REQUIRED_SSO_VARS.filter((names) => !present(...names)).map((names) => names[0]);
}

export function getConfigDiagnostics(): TathastuConfigDiagnostics {
  const mode = getIntegrationMode();
  const missingSsoVariables = getMissingSsoVariables();
  const missingWebhookVariables = REQUIRED_WEBHOOK_VARS.filter((names) => !present(...names)).map((n) => n[0]);
  const insecureDefaults: string[] = [];
  if (!present('AUTH_SECRET')) insecureDefaults.push('AUTH_SECRET');
  if (!present('SESSION_SECRET')) insecureDefaults.push('SESSION_SECRET');

  return {
    mode,
    ssoEnabled: mode === 'live' && missingSsoVariables.length === 0,
    missingSsoVariables,
    missingWebhookVariables,
    insecureDefaults,
    testHarnessEnabled: isTestHarnessEnabled(),
  };
}

/** Real SSO only runs in live mode with every required variable present. */
export function isSsoEnabled(): boolean {
  return getConfigDiagnostics().ssoEnabled;
}

/**
 * Simulated identity claims and demo personas are allowed only when explicitly
 * enabled AND the process is not running in production.
 */
export function isTestHarnessEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.COLLABORATE_ENABLE_FIXTURES === 'true';
}

/** Startup log lines: names only, never values. */
export function formatStartupDiagnostics(): string[] {
  const d = getConfigDiagnostics();
  const lines = [`[AI Tathastu] Integration mode: ${d.mode.toUpperCase()}${d.mode === 'mock' ? ' (AI Tathastu SSO disabled; mock profile adapter only)' : ''}`];
  if (d.mode === 'live') {
    lines.push(
      d.ssoEnabled
        ? '[AI Tathastu] SSO: ENABLED'
        : `[AI Tathastu] SSO: DISABLED - missing required variables: ${d.missingSsoVariables.join(', ')}`
    );
  }
  if (d.missingWebhookVariables.length) {
    lines.push(`[AI Tathastu] Webhooks will be rejected - missing: ${d.missingWebhookVariables.join(', ')}`);
  }
  if (d.insecureDefaults.length) {
    lines.push(
      process.env.NODE_ENV === 'production'
        ? `[Security] FATAL: missing required secrets: ${d.insecureDefaults.join(', ')}.`
        : `[Security] Not set (random per-process dev secrets in use): ${d.insecureDefaults.join(', ')}.`
    );
  }
  if (d.testHarnessEnabled) {
    lines.push('[Security] Test harness ENABLED (COLLABORATE_ENABLE_FIXTURES=true, non-production). Simulated identities are accepted.');
  }
  return lines;
}
