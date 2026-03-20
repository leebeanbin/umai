import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Proxy /api/* → backend server
  // INTERNAL_API_URL is a server-side-only env var (not exposed to browser)
  // dev:  set in .env.local          (INTERNAL_API_URL=http://localhost:8001)
  // prod: set as Docker ARG/ENV      (INTERNAL_API_URL=http://umai-backend:8000)
  async rewrites() {
    const backendUrl = process.env.INTERNAL_API_URL ?? "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
