import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  images: { unoptimized: true },
  poweredByHeader: false,
  // TypeScript 7 removed `baseUrl`, so the "@/" alias is wired up explicitly.
  turbopack: { resolveAlias: { "@/*": "./*" } },
  webpack: (config) => {
    config.resolve.alias = { ...(config.resolve.alias ?? {}), "@": path.resolve(process.cwd()) };
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
