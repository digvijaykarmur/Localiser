/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "sharp",
      "postgres",
      "bullmq",
      "ioredis",
    ],
  },
};

export default nextConfig;
