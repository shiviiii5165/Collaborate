/**
 * Safe, user-facing AI Tathastu SSO error codes.
 *
 * The backend redirects with `?auth_error=<code>` using ONLY these codes. Raw provider
 * messages, stack traces and token details are logged server-side and never shown.
 * This module is pure so it can be imported by both server and client code.
 */

export const SSO_ERROR_MESSAGES = {
  access_denied: 'AI Tathastu sign-in was cancelled. You can try again or sign in with your Collaborate password.',
  sso_unavailable: 'Sign-in with AI Tathastu is not available yet. Please use your Collaborate email and password.',
  flow_expired: 'Your sign-in attempt expired or was started in another browser tab. Please try again.',
  invalid_state: 'We could not verify this sign-in request. Please start again from the Collaborate sign-in page.',
  missing_code: 'AI Tathastu did not return a sign-in code. Please try again.',
  code_reused: 'This sign-in link has already been used. Please start a new sign-in.',
  token_invalid: 'We could not verify your AI Tathastu identity. Please try again.',
  provider_unavailable: 'AI Tathastu is temporarily unreachable. Please try again shortly or use your Collaborate password.',
  account_link_required:
    'A Collaborate account already uses this email. Confirm your Collaborate password below to link it to AI Tathastu.',
  link_password_invalid: 'That Collaborate password was incorrect. Your account was not linked.',
  link_expired: 'The account-linking request expired. Please sign in with AI Tathastu again.',
  identity_conflict:
    'This Collaborate account is already linked to a different AI Tathastu account. Contact support if this is unexpected.',
  sso_failed: 'Sign-in with AI Tathastu failed. Please try again or use your Collaborate password.',
} as const;

export type SsoErrorCode = keyof typeof SSO_ERROR_MESSAGES;

export function isSsoErrorCode(value: unknown): value is SsoErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SSO_ERROR_MESSAGES, value);
}

/** Maps any auth_error query value (including unknown/attacker-supplied text) to a safe message. */
export function getSsoErrorMessage(value: unknown): string {
  return isSsoErrorCode(value) ? SSO_ERROR_MESSAGES[value] : SSO_ERROR_MESSAGES.sso_failed;
}

/** Maps an internal error (message prefix convention used by the SSO service) to a safe code. */
export function classifySsoError(err: unknown): SsoErrorCode {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const prefix = msg.split(':')[0].trim();
  switch (prefix) {
    case 'SSO_NOT_CONFIGURED':
      return 'sso_unavailable';
    case 'INVALID_OAUTH_STATE':
      return 'invalid_state';
    case 'OAUTH_FLOW_MISSING':
    case 'OAUTH_FLOW_EXPIRED':
      return 'flow_expired';
    case 'MISSING_PARAMETERS':
    case 'MISSING_AUTHORIZATION_CODE':
    case 'MISSING_CODE_VERIFIER':
      return 'missing_code';
    case 'REPLAYED_AUTHORIZATION_CODE':
      return 'code_reused';
    case 'invalid_grant': // provider rejected code/PKCE verifier/redirect_uri
      return 'invalid_state';
    case 'UNSUPPORTED_ALGORITHM':
    case 'TOKEN_EXPIRED':
    case 'WRONG_ISSUER':
    case 'WRONG_AUDIENCE':
    case 'TOKEN_VERIFICATION_FAILED':
    case 'INVALID_TOKEN':
    case 'INVALID_TOKEN_FORMAT':
    case 'INVALID_TOKEN_HEADER':
    case 'INVALID_TOKEN_RESPONSE':
    case 'INVALID_IDENTITY_CLAIMS':
    case 'INVALID_TOKEN_AUDIENCE':
      return 'token_invalid';
    case 'PROVIDER_UNAVAILABLE':
      return 'provider_unavailable';
    case 'ACCOUNT_EXISTS_REQUIRES_CONFIRMATION':
      return 'account_link_required';
    case 'INVALID_PASSWORD':
      return 'link_password_invalid';
    case 'IDENTITY_MISMATCH':
      return 'identity_conflict';
    default:
      return 'sso_failed';
  }
}
