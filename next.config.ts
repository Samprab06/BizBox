import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces the minimal Node runtime copied into the optional local app image.
  output: "standalone",
  // The agent SDKs (deepagents, @langchain/*) are ESM-only and are bundled. On Vercel,
  // Turbopack's hashed external aliases for them lost the packages' "type": "module",
  // so Node parsed their ESM as CommonJS ("Cannot use import statement outside a
  // module", HAC-58). Only CommonJS packages stay external. langsmith must stay
  // external: bundling it pulls in its optional sandbox import of `ws`.
  serverExternalPackages: ["postgres", "langsmith"],
  // Only content-hashed derivatives use long-lived browser caching. Original
  // media and mutable routes retain their existing cache behavior.
  async headers() {
    return [
      {
        source: "/landing-assets/optimized/:asset(.*\\.webp)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
