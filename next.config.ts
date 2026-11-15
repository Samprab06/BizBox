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
};

export default nextConfig;
