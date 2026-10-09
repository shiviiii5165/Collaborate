# COLLABORATE — FRONTEND & BACKEND ARCHITECTURAL BOUNDARY
## Phase P5-A Split Architecture Specification

### 1. High-Level Topology

```text
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│     CLIENT BROWSER (User)       │           │      COLLABORATE DATABASE       │
│   collaborate.aitathastu.com    │           │      (Neon / Supabase PG)       │
└───────────────┬─────────────────┘           └────────────────▲────────────────┘
                │                                              │
                │ HTTPS (Same-Origin)                          │ Authoritative Writes & Pool
                ▼                                              │
┌─────────────────────────────────┐           ┌────────────────┴────────────────┐
│      VERCEL FRONTEND (BFF)      │  Rewrites │     RENDER DEDICATED BACKEND    │
│       Next.js 16 App Router     ├──────────►│      Fastify TypeScript API     │
│       • React Server Components │  /api/*   │      • Session Auth Validation  │
│       • Vanilla CSS UI Tokens   │           │      • Profile & Connection DB  │
│       • Host-Only Cookie Proxy  │           │      • Long-Running 24/7 SSE    │
└─────────────────────────────────┘           └─────────────────────────────────┘
```

---

### 2. Communication & Gateway Contract

1. **Browser to Frontend (Same-Origin Requests):**
   - The user browser navigates to `https://collaborate.aitathastu.com` (or `https://collaborate-umber.vercel.app`).
   - All frontend network requests target `/api/*` on the same host origin.
   - Eliminates third-party cookie restrictions, cross-site tracking blocks (Safari ITP, Chrome Privacy Sandbox), and CORS degradation.

2. **Next.js BFF Gateway Rewrites (`next.config.mjs`):**
   ```javascript
   async rewrites() {
     const backendUrl = process.env.COLLABORATE_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
     if (backendUrl) {
       return [
         {
           source: '/api/:path*',
           destination: `${backendUrl.replace(/\/$/, '')}/api/:path*`,
         },
       ];
     }
     return [];
   }
   ```
   - When `COLLABORATE_BACKEND_URL` is configured on Vercel, Next.js acts as an edge reverse-proxy forwarding API requests directly to the Render service.
   - Host-only cookies (`collaborate_session`), `Authorization` headers, and `Last-Event-ID` SSE headers are passed through transparently.

3. **Backend Service on Render:**
   - Dedicated Fastify Node.js process listening on `0.0.0.0:$PORT`.
   - Authoritative for all database writes, transaction isolation, business logic validations, quota decrement, and student safeguarding policies.
   - Long-running execution model allows Server-Sent Events (`/api/messages/stream`) to stay open 24/7 without serverless function execution limits.

---

### 3. Security & Safeguarding Boundaries

- **Database Credentials Isolation:** Neon/Supabase PostgreSQL connection strings are stored exclusively in the Render backend environment. The browser never receives database credentials.
- **Session Tokens:** Signed with HMAC-SHA256 (`jose`) using `AUTH_SECRET`. Stored in `HttpOnly`, `SameSite=Lax`, `Secure` cookies.
- **Student Safeguarding:** Under-18 accounts are private by default, excluded from adult discovery feeds, and protected against unsolicited adult contact. Enforced server-side in `apps/api/src/server.ts` via `@collaborate/domain`.
- **Authoritative Quotas:** Free accounts are strictly bounded to 3 full profile views per Kolkata day key (`Asia/Kolkata`).
