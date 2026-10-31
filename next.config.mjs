/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ['three'],
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
