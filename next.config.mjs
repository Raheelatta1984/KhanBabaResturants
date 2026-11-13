import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // PGlite is loaded only when DATABASE_URL points at it (CI / local tests), and
  // node-postgres must stay a real runtime dependency so its TCP pool is not
  // bundled by turbopack. Keeping both external also stops the 7 MB wasm engine
  // from being traced into every function.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  images: { unoptimized: true },
  poweredByHeader: false,
  // TypeScript 7 removed `baseUrl`, so the "@/"" alias is wired up explicitly.
  turbopack: { resolveAlias: { "@/*": "./*" } },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@": path.resolve(process.cwd()),
    };
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
