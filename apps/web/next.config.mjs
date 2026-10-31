/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ['three'],
  eslint: { ignoreDuringBuilds: true },
  // Same-origin API: the browser calls /api/v1/*, Next forwards to the API server, and the
  // httpOnly session cookie stays first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }, { key: 'X-Frame-Options', value: 'DENY' }] }];
  },
};
export default nextConfig;
