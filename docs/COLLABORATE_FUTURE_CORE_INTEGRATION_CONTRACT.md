# COLLABORATE <-> AI TATHASTU CORE
## FUTURE INTEGRATION CONTRACT & HANDOFF SPECIFICATION

**Contract Version:** `ProfessionalProjectionV1` (v1.0.0)  
**Consumer Platform:** Collaborate (`https://collaborate.aitathastu.com`)  
**Provider Platform:** AI Tathastu Core (`https://www.aitathastu.com`)  
**Status:** CONTRACT READY (Active Mock Implementation, Zero Block on Collaborate Release)  
**Handoff Date:** 2026-10-09  

---

## 1. PURPOSE & INTEGRATION ARCHITECTURE

This specification serves as the formal architectural contract between the Collaborate professional networking application and the future AI Tathastu Core platform.

### Core Philosophy
1. **Asynchronous Independent Lifecycles:** Collaborate operates as a standalone, production-ready product today. It does not depend on Core availability for user registration, local passwords, messaging, connections, or search.
2. **Replaceable Adapter Design:** Collaborate defines an interface `ITathastuIntegrationAdapter` with two implementations:
   - `MockTathastuAdapter`: Used today for local development, visual testing, and automated integration suites.
   - `LiveTathastuAdapter`: Fully implemented in `src/integrations/tathastu/live/adapter.ts`, ready to activate via `TATHASTU_INTEGRATION_MODE=live` once Core is deployed.
3. **Quarantine-First Data Hygiene:** Collaborate strictly isolates public networking profiles from Core's internal academic grades, raw resume uploads, private contact phone numbers, or administrative notes.

```
+-------------------------------------------------------------------+
|                       AI TATHASTU CORE                            |
|             (Identity, Courses, Projects, LMS, Hackathons)        |
+---------------------------------+---------------------------------+
                                  |
               HTTPS REST / Webhooks (OIDC PKCE + mTLS/Bearer)
                                  |
                                  v
+-------------------------------------------------------------------+
|               COLLABORATE INTEGRATION BOUNDARY                    |
|                                                                   |
|   +--------------------------+   +----------------------------+   |
|   |   MockTathastuAdapter    |   |    LiveTathastuAdapter     |   |
|   |  (Active P3.5 Baseline)  |   |  (Target Contract Ready)   |   |
|   +--------------------------+   +----------------------------+   |
|                                                                   |
|   Schema Validation: ProfessionalProjectionV1                     |
|   Local Override Protection: Headline / Bio preserved            |
|   Quarantine Isolation: Academic & Resume data suppressed         |
+---------------------------------+---------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|                   COLLABORATE DATA STORAGE                        |
|             (Durable JSON Store + Neon PostgreSQL)                |
+-------------------------------------------------------------------+
```

---

## 2. IDENTITY SUBJECT & ACCOUNT MAPPING CONTRACT

### 2.1 Subject Identifier Semantics
- Core must assign every user an immutable, stable Subject Identifier (`sub`):
  - Format: `urn:tathastu:person:<UUID_v4>` or `core_person_<alnum>`
  - The subject ID must **never change**, even if the user updates their primary email address, full name, or institution.
- Collaborate maps external identities using the `identity_mappings` table:
  ```typescript
  export interface ExternalIdentityMapping {
    id: string;                      // Internal mapping ID (map_...)
    memberId: string;                // Collaborate member ID (usr_...)
    provider: 'aitathastu_oidc';     // Identity provider type
    externalSubjectId: string;       // Immutable Core subject URN
    externalEmail: string;           // Core primary email
    createdAt: string;               // ISO 8601 timestamp
  }
  ```

### 2.2 Account Linking & Anti-Takeover Rules
1. **First-Time Registration via SSO:** Creates a new Collaborate profile and records the `identity_mappings` entry automatically.
2. **Existing Collaborate Member Links Tathastu Account:**
   - If an existing Collaborate account matches the SSO email, Collaborate **STRICTLY REJECTS** automatic blind merging.
   - The user must provide their existing Collaborate account password to authorize the account link.
   - An external subject ID can be bound to **at most ONE** Collaborate member. Collision attempts are rejected with HTTP 409 `IDENTITY_COLLISION`.

---

## 3. PROFESSIONAL PROJECTION SCHEMA (`ProfessionalProjectionV1`)

All data shared from AI Tathastu Core to Collaborate must conform to the JSON schema validated in `src/integrations/tathastu/contract/validator.ts`:

```typescript
export interface ProfessionalProjectionV1 {
  schemaVersion: "1.0";
  source: "ai-tathastu";
  sourcePersonId: string;
  sourceVersion: string;
  updatedAt: string;

  profile: {
    displayName: string;
    headline?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    location?: string;
    about?: string;
    education: EducationRecord[];
    skills: ApprovedSkillRecord[];
    projects: ApprovedProjectRecord[];
    achievements: ApprovedAchievementRecord[];
    interests: string[];
    portfolioLinks: ApprovedLink[];
  };

  permissions: {
    importApproved: boolean;
    discoverable: boolean;
    allowedFieldPaths: string[]; // e.g. ["profile.education", "profile.skills", "profile.projects"]
    consentVersion: string;     // e.g. "v1.0-20261009"
    consentGrantedAt: string;
  };

  // Quarantined fields that must NEVER cross into Collaborate
  quarantinedPrivateData: string[];
}
```

### 3.1 Field-Level Definitions
- `EducationRecord`: Institution name, period (`2023 – 2027`), degree, score (`CGPA: 8.9 / 10`), verified flag.
- `ApprovedSkillRecord`: Skill name, category (`ml_ai` | `framework` | `language` | `tool` | `theory`), verified level, `confirmedByCore: boolean`.
- `ApprovedProjectRecord`: Title, description, tags, stars, forks, demoUrl, `sourceOrigin: 'ai_tathastu_core'`.
- `ApprovedAchievementRecord`: Title, issuer, credentialId, badgeUrl.

### 3.2 Data Quarantine Guarantee
The following attributes must remain quarantined on Core and **NEVER** transmitted in projection payloads:
- Semester-by-semester grade sheets or raw marks.
- Academic warning notices or disciplinary records.
- Raw unparsed resume PDF uploads.
- Guardian contact details or home physical addresses.

---

## 4. FIELD-LEVEL CONSENT & LOCAL OVERRIDE PROTECTION

### 4.1 Granular Consent Model
Core users must grant explicit consent before their profile becomes discoverable in Collaborate:
- `permissions.importApproved`: Must be `true` for Collaborate to create a draft or sync data.
- `permissions.discoverable`: If `false`, the member is hidden from public directory search.
- `permissions.allowedFieldPaths`: Core user can independently allow or disallow `profile.education`, `profile.skills`, or `profile.projects`.

### 4.2 Local Override Precedence
Collaborate members have the right to customize their networking identity:
- If a member edits their **headline** or **about summary** directly on Collaborate, Collaborate sets `localOverride: true` on those fields.
- Subsequent upstream Core sync events **MUST NOT** overwrite these customized fields. Upstream updates only merge non-conflicting skills and verified projects.

---

## 5. REAL-TIME CHANGE-EVENT PROTOCOL (ALL 15 SCENARIOS)

Core notifies Collaborate of upstream changes via HTTP POST webhooks to `/api/federation/events`.

### Event Payload Schema
```typescript
export interface TathastuSyncEvent {
  eventId: string;             // Unique event UUID (evt_...)
  eventType: TathastuSyncEventType;
  sourcePersonId: string;      // Core subject ID
  timestamp: string;           // ISO 8601 event generation timestamp
  payload?: Partial<ProfessionalProjectionV1>;
  details?: Record<string, any>;
}
```

### Supported Event Types & Idempotency Rules
| Event Type | Description | Idempotency / Error Behavior |
| :--- | :--- | :--- |
| `new_eligible_member` | New user created in Core eligible for networking | Idempotent discovery check. |
| `profile_updated` | Core profile updated | Merges skills; preserves local headline/bio overrides. |
| `new_confirmed_project` | User completed verified Core project | Deduplicates by project title/id; adds to portfolio. |
| `approved_skill_updated` | New skill endorsement issued by Core | Merges into skills array without duplicates. |
| `visibility_changed` | User altered discoverability settings | Updates directory index immediately. |
| `consent_revoked` | User revoked Collaborate sharing consent | Removes Core-synced projects; retains Collaborate account. |
| `user_unlinked` | User severed account link | Severs mapping; Collaborate account preserved. |
| `source_record_deleted` | User deleted their Core account | Collaborate account preserved independently. |
| `user_deactivated` | Core account suspended/deactivated | Collaborate account preserved independently. |
| `conflicting_local_override` | Detected concurrent conflict | Local Collaborate values take strict precedence. |
| `duplicate_event_delivery` | Same event delivered multiple times | Deduplicated via `eventId`; suppressed safely. |
| `out_of_order_event_delivery` | Stale event delivered out of order | Rejected if `event.timestamp < member.lastSyncedAt`. |
| `invalid_source_identity` | Unrecognized or malformed source ID | Rejected with HTTP 422 `INVALID_SOURCE_IDENTITY`. |
| `invalid_projection_schema` | Payload fails schema contract | Rejected with HTTP 422 `SCHEMA_VALIDATION_ERROR`. |
| `temporary_source_outage` | Upstream Core unavailable / timed out | Resilient circuit breaker; Collaborate functions standalone. |

---

## 6. REQUIRED AI TATHASTU CORE ENDPOINTS

When Core is ready for production live integration, it must expose the following REST endpoints to Collaborate:

| Endpoint | Method | Authentication | Purpose |
| :--- | :--- | :--- | :--- |
| `/v1/federation/projections/:sourcePersonId` | `GET` | Service Bearer Token | Fetch full `ProfessionalProjectionV1` for a member |
| `/v1/federation/discovery/eligible` | `GET` | Service Bearer Token | Fetch list of members who granted public discovery consent |
| `/v1/federation/events/:eventId/ack` | `POST` | Service Bearer Token | Acknowledge receipt of a sync webhook event |
| `/oauth/authorize` | `GET` | OIDC PKCE | Central login authorization endpoint |
| `/oauth/token` | `POST` | Client Credentials / PKCE | Exchange authorization code for identity tokens |
| `/oauth/userinfo` | `GET` | User Access Token | Fetch OpenID Connect claims (`sub`, `email`, `name`) |

---

## 7. ERROR CODES & HTTP STATUS MAPPING

| Code | HTTP Status | Description | Action Required by Core |
| :--- | :--- | :--- | :--- |
| `INVALID_CONTRACT_VERSION` | 400 | Projection uses unsupported schemaVersion | Core must upgrade to version `1.0`. |
| `UNAUTHORIZED` | 401 | Invalid or expired service bearer token | Core must refresh credentials. |
| `CONSENT_REQUIRED` | 403 | User has not granted Collaborate consent | Prompt user for consent on Core. |
| `MEMBER_NOT_FOUND` | 404 | External subject ID not mapped | Verify subject URN. |
| `QUOTA_EXCEEDED` | 402 | Daily full-profile view limit reached | Prompt user to upgrade to Premium. |
| `DUPLICATE_EVENT` | 200 | Event previously processed | Idempotently acknowledged. |
| `OUT_OF_ORDER_EVENT` | 422 | Stale timestamp rejected | Core should resync with latest snapshot. |
| `CORE_UNAVAILABLE` | 503 | Core service timeout / circuit breaker | Automatic exponential retry. |

---

## 8. TEST FIXTURES & VALIDATION CHECKLIST

Collaborate provides ready-to-use test fixtures in `src/integrations/tathastu/fixtures/personas.ts`:
1. `core_person_rahul`: AI/ML Student builder persona (Lovely Professional University).
2. `core_person_priya`: Computer Vision & Medical Diagnostics Researcher persona (IIIT Delhi).
3. `core_person_aman`: Distributed Systems & MLOps Engineer persona (IIT Bombay).
4. `core_person_neha`: AI Systems Architect persona (IIT Delhi).

### Core Team Hand-Off Checklist
- [ ] Implement `ProfessionalProjectionV1` serializer in Core API backend.
- [ ] Verify field-level consent toggles on Core user settings page.
- [ ] Set up webhook dispatcher with HMAC SHA-256 signatures for the 15 sync events.
- [ ] Provide staging OIDC discovery endpoint (`.well-known/openid-configuration`).
- [ ] Conduct end-to-end integration test against Collaborate staging environment.
