import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces the minimal Node runtime copied into the optional local app image.
  output: "standalone",
  // Load the Node agent SDKs natively; bundling their optional sandbox imports
  // makes Turbopack require unused dependencies such as `ws`.
  serverExternalPackages: [
    "postgres",
    "deepagents",
    "@langchain/core",
    "@langchain/anthropic",
  ],
};

export default nextConfig;
