/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  // API routing is handled exclusively by the Unified Vercel API Gateway
  // at src/app/api/[[...path]]/route.ts to preserve host-only session cookies,
  // SSE streaming propagation, and cold-start 503 fallback handling.
  // Conflicting duplicate Next.js rewrites are disabled.
  async rewrites() {
    return [];
  },
};

export default nextConfig;
