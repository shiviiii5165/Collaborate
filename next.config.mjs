/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No next/image remote sources: the app renders avatars with plain <img>. A `hostname: '**'`
  // pattern made /_next/image an open proxy that fetched and resized any HTTPS image.
  // API routing is handled exclusively by the Unified Vercel API Gateway
  // at src/app/api/[[...path]]/route.ts to preserve host-only session cookies,
  // SSE streaming propagation, and cold-start 503 fallback handling.
  // Conflicting duplicate Next.js rewrites are disabled.
  async rewrites() {
    return [];
  },
  // Baseline browser protections (nothing frames Collaborate; AI Tathastu and Avsar send the same set).
  // A full script CSP is not set here: it needs nonces for Next's inline runtime and is a separate change.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
