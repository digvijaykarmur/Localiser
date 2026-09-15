/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["sharp", "bullmq", "ioredis", "postgres", "@google/genai"],
  },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
