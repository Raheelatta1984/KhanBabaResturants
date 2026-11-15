import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Which commit is this build? Stamped once, here, and inlined into the bundle
 * so every page and every log line can say what is actually running. Vercel
 * and GitHub Actions both provide the SHA; a local build asks git.
 */
function buildSha() {
  const fromHost = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromHost) return fromHost;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    KB_BUILD_SHA: buildSha(),
    KB_BUILD_TIME: new Date().toISOString(),
  },
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
