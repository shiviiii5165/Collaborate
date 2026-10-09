# VERCEL FRONTEND DEPLOYMENT GUIDE
## Next.js UI & BFF Edge Gateway

This guide covers configuring the Next.js frontend on **Vercel** to consume the dedicated Render backend.

---

### 1. Vercel Project Settings

From your Vercel Project dashboard (`collaborate`):

- **Framework Preset**: Next.js
- **Root Directory**: `./`
- **Build Command**: `npm run build:web` (or standard `next build`)
- **Output Directory**: `.next`

---

### 2. Environment Variables on Vercel

Under **Project Settings** → **Environment Variables**, configure:

| Key | Value | Description |
| :--- | :--- | :--- |
| **`COLLABORATE_BACKEND_URL`** | `https://collaborate-backend-xxxx.onrender.com` | Your Render backend service URL |
| **`NEXT_PUBLIC_APP_URL`** | `https://collaborate-umber.vercel.app` | Public frontend URL |
| **`AUTH_SECRET`** | `collaborate_production_secret_key_2026_at_least_32_bytes_long` | JWT secret |

---

### 3. How the Gateway Operates

When `COLLABORATE_BACKEND_URL` is set:
- Next.js acts as a secure BFF (Backend for Frontend).
- All requests from React components to `/api/*` are reverse-proxied to the Render backend service.
- The browser never makes cross-origin requests; cookies remain host-only on `collaborate.aitathastu.com` or `collaborate-umber.vercel.app`.
