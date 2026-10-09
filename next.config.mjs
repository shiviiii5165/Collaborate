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
  async rewrites() {
    const backendUrl = process.env.COLLABORATE_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
    if (backendUrl) {
      const target = backendUrl.replace(/\/$/, '');
      return [
        {
          source: '/api/:path*',
          destination: `${target}/api/:path*`,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
