import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

const deploymentId =
  process.env.NEXT_PUBLIC_ATHENVIA_DEPLOYMENT_ID ??
  process.env.GITHUB_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  randomUUID();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_ATHENVIA_DEPLOYMENT_ID: deploymentId,
  },
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@athenvia/contracts", "@athenvia/ui"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
