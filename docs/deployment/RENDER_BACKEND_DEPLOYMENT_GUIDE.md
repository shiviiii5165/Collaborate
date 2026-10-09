# RENDER BACKEND DEPLOYMENT GUIDE
## Collaborate Dedicated Fastify Backend Service

This guide provides exact deployment settings for creating the Collaborate backend Web Service on **Render** (as configured in the Render Dashboard).

---

### 1. Render Web Service Settings

From your Render dashboard (**New Web Service**):

| Setting Field | Value to Enter | Notes |
| :--- | :--- | :--- |
| **Source Code** | `shiviiii5165/Collaborate` | Connected GitHub repository |
| **Name** | `collaborate-backend` (or `Collaborate`) | Unique name for the service |
| **Language** | `Node` | Runtime environment |
| **Branch** | `main` | Production branch |
| **Region** | `Oregon (US West)` (or closest region) | Any region |
| **Root Directory** | *(Leave blank / empty)* | Runs from repository root |
| **Build Command** | `npm install && npm run build:api` | Installs dependencies and typechecks API |
| **Start Command** | `npm run start:api` | Launches Fastify server via `tsx apps/api/src/index.ts` |
| **Instance Type** | `Free` (or `Starter`) | 512 MB RAM / 0.5 CPU |

---

### 2. Environment Variables to Set on Render

In the **Environment** tab on Render, add:

```text
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://postgres.noeapdkpcilldhkymzrv:sHivam%408025@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require
AUTH_SECRET=collaborate_production_secret_key_2026_at_least_32_bytes_long
SESSION_SECRET=collaborate_production_session_signing_secret_2026
NEXT_PUBLIC_APP_URL=https://collaborate-umber.vercel.app
```

---

### 3. Verification After Render Deploy

Once deployed, Render provides an URL:  
`https://collaborate-backend-xxxx.onrender.com`

1. **Verify Health:**  
   Open in your browser:  
   `https://collaborate-backend-xxxx.onrender.com/health`  
   Expected output:
   ```json
   {
     "status": "ok",
     "service": "collaborate-backend",
     "runtime": "Render Node.js",
     "database": "postgresql_configured"
   }
   ```

2. **Copy the Render URL for Vercel:**  
   Copy `https://collaborate-backend-xxxx.onrender.com` to paste into Vercel's `COLLABORATE_BACKEND_URL`.
