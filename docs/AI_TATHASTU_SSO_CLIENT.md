# AI Tathastu SSO — Collaborate Client Contract

**Audience:** AI Tathastu integration engineers and Collaborate operators.
**Scope:** How Collaborate (the OAuth client) signs people in with AI Tathastu (the identity provider). This document contains no secret values.

---

## 1. Fixed values

| Item | Value |
|---|---|
| Issuer / authority | `https://www.aitathastu.com` |
| Client ID | `collaborate` |
| Callback (redirect URI) | `https://collaborate.aitathastu.com/api/auth/tathastu/callback` |
| Grant | OAuth 2.0 Authorization Code + PKCE (`S256`) |
| Client authentication | HTTP Basic (`client_id:client_secret`, each URL-encoded) at the token endpoint |
| Access-token format | JWT, **ES256 only**, verified against the remote JWKS |
| Required token claims | `iss` = issuer, `aud` = `collaborate`, `exp`, `sub` (stable person ID), `email` |
| Optional token claims | `name` (or `fullName`) |
| Requested scopes | `skills projects eris experience education achievements activity` |

## 2. Endpoints Collaborate calls

These are the defaults Collaborate builds from the issuer. Each one can be overridden by the variable shown.

| Purpose | Default URL | Override variable |
|---|---|---|
| Authorization (browser redirect) | `https://www.aitathastu.com/integrations/authorize` | `AIT_AUTHORIZE_URL` |
| Token (server-to-server, `POST`, form-encoded) | `https://www.aitathastu.com/api/integrations/sso/token` | `AIT_TOKEN_URL` |
| JWKS (public keys) | `https://www.aitathastu.com/api/integrations/jwks` | `AIT_JWKS_URL` |
| Profile (`GET`, `Authorization: Bearer <access_token>`) | `https://www.aitathastu.com/api/integrations/v1/profile` | `AIT_PROFILE_URL` |

**Authorization request parameters:** `client_id`, `redirect_uri`, `response_type=code`, `state`, `code_challenge`, `code_challenge_method=S256`, `scope`, and `prompt=consent` when the user asks to re-consent.

**Token request body:** `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`.
**Token response used:** `access_token` (required). `token_type`, `expires_in`, `scope`, `id_token` and `user` are optional.

**Profile response:** Collaborate validates the response with `validateProfessionalProjection()` in `src/integrations/tathastu/contract/validator.ts`. That validator expects `schemaVersion: "1.0"`, `source: "ai-tathastu"`, `sourcePersonId`, `sourceVersion`, `updatedAt`, a `profile` object with `displayName`, and a `permissions` object with boolean `importApproved` and `discoverable`.

> **Open item for AI Tathastu:** webhook `profile.updated` payloads are handled in a second shape (`schema: "ProfessionalProjectionV1"`, `identity`, `skills.items`). Please confirm which shape the production profile endpoint returns. If the profile endpoint returns the webhook shape, sign-in still succeeds, but the profile data from that sign-in is skipped and a warning is logged.

## 3. Environment variables Collaborate reads

All SSO variables belong on the **Render backend** (`apps/api`). The Vercel frontend is a pass-through gateway and never holds AI Tathastu secrets.

### Render (backend) — required for live SSO

| Name | Purpose | Secret? |
|---|---|---|
| `TATHASTU_INTEGRATION_MODE` | Must be exactly `live` to enable SSO. Any other value or unset = mock (SSO disabled). | No |
| `AIT_ISSUER` | Issuer, also the base for default endpoints and the expected `iss` | No |
| `AIT_CLIENT_ID` | Must be `collaborate`; also the expected `aud` | No |
| `AIT_CLIENT_SECRET` | Confidential client secret issued by AI Tathastu | **Yes** |
| `AIT_REDIRECT_URI` | Must equal the callback in §1 exactly | No |

Legacy aliases that the code already reads (use only if the canonical name is not set): `AI_TATHASTU_BASE_URL`, `AI_TATHASTU_CLIENT_ID`, `AI_TATHASTU_CLIENT_SECRET`, `AI_TATHASTU_REDIRECT_URI`. Do not set both.

### Render (backend) — optional and related

| Name | Purpose | Secret? |
|---|---|---|
| `AIT_AUTHORIZE_URL`, `AIT_TOKEN_URL`, `AIT_JWKS_URL`, `AIT_PROFILE_URL` | Endpoint overrides (§2) | No |
| `AIT_WEBHOOK_SECRET` | HMAC key for `POST /api/webhooks/tathastu`. If missing, every webhook is rejected. | **Yes** |
| `AUTH_SECRET` | Signs Collaborate session and pending-link tokens. **Must be set in production**; the built-in fallback is public in source. | **Yes** |
| `SESSION_SECRET` | Cookie-signing secret for Fastify. **Must be set in production.** | **Yes** |
| `COLLABORATE_ENABLE_FIXTURES` | `true` enables the test harness (demo personas, simulated claims) **only when `NODE_ENV` is not `production`**. Leave unset or `false` in production. | No |

### Vercel (frontend gateway)

| Name | Purpose |
|---|---|
| `COLLABORATE_BACKEND_URL` | Render backend origin. All `/api/*` traffic, including `/api/auth/tathastu/*`, is proxied here. |
| `NEXT_PUBLIC_ENABLE_FIXTURES` | UI-only switch for demo quick-login buttons. It grants nothing: the backend enforces the harness rule above. Leave unset in production. |

Do **not** put `AIT_CLIENT_SECRET`, `AIT_WEBHOOK_SECRET` or `AUTH_SECRET` on Vercel.

### Startup diagnostics

On boot the backend logs the mode, whether SSO is enabled, and the **names** of any missing variables. Example: `SSO: DISABLED - missing required variables: AIT_CLIENT_SECRET`. It never prints values. `GET /api/auth/tathastu/status` returns only `{ "enabled": boolean, "mode": "mock" | "live" }`.

## 4. Collaborate routes

| Route | Behaviour |
|---|---|
| `GET /api/auth/tathastu/start` | If SSO is disabled, redirects to `/?auth_error=sso_unavailable`. Otherwise it creates the state and PKCE verifier, stores them in the `tathastu_oauth_flow` cookie (HttpOnly, SameSite=Lax, Secure in production, 10 min), and redirects to the authorization endpoint. `redirect_uri` always comes from configuration, never from the request. |
| `GET /api/auth/tathastu/callback` | Clears the flow cookie, then requires a stored flow that is younger than 10 minutes and whose state matches (constant-time comparison). Exchanges the code with client auth and the PKCE verifier, verifies ES256, `iss`, `aud` and `exp` via JWKS, and rejects reused codes. It then resolves the identity, fetches the profile (best effort), sets `collaborate_session` and redirects to `/?auth_success=true`. On failure it redirects to `/?auth_error=<code>`. |
| `POST /api/auth/tathastu/link` | Completes a paused link. Body: `{ "password": "<existing Collaborate password>" }`. Needs the `tathastu_pending_link` cookie (signed, 10 min, holds only the verified `sub`, email and name). |
| `GET /api/auth/tathastu/status` | Value-free availability check (see above). |
| `POST /api/auth/logout` | Clears `collaborate_session`, `tathastu_pending_link` and `tathastu_oauth_flow`. |
| `POST /api/auth/tathastu/callback`, `POST /api/auth/oidc/callback` | Test harness only (simulated claims). Return 404 in production. |
| `GET /api/auth/oidc/callback` | Retired legacy route. Always redirects to `/?auth_error=sso_unavailable`. |

### Safe error codes (`auth_error`)

`access_denied`, `sso_unavailable`, `flow_expired`, `invalid_state`, `missing_code`, `code_reused`, `token_invalid`, `provider_unavailable`, `account_link_required`, `link_password_invalid`, `link_expired`, `identity_conflict`, `sso_failed`.

The login page maps each code to plain-language text (`src/lib/auth/sso-errors.ts`). Any other value shows a generic message. Provider `error_description` text is never shown to users.

## 5. Account-linking rules

1. A known AI Tathastu `sub` (mapping or `tathastu_user_id`) signs in to its mapped Collaborate account.
2. If the `sub` is new and no Collaborate account uses the email, a new account is created and mapped.
3. If the `sub` is new and a Collaborate account **with a password** uses the email, Collaborate asks for that password (`account_link_required`) and links only after the password is verified. Accounts are never merged on email alone.
4. If the `sub` is new and the matching account has **no password**, or is already linked to a different `sub`, the request is refused (`identity_conflict`).
5. Linking keeps the existing password, local profile edits (headline, about), connections and messages.

Profile sync is separate from sign-in. It copies only approved professional fields. Private chats, passwords, protected documents and academic records are never imported.

## 6. Manual end-to-end test (staging first)

**Prerequisites:** AI Tathastu has registered client `collaborate` with the exact callback in §1, issued a client secret, and serves the JWKS publicly.

1. **Check JWKS.** Run `curl -s https://www.aitathastu.com/api/integrations/jwks`. It should return JSON `keys` with at least one EC P-256 key (`"alg":"ES256"` or `"crv":"P-256"`).
2. **Configure Render (staging service).** Set the variables in §3, including `TATHASTU_INTEGRATION_MODE=live`. Restart, and confirm the log shows `SSO: ENABLED` with no missing names.
3. **Check status.** `GET https://<staging-host>/api/auth/tathastu/status` should return `{"enabled":true,"mode":"live"}`.
4. **New user.** In a private window, open the site, click **Continue with AI Tathastu**, and sign in on AI Tathastu. You should land back signed in, and a new Collaborate profile should exist.
5. **Cancel.** Start again and cancel on AI Tathastu. You should see the "sign-in was cancelled" message, and the URL should be cleaned.
6. **Existing account.** Register a Collaborate password account with the same email as an AI Tathastu test user. Sign in with AI Tathastu: the password prompt should appear. Enter a wrong password (expect an error and no link), then the correct one (expect a signed-in session). Confirm the old password still works for email login.
7. **Repeat sign-in.** Sign out, then sign in with AI Tathastu again. There should be no prompt.
8. **Logout.** Click Sign out and reload. The login page should show.
9. **Tamper check.** Start a sign-in, then edit the `state` in the callback URL before it loads. Expect "could not verify this sign-in request".
10. **Production.** Repeat steps 1–4 and 8 only after staging passes and AI Tathastu confirms production credentials.

**Automated suites (local, no network):** `npm run test:sso` runs `tests/tathastu_sso_client_hardening.test.mjs` (real callback against a stubbed provider) and `tests/tathastu_production_integration.test.mjs`. Both suites write to the tracked `data/collaborate.db.json`, so restore that file afterwards with `git checkout -- data/collaborate.db.json`.
